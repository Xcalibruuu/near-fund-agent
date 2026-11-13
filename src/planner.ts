import { SLEEVE_BUY, assetByKey } from "./assets.js";
import { clamp, roundUsd } from "./money.js";
import type { MarkedPosition, PlannedTrade, Policy, QuoteJob, Sleeve, SleeveSnapshot, Venue } from "./types.js";

function tradeUsd(excessUsd: number, deficitUsd: number, policy: Policy): number {
  const raw = Math.min(policy.maxTradeUsd, excessUsd * 0.5, deficitUsd);
  return roundUsd(clamp(raw, 0, policy.maxTradeUsd));
}

function largestInSleeve(positions: MarkedPosition[], sleeve: Sleeve): MarkedPosition | undefined {
  return positions
    .filter((position) => position.asset.sleeve === sleeve && position.valueUsd > 0)
    .sort((a, b) => b.valueUsd - a.valueUsd)[0];
}

export function planAllocation(
  positions: MarkedPosition[],
  sleeves: SleeveSnapshot[],
  policy: Policy,
): PlannedTrade[] {
  const total = positions.reduce((sum, position) => sum + position.valueUsd, 0);
  if (total <= 0) return [];

  const overweight = sleeves
    .filter((sleeve) => sleeve.driftBps > policy.driftBps)
    .sort((a, b) => b.driftBps - a.driftBps);
  const underweight = sleeves
    .filter((sleeve) => sleeve.driftBps < -policy.driftBps)
    .sort((a, b) => a.driftBps - b.driftBps);
  if (overweight.length === 0 || underweight.length === 0) return [];

  const plans: PlannedTrade[] = [];
  for (const dest of underweight.slice(0, 2)) {
    const sourceSleeve = overweight[0];
    if (!sourceSleeve || sourceSleeve.sleeve === dest.sleeve) continue;
    const source = largestInSleeve(positions, sourceSleeve.sleeve);
    if (!source) continue;
    const toKey = SLEEVE_BUY[dest.sleeve];
    if (source.key === toKey) continue;
    const excessUsd = sourceSleeve.drift * total;
    const deficitUsd = Math.abs(dest.drift) * total;
    const usd = tradeUsd(excessUsd, deficitUsd, policy);
    if (usd < policy.minTradeUsd) continue;
    if (source.valueUsd < usd) continue;
    plans.push({
      id: `alloc-${source.key}-${toKey}`,
      fromKey: source.key,
      toKey,
      usd,
      reason: "allocation",
    });
  }
  return plans;
}

export function planYieldRotation(
  positions: MarkedPosition[],
  _sleeves: SleeveSnapshot[],
  venues: Venue[],
  policy: Policy,
): PlannedTrade[] {
  const targets = venues.filter((venue) => venue.role === "target" && venue.assetKey);
  if (targets.length === 0) return [];
  const best = [...targets].sort((a, b) => b.apyPercent - a.apyPercent)[0];
  if (!best?.assetKey) return [];

  let source: MarkedPosition | undefined;
  let edge = 0;
  for (const position of positions) {
    if (position.asset.sleeve !== "STABLE" || position.key === best.assetKey) continue;
    if (position.valueUsd < policy.minTradeUsd) continue;
    const here = targets.find((venue) => venue.assetKey === position.key);
    const apy = here?.apyPercent ?? 0;
    const gap = best.apyPercent - apy;
    if (gap >= policy.minYieldEdgePercent && gap > edge) {
      source = position;
      edge = gap;
    }
  }
  if (!source) return [];
  const usd = roundUsd(Math.min(policy.maxTradeUsd, source.valueUsd * 0.5));
  if (usd < policy.minTradeUsd) return [];
  return [
    {
      id: `yield-${source.key}-${best.assetKey}`,
      fromKey: source.key,
      toKey: best.assetKey,
      usd,
      reason: "yield",
    },
  ];
}

export function quoteJobs(plans: PlannedTrade[], positions: MarkedPosition[], policy: Policy): QuoteJob[] {
  const jobs: QuoteJob[] = [];
  const sources = positions
    .filter((position) => position.valueUsd >= policy.minTradeUsd)
    .map((position) => position.key);

  for (const plan of plans) {
    const keys = new Set<string>([plan.fromKey, ...sources]);
    for (const fromKey of keys) {
      if (fromKey === plan.toKey) continue;
      const from = assetByKey(fromKey);
      const to = assetByKey(plan.toKey);
      if (from.assetId === to.assetId) continue;
      const position = positions.find((row) => row.key === fromKey);
      if (!position || position.valueUsd < Math.min(plan.usd, policy.minTradeUsd)) continue;
      jobs.push({
        id: `${plan.id}:${fromKey}`,
        fromKey,
        toKey: plan.toKey,
        usd: plan.usd,
        purpose: fromKey === plan.fromKey ? "candidate" : "comparison",
        planId: plan.id,
      });
    }
  }
  return jobs;
}
