/**
 * Stellar fee estimation service.
 * Fetches fee stats from Horizon and provides tiered fee estimates.
 */

interface FeeStats {
  min: number;
  mode: number;
  p50: number;
  p95: number;
  p99: number;
  lastLedger: number;
  max: number;
}

interface CachedFeeStats {
  stats: FeeStats;
  fetchedAt: number;
}

const HORIZON_FEE_STATS_URL = "https://horizon.stellar.org/fee_stats";
const CACHE_DURATION_MS = 60_000; // 60 seconds

let cachedStats: CachedFeeStats | null = null;

export async function getFeeStats(): Promise<FeeStats> {
  if (cachedStats && Date.now() - cachedStats.fetchedAt < CACHE_DURATION_MS) {
    return cachedStats.stats;
  }

  const response = await fetch(HORIZON_FEE_STATS_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch fee stats: ${response.statusText}`);
  }

  const data = await response.json();
  const stats: FeeStats = {
    min: data.min_accepted_fee || 100,
    mode: data.fee_charged?.mode || 100,
    p50: data.fee_charged?.p50 || 100,
    p95: data.fee_charged?.p95 || 100,
    p99: data.fee_charged?.p99 || 100,
    lastLedger: data.last_ledger || 0,
    max: data.max_fee?.max || 1000,
  };

  cachedStats = { stats, fetchedAt: Date.now() };
  return stats;
}

export function clearFeeStatsCache(): void {
  cachedStats = null;
}

export type FeeTier = "economy" | "standard" | "priority";

export function estimateTransactionFee(operationCount: number, feePerOp: number): string {
  const stroops = BigInt(feePerOp) * BigInt(operationCount);
  // Convert stroops to XLM (1 XLM = 10,000,000 stroops)
  const xlm = Number(stroops) / 10_000_000;
  return xlm.toFixed(7);
}

export function getFeeForTier(stats: FeeStats, tier: FeeTier): number {
  switch (tier) {
    case "economy":
      return stats.p50;
    case "standard":
      return stats.p95;
    case "priority":
      return stats.p99;
    default:
      return stats.p95;
  }
}

export function formatFeeStroopsToXlm(stroops: number): string {
  return (stroops / 10_000_000).toFixed(7);
}

export const FEE_TIER_LABELS: Record<FeeTier, string> = {
  economy: "Economy",
  standard: "Standard",
  priority: "Priority",
};
