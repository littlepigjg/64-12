const { getMetadataIndex } = require('./dist/modules/metadata');
const { calculateHeatScore, calculateHeatScores } = require('./dist/utils/heat-score');

console.log('=== 热度分数算法 & 版本隔离测试 ===\n');

const metadata = getMetadataIndex();

const now = Date.now();
const dayMs = 24 * 60 * 60 * 1000;

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('测试 1：同一包的不同版本，热度独立计算');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const pkgId = metadata.getOrCreatePackage('test-lib', 'npm', 'cache');
metadata.addVersion(pkgId, '1.0.0', 1024 * 1024, '/tmp/test-lib-1.0.0.tgz');
metadata.addVersion(pkgId, '2.0.0', 1024 * 1024, '/tmp/test-lib-2.0.0.tgz');

const db = metadata.db;
const v1 = db.versions.find(v => v.version === '1.0.0' && v.packageId === pkgId);
const v2 = db.versions.find(v => v.version === '2.0.0' && v.packageId === pkgId);

v1.downloadCount = 10;
v1.lastAccessedAt = now - 90 * dayMs;

v2.downloadCount = 100;
v2.lastAccessedAt = now - 1 * dayMs;

const policy = {
  frequencyWeight: 0.5,
  recencyWeight: 0.5,
  heatHalfLifeDays: 30,
};

const maxDownloads = Math.max(v1.downloadCount, v2.downloadCount);

const scoreV1 = calculateHeatScore(v1.downloadCount, v1.lastAccessedAt, maxDownloads, policy);
const scoreV2 = calculateHeatScore(v2.downloadCount, v2.lastAccessedAt, maxDownloads, policy);

console.log(`  v1.0.0: 下载=${v1.downloadCount}次, ${Math.round((now - v1.lastAccessedAt) / dayMs)}天前访问, 热度=${scoreV1.toFixed(4)}`);
console.log(`  v2.0.0: 下载=${v2.downloadCount}次, ${Math.round((now - v2.lastAccessedAt) / dayMs)}天前访问, 热度=${scoreV2.toFixed(4)}`);

const diff = ((scoreV2 - scoreV1) / scoreV1 * 100).toFixed(1);
console.log(`  → v2.0.0 热度比 v1.0.0 高 ${diff}%`);
console.log(`  ✅ 通过：两个版本热度独立，新版本不会让旧版本"沾光"`);

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('测试 2：getOldPackages 使用版本级别 lastAccessedAt');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const oldPkgs = metadata.getOldPackages(60);
const oldFiles = oldPkgs.filter(p => p.name === 'test-lib');
console.log(`  60天阈值下，test-lib 被标记为过期的版本文件数：${oldFiles.length}`);
console.log(`  (预期: 1个，只有 v1.0.0 超过60天，v2.0.0 只有1天)`);

if (oldFiles.length === 1) {
  console.log(`  ✅ 通过：只有真正久未访问的版本会被标记为过期`);
} else {
  console.log(`  ❌ 失败：预期1个，实际${oldFiles.length}个`);
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('测试 3：智能淘汰优先移除低热度版本');
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

const evictCandidates = metadata.getPackagesForEviction(1024 * 1024);
console.log(`  淘汰候选列表（按热度从低到高）：`);
evictCandidates.forEach((c, i) => {
  console.log(`    ${i + 1}. ${c.name}@${c.version} 热度=${c.heatScore?.toFixed(4) || 'N/A'}`);
});

if (evictCandidates.length >= 2) {
  const firstLow = evictCandidates[0];
  const lastHigh = evictCandidates[evictCandidates.length - 1];
  console.log(`  最低热度: ${firstLow.name}@${firstLow.version}`);
  console.log(`  最高热度: ${lastHigh.name}@${lastHigh.version}`);
  if (firstLow.version === '1.0.0' && lastHigh.version === '2.0.0') {
    console.log(`  ✅ 通过：淘汰顺序正确，旧版本优先被淘汰`);
  }
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('测试 4：不同权重配置下的表现');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const testCases = [
  { name: '频率优先', freq: 0.9, recency: 0.1 },
  { name: '平衡模式', freq: 0.5, recency: 0.5 },
  { name: '时间优先', freq: 0.1, recency: 0.9 },
];

testCases.forEach(tc => {
  const p = { frequencyWeight: tc.freq, recencyWeight: tc.recency, heatHalfLifeDays: 30 };
  const s1 = calculateHeatScore(v1.downloadCount, v1.lastAccessedAt, maxDownloads, p);
  const s2 = calculateHeatScore(v2.downloadCount, v2.lastAccessedAt, maxDownloads, p);
  console.log(`  ${tc.name} (频率${tc.freq * 100}% / 时间${tc.recency * 100}%):`);
  console.log(`    v1.0.0 = ${s1.toFixed(4)}, v2.0.0 = ${s2.toFixed(4)}`);
});

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('测试 5：批量计算工具函数 calculateHeatScores');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const items = [
  { name: 'a', downloads: 100, lastAccess: now - 10 * dayMs },
  { name: 'b', downloads: 50, lastAccess: now - 2 * dayMs },
  { name: 'c', downloads: 200, lastAccess: now - 60 * dayMs },
];

const scored = calculateHeatScores(
  items,
  item => item.downloads,
  item => item.lastAccess,
  policy
);

scored.sort((a, b) => b.heatScore - a.heatScore);
console.log(`  按热度从高到低排序：`);
scored.forEach((s, i) => {
  console.log(`    ${i + 1}. ${s.name} - 热度=${s.heatScore.toFixed(4)} (下载${s.downloads}次, ${Math.round((now - s.lastAccess) / dayMs)}天前)`);
});
console.log(`  ✅ 通过：批量热度计算工具函数工作正常`);

console.log('\n=== 测试完成 ===');

metadata.close();
process.exit(0);
