const { getMetadataIndex } = require('./dist/modules/metadata');
const { calculateHeatScore, calculateHeatScores } = require('./dist/utils/heat-score');

console.log('=== 版本访问隔离 & 包/版本时间字段分离测试 ===\n');

const metadata = getMetadataIndex();
const now = Date.now();
const dayMs = 24 * 60 * 60 * 1000;

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('测试 1：元数据同步 (isDownload=false) 完全不碰时间字段');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const pkgId = metadata.getOrCreatePackage('sync-only-lib', 'npm', 'cache');
const pkgCreateTime = metadata.findPackageById(pkgId).updatedAt;
console.log(`  包创建时间: ${pkgCreateTime}`);

metadata.registerVersion(pkgId, '1.0.0', 1024, '/tmp/sync-1.0.0.tgz', undefined, false);
metadata.registerVersion(pkgId, '2.0.0', 2048, '/tmp/sync-2.0.0.tgz', undefined, false);

const db = metadata.db;
const pkg = db.packages.find(p => p.name === 'sync-only-lib');
const v1 = db.versions.find(v => v.version === '1.0.0' && v.packageId === pkgId);
const v2 = db.versions.find(v => v.version === '2.0.0' && v.packageId === pkgId);

console.log(`  包级别 updatedAt: ${pkg.updatedAt} (创建后${pkg.updatedAt === pkgCreateTime ? '未变' : '改变了'})`);
console.log(`  v1.0.0: publishedAt=${v1.publishedAt}, lastAccessedAt=${v1.lastAccessedAt}`);
console.log(`  v2.0.0: publishedAt=${v2.publishedAt}, lastAccessedAt=${v2.lastAccessedAt}`);

let pass1 = true;
if (pkg.updatedAt !== pkgCreateTime) {
  console.log('  ❌ 失败：元数据同步不应改变包的 updatedAt');
  pass1 = false;
}
if (v1.lastAccessedAt !== 0 || v2.lastAccessedAt !== 0) {
  console.log('  ❌ 失败：元数据同步的版本 lastAccessedAt 应为 0');
  pass1 = false;
}
if (v1.publishedAt !== 0 || v2.publishedAt !== 0) {
  console.log('  ❌ 失败：元数据同步的版本 publishedAt 应为 0');
  pass1 = false;
}
if (pass1) console.log('  ✅ 通过：元数据同步完全不碰任何时间字段');

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('测试 2：实际下载 (isDownload=true) 正确更新包和版本的时间');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

metadata.registerVersion(pkgId, '3.0.0', 4096, '/tmp/sync-3.0.0.tgz', undefined, true);

const v3 = db.versions.find(v => v.version === '3.0.0' && v.packageId === pkgId);
const pkgAfterDownload = db.packages.find(p => p.name === 'sync-only-lib');

console.log(`  v3.0.0: publishedAt=${v3.publishedAt}, lastAccessedAt=${v3.lastAccessedAt}`);
console.log(`  包级别 updatedAt: ${pkgAfterDownload.updatedAt}`);
console.log(`  包级别 lastAccessedAt: ${pkgAfterDownload.lastAccessedAt}`);

let pass2 = true;
if (v3.publishedAt <= 0) { console.log('  ❌ 失败：isDownload=true 的版本 publishedAt 应大于 0'); pass2 = false; }
if (v3.lastAccessedAt <= 0) { console.log('  ❌ 失败：isDownload=true 的版本 lastAccessedAt 应大于 0'); pass2 = false; }
if (pkgAfterDownload.updatedAt !== pkgAfterDownload.lastAccessedAt) {
  console.log('  ❌ 失败：下载后包的 updatedAt 和 lastAccessedAt 应同步更新');
  pass2 = false;
}
if (pass2) console.log('  ✅ 通过：实际下载正确更新了包和版本的所有时间字段');

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('测试 3：新版本下载不会连带更新旧版本的访问时间');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const v1Before = v1.lastAccessedAt;
metadata.recordDownload(pkgId, '3.0.0');
const v1After = db.versions.find(v => v.version === '1.0.0' && v.packageId === pkgId).lastAccessedAt;
const v3After = db.versions.find(v => v.version === '3.0.0' && v.packageId === pkgId).lastAccessedAt;

console.log(`  下载 v3.0.0 后:`);
console.log(`    v1.0.0 lastAccessedAt: ${v1After} (之前: ${v1Before})`);
console.log(`    v3.0.0 lastAccessedAt: ${v3After}`);

if (v1After === v1Before && v1After === 0 && v3After > 0) {
  console.log('  ✅ 通过：旧版本的访问时间完全不受新版本下载影响');
} else {
  console.log('  ❌ 失败：旧版本访问时间不应因新版本下载而改变');
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('测试 4：time-based 淘汰使用版本级别数据，旧版本优先淘汰');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const tbpkgId = metadata.getOrCreatePackage('timebased-test', 'npm', 'cache');
metadata.registerVersion(tbpkgId, 'old-v1', 1024 * 1024, '/tmp/old-v1.tgz', undefined, true);
metadata.recordDownload(tbpkgId, 'old-v1');

metadata.registerVersion(tbpkgId, 'new-v2', 2048 * 1024, '/tmp/new-v2.tgz', undefined, true);
metadata.recordDownload(tbpkgId, 'new-v2');

metadata.db.versions.find(v => v.version === 'old-v1' && v.packageId === tbpkgId).lastAccessedAt = now - 180 * dayMs;
metadata.db.versions.find(v => v.version === 'new-v2' && v.packageId === tbpkgId).lastAccessedAt = now - 1 * dayMs;

metadata.updateCachePolicy({
  maxSizeGB: 50,
  maxAgeDays: 0,
  autoClean: true,
  evictionStrategy: 'time-based',
  frequencyWeight: 0.5,
  recencyWeight: 0.5,
  heatHalfLifeDays: 30,
});

const evictCandidates = metadata.getPackagesForEviction(10 * 1024 * 1024);
const tbCandidates = evictCandidates.filter(c => c.name === 'timebased-test');

console.log(`  time-based 淘汰排序（优先级从高到低）：`);
tbCandidates.forEach((c, i) => {
  const v = metadata.db.versions.find(v => v.version === c.version && v.packageId === tbpkgId);
  const status = v.lastAccessedAt === 0 ? '从未访问' : `${Math.round((now - v.lastAccessedAt) / dayMs)}天前`;
  console.log(`    ${i + 1}. ${c.version} (下载${v.downloadCount}次, ${status})`);
});

if (tbCandidates.length >= 2 && tbCandidates[0].version === 'old-v1' && tbCandidates[1].version === 'new-v2') {
  console.log('  ✅ 通过：time-based 策略正确按版本级别访问时间排序，旧版本优先淘汰');
} else {
  console.log('  ❌ 失败：old-v1 应排在最前（180天前访问），new-v2 应在后（1天前）');
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('测试 5：time-based 策略中，从未访问的版本最优先淘汰');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

metadata.registerVersion(tbpkgId, 'never-used', 512 * 1024, '/tmp/never-used.tgz', undefined, false);

const evictCandidates2 = metadata.getPackagesForEviction(10 * 1024 * 1024);
const tbCandidates2 = evictCandidates2.filter(c => c.name === 'timebased-test');

console.log(`  加入从未访问的版本后，淘汰排序（优先级从高到低）：`);
tbCandidates2.forEach((c, i) => {
  const v = metadata.db.versions.find(v => v.version === c.version && v.packageId === tbpkgId);
  const status = v.lastAccessedAt === 0 ? '从未访问' : `${Math.round((now - v.lastAccessedAt) / dayMs)}天前`;
  console.log(`    ${i + 1}. ${c.version} (${status})`);
});

if (tbCandidates2.length >= 1 && tbCandidates2[0].version === 'never-used') {
  console.log('  ✅ 通过：从未被访问的版本在 time-based 策略中最优先被淘汰');
} else {
  console.log('  ❌ 失败：never-used 版本应排在最前（从未被访问，优先级最高）');
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('测试 6：元数据同步不会更新包的 updatedAt');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const pkgId2 = metadata.getOrCreatePackage('metadata-sync-test', 'npm', 'cache');
const updatedAtBefore = metadata.findPackageById(pkgId2).updatedAt;

metadata.upsertPackageInfo({
  name: 'metadata-sync-test',
  registry: 'npm',
  description: '测试描述更新',
  latestVersion: '2.0.0',
  source: 'cache',
}, false);

const updatedAtAfter = metadata.findPackageById(pkgId2).updatedAt;

console.log(`  upsertPackageInfo 前 updatedAt: ${updatedAtBefore}`);
console.log(`  upsertPackageInfo 后 updatedAt: ${updatedAtAfter}`);

if (updatedAtBefore === updatedAtAfter) {
  console.log('  ✅ 通过：元数据同步 (updateTimestamp=false) 不会更新 updatedAt');
} else {
  console.log('  ❌ 失败：updateTimestamp=false 时 updatedAt 不应改变');
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('测试 7：热度模式也正确使用版本级别数据');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

metadata.updateCachePolicy({
  maxSizeGB: 50,
  maxAgeDays: 0,
  autoClean: true,
  evictionStrategy: 'heat-based',
  frequencyWeight: 0.5,
  recencyWeight: 0.5,
  heatHalfLifeDays: 30,
});

const heatCandidates = metadata.getPackagesForEviction(10 * 1024 * 1024);
const heatTb = heatCandidates.filter(c => c.name === 'timebased-test');

console.log(`  热度模式淘汰排序（热度从低到高）：`);
heatTb.forEach((c, i) => {
  console.log(`    ${i + 1}. ${c.version} 热度=${c.heatScore?.toFixed(4) || 'N/A'}`);
});

let heatPass = true;
if (heatTb.length < 3) { console.log('  ❌ 失败：应有3个版本'); heatPass = false; }
else if (heatTb[0].version !== 'never-used') {
  console.log('  ❌ 失败：never-used 版本热度应最低（=0）');
  heatPass = false;
} else if (heatTb[0].heatScore !== 0) {
  console.log('  ❌ 失败：从未访问的版本热度应为 0');
  heatPass = false;
}
if (heatPass) console.log('  ✅ 通过：热度模式也正确使用版本级别数据，从未访问的版本热度为0');

console.log('\n=== 所有测试完成 ===');

metadata.close();
process.exit(0);
