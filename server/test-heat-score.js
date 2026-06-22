
const { getMetadataIndex } = require('./dist/modules/metadata');
const { getCacheStorage } = require('./dist/modules/cache');
const { config } = require('./dist/config');

console.log('=== 热度分数算法测试 ===\n');

const metadata = getMetadataIndex();

const testPackages = [
  { name: 'core-pkg', downloads: 500, daysAgo: 1, desc: '核心包，下载量大，最近使用' },
  { name: 'old-important-pkg', downloads: 300, daysAgo: 60, desc: '旧但重要的包，下载量大，久未使用' },
  { name: 'new-tiny-pkg', downloads: 5, daysAgo: 1, desc: '新的小包，下载少，最近使用' },
  { name: 'abandoned-pkg', downloads: 10, daysAgo: 100, desc: '废弃包，下载少，久未使用' },
  { name: 'medium-pkg', downloads: 50, daysAgo: 30, desc: '中等使用频率的包' },
];

const now = Date.now();
const dayMs = 24 * 60 * 60 * 1000;

console.log('📦 测试包列表：');
console.log('─'.repeat(70));
for (const pkg of testPackages) {
  const pkgId = metadata.getOrCreatePackage(pkg.name, 'npm', 'cache');
  metadata.addVersion(pkgId, '1.0.0', 1024 * 1024, `/tmp/${pkg.name}-1.0.0.tgz`);
  
  const lastAccessedAt = now - pkg.daysAgo * dayMs;
  
  const db = metadata.db || (metadata._db || {});
  const dbPkg = db.packages?.find(p => p.name === pkg.name);
  const dbVer = db.versions?.find(v => v.packageId === pkgId);
  if (dbPkg) {
    dbPkg.downloadCount = pkg.downloads;
    dbPkg.lastAccessedAt = lastAccessedAt;
  }
  if (dbVer) {
    dbVer.downloadCount = pkg.downloads;
    dbVer.lastAccessed