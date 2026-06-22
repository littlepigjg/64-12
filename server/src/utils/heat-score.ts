export interface HeatScorePolicy {
  frequencyWeight: number;
  recencyWeight: number;
  heatHalfLifeDays: number;
}

export function calculateHeatScore(
  downloadCount: number,
  lastAccessedAt: number,
  maxDownloads: number,
  policy: HeatScorePolicy
): number {
  const now = Date.now();
  const daysSinceAccess = (now - lastAccessedAt) / (24 * 60 * 60 * 1000);

  const frequencyScore = maxDownloads > 0
    ? Math.log(downloadCount + 1) / Math.log(maxDownloads + 1)
    : 0;

  const recencyScore = Math.pow(2, -daysSinceAccess / policy.heatHalfLifeDays);

  const totalWeight = policy.frequencyWeight + policy.recencyWeight;
  if (totalWeight <= 0) return 0;

  const heatScore = (
    policy.frequencyWeight * frequencyScore +
    policy.recencyWeight * recencyScore
  ) / totalWeight;

  return heatScore;
}

export function calculateHeatScores<T>(
  items: T[],
  getDownloadCount: (item: T) => number,
  getLastAccessedAt: (item: T) => number,
  policy: HeatScorePolicy
): Array<T & { heatScore: number }> {
  const maxDownloads = items.reduce(
    (max, item) => Math.max(max, getDownloadCount(item)),
    0
  );

  return items.map((item) => ({
    ...item,
    heatScore: calculateHeatScore(
      getDownloadCount(item),
      getLastAccessedAt(item),
      maxDownloads,
      policy
    ),
  }));
}
