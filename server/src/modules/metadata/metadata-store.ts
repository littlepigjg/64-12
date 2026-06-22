import fs from 'fs';
import path from 'path';
import { ensureDir } from '../../utils';
import { config } from '../../config';
import type { CachePolicy, RegistryType, PackageSource, StorageTrend } from '../../types';

export interface DBPackage {
  id: number;
  name: string;
  registry: RegistryType;
  source: PackageSource;
  scope?: string;
  description?: string;
  author?: string;
  license?: string;
  latestVersion: string;
  createdAt: number;
  updatedAt: number;
  lastAccessedAt: number;
  totalSize: number;
  downloadCount: number;
}

export interface DBVersion {
  id: number;
  packageId: number;
  version: string;
  size: number;
  filePath: string;
  sha1?: string;
  publishedAt: number;
  lastAccessedAt: number;
  downloadCount: number;
}

export interface DB {
  nextPackageId: number;
  nextVersionId: number;
  packages: DBPackage[];
  versions: DBVersion[];
  storageTrend: StorageTrend[];
  cachePolicy: CachePolicy;
}

const DEFAULT_POLICY: CachePolicy = {
  maxSizeGB: 50,
  maxAgeDays: 90,
  autoClean: true,
  evictionStrategy: 'heat-based',
  frequencyWeight: 0.5,
  recencyWeight: 0.5,
  heatHalfLifeDays: 30,
};

function migratePackage(p: any, now: number): DBPackage {
  return {
    ...p,
    lastAccessedAt: typeof p.lastAccessedAt === 'number' && p.lastAccessedAt > 0
      ? p.lastAccessedAt
      : (p.updatedAt || now),
  };
}

function migrateVersion(v: any, now: number): DBVersion {
  return {
    ...v,
    lastAccessedAt: typeof v.lastAccessedAt === 'number' && v.lastAccessedAt > 0
      ? v.lastAccessedAt
      : 0,
  };
}

export class MetadataStore {
  protected dataDir: string;
  protected dbPath: string;
  protected db: DB;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    ensureDir(dataDir);
    this.dbPath = path.join(dataDir, 'registry-data.json');
    this.db = this.loadDB();
  }

  private loadDB(): DB {
    if (fs.existsSync(this.dbPath)) {
      try {
        const raw = fs.readFileSync(this.dbPath, 'utf-8');
        const parsed = JSON.parse(raw);
        const now = Date.now();

        const packages = (parsed.packages || []).map((p: any) => migratePackage(p, now));
        const versions = (parsed.versions || []).map((v: any) => migrateVersion(v, now));

        const cachePolicy = {
          ...DEFAULT_POLICY,
          ...config.cache,
          ...(parsed.cachePolicy || {}),
        };

        return {
          nextPackageId: parsed.nextPackageId || 1,
          nextVersionId: parsed.nextVersionId || 1,
          packages,
          versions,
          storageTrend: parsed.storageTrend || [],
          cachePolicy,
        };
      } catch {
        // fall through to default
      }
    }
    return {
      nextPackageId: 1,
      nextVersionId: 1,
      packages: [],
      versions: [],
      storageTrend: [],
      cachePolicy: { ...DEFAULT_POLICY, ...config.cache },
    };
  }

  protected scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.persist();
    }, 200);
  }

  protected persist(): void {
    ensureDir(this.dataDir);
    const tmpPath = this.dbPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(this.db, null, 2), 'utf-8');
    fs.renameSync(tmpPath, this.dbPath);
  }

  findPackageByName(name: string, registry: RegistryType): DBPackage | undefined {
    return this.db.packages.find((p) => p.name === name && p.registry === registry);
  }

  findPackageById(id: number): DBPackage | undefined {
    return this.db.packages.find((p) => p.id === id);
  }

  findVersion(packageId: number, version: string): DBVersion | undefined {
    return this.db.versions.find((v) => v.packageId === packageId && v.version === version);
  }

  getVersionsForPackage(packageId: number): DBVersion[] {
    return this.db.versions.filter((v) => v.packageId === packageId);
  }

  getOrCreatePackage(
    name: string,
    registry: RegistryType,
    source: PackageSource,
    scope?: string
  ): number {
    const existing = this.findPackageByName(name, registry);
    if (existing) return existing.id;

    const now = Date.now();
    const id = this.db.nextPackageId++;
    this.db.packages.push({
      id,
      name,
      registry,
      source,
      scope,
      latestVersion: '',
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      totalSize: 0,
      downloadCount: 0,
    });
    this.scheduleSave();
    return id;
  }

  upsertPackageInfo(
    info: Partial<{ name: string; registry: RegistryType; description?: string; author?: string; license?: string; latestVersion?: string; source?: PackageSource; scope?: string }> & { name: string; registry: RegistryType },
    updateTimestamp: boolean = false
  ): void {
    const existing = this.findPackageByName(info.name, info.registry);

    if (existing) {
      if (info.description !== undefined) existing.description = info.description;
      if (info.author !== undefined) existing.author = info.author;
      if (info.license !== undefined) existing.license = info.license;
      if (info.latestVersion !== undefined) existing.latestVersion = info.latestVersion;
      if (info.source !== undefined) existing.source = info.source;
      if (updateTimestamp) existing.updatedAt = Date.now();
    } else {
      this.getOrCreatePackage(info.name, info.registry, info.source || 'cache', info.scope);
    }
    this.scheduleSave();
  }

  registerVersion(
    packageId: number,
    version: string,
    size: number,
    filePath: string,
    sha1?: string,
    isDownload: boolean = false
  ): void {
    const now = Date.now();
    const existing = this.findVersion(packageId, version);

    if (existing) {
      existing.size = size;
      existing.filePath = filePath;
      if (sha1) existing.sha1 = sha1;
      if (isDownload) {
        existing.lastAccessedAt = now;
      }
    } else {
      const id = this.db.nextVersionId++;
      this.db.versions.push({
        id,
        packageId,
        version,
        size,
        filePath,
        sha1,
        publishedAt: isDownload ? now : 0,
        lastAccessedAt: isDownload ? now : 0,
        downloadCount: 0,
      });
    }

    this.recalcPackageSize(packageId);

    const pkg = this.findPackageById(packageId);
    if (pkg && isDownload) {
      pkg.updatedAt = now;
      pkg.lastAccessedAt = now;
    }

    this.scheduleSave();
  }

  recordDownload(packageId: number, version: string): void {
    const now = Date.now();
    const v = this.findVersion(packageId, version);
    if (v) {
      v.downloadCount++;
      v.lastAccessedAt = now;
    }
    const pkg = this.findPackageById(packageId);
    if (pkg) {
      pkg.downloadCount++;
      pkg.lastAccessedAt = now;
    }
    this.scheduleSave();
  }

  private recalcPackageSize(packageId: number): void {
    const pkgVersions = this.getVersionsForPackage(packageId);
    const total = pkgVersions.reduce((s, v) => s + v.size, 0);
    const latest = pkgVersions.sort((a, b) => b.publishedAt - a.publishedAt)[0];

    const pkg = this.findPackageById(packageId);
    if (pkg) {
      pkg.totalSize = total;
      pkg.latestVersion = latest?.version || '';
    }
  }

  deletePackage(name: string, registry: RegistryType): boolean {
    const idx = this.db.packages.findIndex(
      (p) => p.name === name && p.registry === registry
    );
    if (idx < 0) return false;
    const [pkg] = this.db.packages.splice(idx, 1);
    this.db.versions = this.db.versions.filter((v) => v.packageId !== pkg.id);
    this.scheduleSave();
    return true;
  }

  deletePackageVersion(name: string, registry: RegistryType, version: string): boolean {
    const pkg = this.findPackageByName(name, registry);
    if (!pkg) return false;

    const idx = this.db.versions.findIndex(
      (v) => v.packageId === pkg.id && v.version === version
    );
    if (idx < 0) return false;

    this.db.versions.splice(idx, 1);
    this.recalcPackageSize(pkg.id);
    this.scheduleSave();
    return true;
  }

  getCachePolicy(): CachePolicy {
    return { ...this.db.cachePolicy };
  }

  updateCachePolicy(policy: CachePolicy): void {
    this.db.cachePolicy = { ...policy };
    this.scheduleSave();
  }

  saveStorageSnapshotData(stats: { totalSize: number; totalPackages: number }, dateStr: string): void {
    const idx = this.db.storageTrend.findIndex((t) => t.date === dateStr);
    const entry: StorageTrend = {
      date: dateStr,
      size: stats.totalSize,
      packages: stats.totalPackages,
    };
    if (idx >= 0) {
      this.db.storageTrend[idx] = entry;
    } else {
      this.db.storageTrend.push(entry);
    }
    if (this.db.storageTrend.length > 365) {
      this.db.storageTrend = this.db.storageTrend.slice(-365);
    }
    this.scheduleSave();
  }

  close(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.persist();
  }
}
