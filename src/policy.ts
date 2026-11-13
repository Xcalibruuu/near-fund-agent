import type { Policy, Sleeve } from "./types.js";

export const DEFAULT_POLICY: Policy = {
  targets: {
    NEAR: 0.25,
    BNB: 0.2,
    SOL: 0.2,
    STABLE: 0.35,
  },
  driftBps: 400,
  minTradeUsd: 50,
  maxTradeUsd: 320,
  maxQuoteLossBps: 150,
  maxApyPercent: 25,
  minTvlUsd: 1_000_000,
  minYieldEdgePercent: 1.5,
  yieldHorizonDays: 45,
};

export function assertPolicy(policy: Policy): void {
  const sum = (Object.keys(policy.targets) as Sleeve[]).reduce(
    (acc, sleeve) => acc + policy.targets[sleeve],
    0,
  );
  if (Math.abs(sum - 1) > 0.001) {
    throw new Error(`Policy targets must sum to 1, got ${sum}`);
  }
  if (policy.minTradeUsd <= 0 || policy.maxTradeUsd < policy.minTradeUsd) {
    throw new Error("Trade size bounds are inconsistent");
  }
  if (policy.maxQuoteLossBps <= 0 || policy.yieldHorizonDays <= 0) {
    throw new Error("Policy limits must be positive");
  }
}
