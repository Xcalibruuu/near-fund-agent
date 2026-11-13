import type { LlamaPool, Policy, Venue } from "./types.js";

type Want = {
  id: string;
  chain: string;
  project: string;
  symbol: string;
  assetKey: string;
};

const TARGETS: Want[] = [
  { id: "rhea-usdt", chain: "Near", project: "rhea-lend", symbol: "USDT", assetKey: "nearUsdt" },
  { id: "kamino-usdc", chain: "Solana", project: "kamino-lend", symbol: "USDC", assetKey: "solUsdc" },
  { id: "kamino-sol", chain: "Solana", project: "kamino-lend", symbol: "SOL", assetKey: "sol" },
];

function usable(pool: LlamaPool, policy: Policy): boolean {
  const tvl = pool.tvlUsd ?? 0;
  const apy = pool.apy ?? Number.NaN;
  return tvl >= policy.minTvlUsd && Number.isFinite(apy) && apy >= 0 && apy <= policy.maxApyPercent && pool.outlier !== true;
}

export function selectVenues(pools: LlamaPool[], policy: Policy): Venue[] {
  const venues: Venue[] = [];
  for (const want of TARGETS) {
    const match = pools
      .filter(
        (pool) =>
          pool.chain === want.chain &&
          pool.project === want.project &&
          pool.symbol === want.symbol &&
          usable(pool, policy),
      )
      .sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0))[0];
    if (!match) continue;
    venues.push({
      id: want.id,
      chain: match.chain,
      project: match.project,
      symbol: match.symbol,
      apyPercent: match.apy ?? 0,
      tvlUsd: match.tvlUsd ?? 0,
      pool: match.pool ?? "",
      role: "target",
      assetKey: want.assetKey,
    });
  }
  return venues;
}

/** BSC inventory-pair fee APR. Shown beside the book, never used as a target. */
export function selectContextPool(pools: LlamaPool[]): Venue | null {
  const match = pools
    .filter((pool) => {
      const chain = pool.chain.toLowerCase();
      const symbol = pool.symbol.toUpperCase();
      const tvl = pool.tvlUsd ?? 0;
      const bsc = chain === "bsc" || chain === "binance" || chain === "bnb";
      const pair = symbol.includes("USDT") && (symbol.includes("WBNB") || symbol.includes("BNB"));
      return bsc && pair && tvl >= 500_000 && Number.isFinite(pool.apy ?? Number.NaN);
    })
    .sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0))[0];
  if (!match) return null;
  return {
    id: "bsc-inventory-context",
    chain: match.chain,
    project: match.project,
    symbol: match.symbol,
    apyPercent: match.apy ?? 0,
    tvlUsd: match.tvlUsd ?? 0,
    pool: match.pool ?? "",
    role: "context",
  };
}
