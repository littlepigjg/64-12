import { formatDate, getDirSize } from '../../utils';
import { calculateHeatScores } from '../../utils/heat-score';
import { config } from '../../config';
import { MetadataStore } from './metadata-store';
import type { PackageInfo, PackageVersion, CacheStats, StorageTrend, CachePolicy, RegistryType, PackageSource } from '../../types';

export class MetadataManager extends MetadataStore {

  getPackage(name: string, registry: RegistryType): PackageInfo | null {
    const pkg = this.findPackageByName(name, registry);
    if (!pkg) return null;

    const versions = this.getVersionsForPackage(pkg.id)
      .sort((a, b) => b.publishedAt - a.publishedAt)
      .map<PackageVersion>((v) => ({
        version: v.version,
        size: v.size,
        filePath: v.filePath,
        sha1: v.sha1,
        publishedAt: v.publishedAt,
        lastAccessedAt: v.lastAccessedAt,
        downloadCount: v.downloadCount,
      }));

    return {
      name: pkg.name,
      registry: pkg.registry,
      source: pkg.source,
      scope: pkg.scope,
      description: pkg.description,
      author: pkg.author,
      license: pkg.license,
      latestVersion: pkg.latestVersion,
      createdAt: pkg.createdAt,
      updatedAt: pkg.updatedAt,
      lastAccessedAt: pkg.lastAccessedAt,
      totalSize: pkg.totalSize,
      downloadCount: pkg.downloadCount,
      versions,
    };
  }

  listPackages(options: {
    registry?: RegistryType;
    source?: PackageSource;
    search?: string;
    limit?: number;
    offset?: number;
    sortBy?: 'name' | 'updatedAt' | 'size' | 'downloads';
    sortOrder?: 'asc' | 'desc';
  } = {}): { packages: PackageInfo[]; total: number } {
    let list = [...this.db.packages];

    if (options.registry) list = list.filter((p) => p.registry === options.registry);
    if (options.source) list = list.filter((p) => p.source === options.source);
    if (options.search) {
      const s = options.search.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(s));
    }

    const total = list.length;

    const sortField = options.sortBy === 'size' ? 'totalSize' :
      options.sortBy === 'downloads' ? 'downloadCount' :
      options.sortBy === 'updatedAt' ? 'updatedAt' : 'name';
    const order = options.sortOrder?.toUpperCase() === 'ASC' ? 1 : -1;

    list.sort((a: any, b: any) => {
      const va = a[sortField];
      const vb = b[sortField];
      if (typeof va === 'string') return va.localeCompare(vb) * order;
      return (va - vb) * order;
    });

    const limit = options.limit || 50;
    const offset = options.offset || 0;
    list = list.slice(offset, offset + limit);

    const idSet = new Set(list.map((p) => p.id));
    const versionsByPkg: Record<number, Array<typeof this.db.versions[0]>> = {};
    for (const v of this.db.versions) {
      if (idSet.has(v.packageId)) {
        if (!versionsByPkg[v.packageId]) versionsByPkg[v.packageId] = [];
        versionsByPkg[v.packageId].push(v);
      }
    }
    for (const arr of Object.values(versionsByPkg)) {
      arr.sort((a, b) => b.publishedAt - a.publishedAt);
    }

    const packages: PackageInfo[] = list.map((pkg) => ({
      name: pkg.name,
      registry: pkg.registry,
      source: pkg.source,
      scope: pkg.scope,
      description: pkg.description,
      author: pkg.author,
      license: pkg.license,
      latestVersion: pkg.latestVersion,
      createdAt: pkg.createdAt,
      updatedAt: pkg.updatedAt,
      lastAccessedAt: pkg.lastAccessedAt,
      totalSize: pkg.totalSize,
      downloadCount: pkg.downloadCount,
      versions: (versionsByPkg[pkg.id] || []).map<PackageVersion>((v) => ({
        version: v.version,
        size: v.size,
        filePath: v.filePath,
        sha1: v.sha1,
        publishedAt: v.publishedAt,
        lastAccessedAt: v.lastAccessedAt,
        downloadCount: v.downloadCount,
      })),
    }));

    return { packages, total };
  }

  getVersionFilePath(packageName: string, registry: RegistryType, version: string): string | null {
    const pkg = this.findPackageByName(packageName, registry);
    if (!pkg) return null;
    const ver = this.findVersion(pkg.id, version);
    return ver?.filePath || null;
  }

  getStats(): CacheStats {
    const totalPackages = this.db.packages.length;
    const totalVersions = this.db.versions.length;
    const totalSize = this.db.packages.reduce((s, p) => s + p.totalSize, 0);
    const npmPackages = this.db.packages.filter((p) => p.registry === 'npm').length;
    const pypiPackages = this.db.packages.filter((p) => p.registry === 'pypi').length;
    const privatePackages = this.db.packages.filter((p) => p.source === 'private').length;
    const cachePackages = this.db.packages.filter((p) => p.source === 'cache').length;

    const policy = this.getCachePolicy();
    const maxSizeBytes = policy.maxSizeGB * 1024 * 1024 * 1024;
    const dirSize = getDirSize(config.storageDir);
    const actualSize = Math.max(totalSize, dirSize);

    return {
      totalPackages,
      totalVersions,
      totalSize: actualSize,
      npmPackages,
      pypiPackages,
      privatePackages,
      cachePackages,
      maxSize: maxSizeBytes,
      usagePercent: actualSize > 0 && maxSizeBytes > 0 ? Math.min(100, (actualSize / maxSizeBytes) * 100) : 0,
    };
  }

  getStorageTrend(days: number = 30): StorageTrend[] {
    return this.db.storageTrend.slice(-days);
  }

  recordStorageSnapshot(): void {
    const stats = this.getStats();
    const dateStr = formatDate(Date.now());
    this.saveStorageSnapshotData(
      { totalSize: stats.totalSize, totalPackages: stats.totalPackages },
      dateStr
    );
  }

  getOldPackages(maxAgeDays: number): Array<{ name: string; registry: RegistryType; filePath: string }> {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const result: Array<{ name: string; registry: RegistryType; filePath: string }> = [];
    for (const v of this.db.versions) {
      const pkg = this.findPackageById(v.packageId);
      if (!pkg || pkg.source !== 'cache') continue;
      if (v.lastAccessedAt > 0 && v.lastAccessedAt >= cutoff) continue;
      result.push({ name: pkg.name, registry: pkg.registry, filePath: v.filePath });
    }
    return result;
  }

  getPackagesForEviction(neededBytes: number): Array<{ name: string; registry: RegistryType; version: string; filePath: string; size: number; heatScore?: number }> {
    const policy = this.getCachePolicy();

    const cacheVersions = this.db.versions.filter((v) => {
      const pkg = this.findPackageById(v.packageId);
      return pkg && pkg.source === 'cache';
    });

    const versionRows = cacheVersions.map((v) => {
      const pkg = this.findPackageById(v.packageId)!;
      return {
        name: pkg.name,
        registry: pkg.registry,
        version: v.version,
        filePath: v.filePath,
        size: v.size,
        downloadCount: v.downloadCount,
        lastAccessedAt: v.lastAccessedAt,
        _pkgDownloads: pkg.downloadCount,
        _pkgUpdated: pkg.updatedAt,
      };
    });

    if (policy.evictionStrategy === 'time-based') {
      const sorted = versionRows
        .sort((a, b) => {
          const aNever = a.lastAccessedAt === 0;
          const bNever = b.lastAccessedAt === 0;
          if (aNever && !bNever) return -1;
          if (!aNever && bNever) return 1;
          if (aNever && bNever) return a.downloadCount - b.downloadCount;
          if (a.lastAccessedAt !== b.lastAccessedAt) return a.lastAccessedAt - b.lastAccessedAt;
          return a.downloadCount - b.downloadCount;
        });

      const result: Array<{ name: string; registry: RegistryType; version: string; filePath: string; size: number }> = [];
      let acc = 0;
      for (const r of sorted) {
        result.push({
          name: r.name,
          registry: r.registry,
          version: r.version,
          filePath: r.filePath,
          size: r.size,
        });
        acc += r.size;
        if (acc >= neededBytes) break;
      }
      return result;
    }

    const scored = calculateHeatScores(
      versionRows,
      (v) => v.downloadCount,
      (v) => v.lastAccessedAt,
      policy
    ).sort((a, b) => a.heatScore - b.heatScore);

    const result: Array<{ name: string; registry: RegistryType; version: string; filePath: string; size: number; heatScore: number }> = [];
    let acc = 0;
    for (const r of scored) {
      result.push({
        name: r.name,
        registry: r.registry,
        version: r.version,
        filePath: r.filePath,
        size: r.size,
        heatScore: r.heatScore,
      });
      acc += r.size;
      if (acc >= neededBytes) break;
    }
    return result;
  }
}
