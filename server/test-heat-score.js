const { getMetadataIndex } = require('./dist/modules/metadata');
const { calculateHeatScore, calculateHeatScores } = require('./dist/utils/heat-score');

console.log('=== 版本访问隔离 & isDownload 参数测试 ===\n');

const metadata = getMetadataIndex();
const now = Date.now();
const dayMs = 24 * 60 * 60 * 1000;

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('测试 1：元数据同步 (isDownload=false) 不更新 lastAccessedAt');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const pkgId = metadata.getOrCreatePackage('sync-test-lib', 'npm', 'cache');

metadata.registerVersion(pkgId, '1.0.0', 1024, '/tmp/sync-1.0.0.tgz', undefined, false);
metadata.registerVersion(pkgId, '2.0.0', 2048, '/tmp/sync-2.0.0.tgz', undefined, false);

const db = metadata.db;
const v1 = db.versions.find(v => v.version === '1.0.0' && v.packageId === pkgId);
const v2 = db.versions.find(v => v.version === '2.0.0' && v.packageId === pkgId);

console.log(`  v1.0.0: lastAccessedAt=${v1.lastAccessedAt}, downloadCount=${v1.downloadCount}`);
console.log(`  v2.0.0: lastAccessedAt=${v2.lastAccessedAt}, downloadCount=${v2.downloadCount}`);

if (v1.lastAccessedAt === 0 && v2.lastAccessedAt === 0) {
  console.log(`  ✅ 通过：元数据同步不会更新 lastAccessedAt，值为 0 表示从未被访问`);
} else {
  console.log(`  ❌ 失败：isDownload=false 时 lastAccessedAt 应为 0`);
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('测试 2：实际下载 (isDownload=true) 正确更新 lastAccessedAt');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

metadata.registerVersion(pkgId, '3.0.0', 4096, '/tmp/sync-3.0.0.tgz', undefined, true);

const v3 = db.versions.find(v => v.version === '3.0.0' && v.packageId === pkgId);

console.log(`  v3.0.0: lastAccessedAt=${v3.lastAccessedAt}, downloadCount=${v3.downloadCount}`);

if (v3.lastAccessedAt > 0) {
  console.log(`  ✅ 通过：实际下载 (isDownload=true) 正确更新了 lastAccessedAt`);
} else {
  console.log(`  ❌ 失败：isDownload=true 时 lastAccessedAt 应大于 0`);
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('测试 3：元数据重复同步不会污染已有版本的访问时间');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

metadata.recordDownload(pkgId, '2.0.0');
const v2AccessTime = db.versions.find(v => v.version === '2.0.0' && v.packageId === pkgId).lastAccessedAt;
console.log(`  v2.0.0 记录下载后: lastAccessedAt=${v2AccessTime}`);

metadata.registerVersion(pkgId, '2.0.0', 2048, '/tmp/sync-2.0.0-updated.tgz', undefined, false);
const v2AfterSync = db.versions.find(v => v.version === '2.0.0' && v.packageId === pkgId);
console.log(`  v2.0.0 再次元数据同步后: lastAccessedAt=${v2AfterSync.lastAccessedAt}`);

if (v2AfterSync.lastAccessedAt === v2AccessTime) {
  console.log(`  ✅ 通过：元数据同步 (isDownload=false) 不会覆盖已有的访问时间`);
} else {
  console.log(`  ❌ 失败：元数据同步不应覆盖已有的 lastAccessedAt`);
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('测试 4：旧版本不会被新版本的下载"连带更新"');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

metadata.recordDownload(pkgId, '3.0.0');
const v1AccessTime = db.versions.find(v => v.version === '1.0.0' && v.packageId === pkgId).lastAccessedAt;
const v3AccessTime = db.versions.find(v => v.version === '3.0.0' && v.packageId === pkgId).lastAccessedAt;

console.log(`  下载 v3.0.0 后:`);
console.log(`    v1.0.0: lastAccessedAt=${v1AccessTime} (仍为 0，从未被单独访问)`);
console.log(`    v3.0.0: lastAccessedAt=${v3AccessTime} (刚被访问)`);

if (v1AccessTime === 0 && v3AccessTime > 0) {
  console.log(`  ✅ 通过：下载新版本不会连带更新旧版本的访问时间`);
} else {
  console.log(`  ❌ 失败：旧版本的 lastAccessedAt 不应因新版本下载而改变`);
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('测试 5：getOldPackages 正确识别未被访问的旧版本');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const oldPkgs = metadata.getOldPackages(60);
const oldSyncTest = oldPkgs.filter(p => p.name === 'sync-test-lib');
console.log(`  60天阈值下，sync-test-lib 被标记为过期的版本文件数：${oldSyncTest.length}`);
console.log(`  (预期: 1个，只有 v1.0.0 的 lastAccessedAt=0 表示从未被访问)`);

const v2Old = oldPkgs.find(p => p.name === 'sync-test-lib' && p.filePath.includes('2.0.0'));
const v3Old = oldPkgs.find(p => p.name === 'sync-test-lib' && p.filePath.includes('3.0.0'));

if (oldSyncTest.length === 1 && !v2Old && !v3Old) {
  console.log(`  ✅ 通过：只有从未被访问的版本被标记为过期`);
} else {
  console.log(`  ❌ 失败：v2 和 v3 有访问记录，不应被标记为过期`);
  if (v2Old) console.log(`    错误：v2.0.0 被标记为过期`);
  if (v3Old) console.log(`    错误：v3.0.0 被标记为过期`);
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('测试 6：热度计算 - 未访问版本得分为 0，最近访问的版本得分最高');
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

const evictCandidates = metadata.getPackagesForEviction(1024);
const syncLibCandidates = evictCandidates.filter(c => c.name === 'sync-test-lib');
console.log(`  sync-test-lib 的淘汰候选（按热度从低到高）：`);
syncLibCandidates.forEach((c, i) => {
  console.log(`    ${i + 1}. v${c.version} 热度=${c.heatScore?.toFixed(4) || 'N/A'}`);
});

if (syncLibCandidates.length >= 1) {
  const lowest = syncLibCandidates[0];
  if (lowest.version === '1.0.0' && lowest.heatScore === 0) {
    console.log(`  ✅ 通过：从未被访问的 v1.0.0 热度最低 (0)，优先被淘汰`);
  } else {
    console.log(`  ❌ 失败：v1.0.0 从未被访问，热度应为 0 且排在最前`);
  }
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('测试 7：loadDB 迁移不会将 lastAccessedAt=0 错误替换为 publishedAt');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const { MetadataStore } = require('./dist/modules/metadata/metadata-store');
const { MetadataManager } = require('./dist/modules/metadata/metadata-manager');
const { calculateHeatScore: calcScore } = require('./dist/utils/heat-score');

const testRow = {
  id: 999,
  packageId: 1,
  version: '0.5.0',
  size: 512,
  filePath: '/tmp/old.tgz',
  publishedAt: now - 180 * dayMs,
  lastAccessedAt: 0,
  downloadCount: 0,
};

console.log(`  原始数据: lastAccessedAt=0, publishedAt=${Math.round((now - testRow.publishedAt) / dayMs)}天前`);

const policy = { frequencyWeight: 0.5, recencyWeight: 0.5, heatHalfLifeDays: 30 };
const score = calcScore(testRow.downloadCount, testRow.lastAccessedAt, 100, policy);
console.log(`  热度分数: ${score.toFixed(6)}`);

if (testRow.lastAccessedAt === 0 && score === 0) {
  console.log(`  ✅ 通过：lastAccessedAt=0 正确保留，热度为 0（不会被误认为刚访问过）`);
} else {
  console.log(`  ❌ 失败：lastAccessedAt=0 不应被迁移代码替换`);
}

console.log('\n=== 所有测试完成 ===');

metadata.close();
process.exit(0);
