import { describe, expect, it } from "vitest";
import { INITIAL_BOOK } from "../src/book.js";
import { daysToEarnFee, decideLegs } from "../src/decide.js";
import { applyPaperFills } from "../src/decide.js";
import { explainCycle } from "../src/explain.js";
import { markBook, sleeveSnapshots, totalValue } from "../src/portfolio.js";
import { planAllocation, planYieldRotation } from "../src/planner.js";
import { DEFAULT_POLICY } from "../src/policy.js";
import { buildDryQuoteRequest, scoreQuoteResponse } from "../src/intents.js";
import { buildLiveQuoteRequest } from "../src/live-quote.js";
import { liveQuoteAllowed } from "../src/live-gate.js";
import { selectContextPool, selectVenues } from "../src/yields.js";
import { runCycle } from "../src/cycle.js";
import type { LlamaPool, QuoteJob, ScoredQuote, SleeveSnapshot, TokenPrice, Venue } from "../src/types.js";

const PRICES: TokenPrice[] = [
  { assetId: "nep141:wrap.near", symbol: "wNEAR", blockchain: "near", decimals: 24, priceUsd: 3.5 },
  { assetId: "nep141:usdt.tether-token.near", symbol: "USDT", blockchain: "near", decimals: 6, priceUsd: 1 },
  { assetId: "nep141:bnb.omdep.near", symbol: "BNB", blockchain: "bsc", decimals: 18, priceUsd: 600 },
  {
    assetId: "nep141:bnb-0x55d398326f99059ff775485246999027b3197955.omdep.near",
    symbol: "USDT",
    blockchain: "bsc",
    decimals: 18,
    priceUsd: 1,
  },
  {
    assetId: "nep141:bnb-0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d.omdep.near",
    symbol: "USDC",
    blockchain: "bsc",
    decimals: 18,
    priceUsd: 1,
  },
  { assetId: "nep141:sol.omft.near", symbol: "SOL", blockchain: "sol", decimals: 9, priceUsd: 80 },
  {
    assetId: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near",
    symbol: "USDC",
    blockchain: "sol",
    decimals: 6,
    priceUsd: 1,
  },
];

function quote(partial: {
  id?: string;
  fromKey: string;
  toKey: string;
  loss: number;
  usd?: number;
  purpose?: "candidate" | "comparison";
  planId?: string;
}): ScoredQuote {
  const loss = partial.loss;
  return {
    id: partial.id ?? `${partial.fromKey}-${partial.toKey}`,
    fromKey: partial.fromKey,
    toKey: partial.toKey,
    usd: partial.usd ?? 320,
    purpose: partial.purpose ?? "candidate",
    planId: partial.planId ?? "alloc",
    result: {
      ok: true,
      amountInFormatted: partial.fromKey === "wNEAR" ? "90" : "320",
      amountOutFormatted: partial.toKey === "sol" ? "3.9" : "0.52",
      amountInUsd: 320,
      amountOutUsd: 320 * (1 - loss / 10_000),
      timeEstimateSec: 20,
      lossBps: loss,
      hadDepositAddress: false,
    },
  };
}

const overweight: SleeveSnapshot[] = [
  { sleeve: "NEAR", valueUsd: 2800, weight: 0.6, target: 0.25, drift: 0.35, driftBps: 3500 },
  { sleeve: "BNB", valueUsd: 200, weight: 0.05, target: 0.2, drift: -0.15, driftBps: -1500 },
  { sleeve: "SOL", valueUsd: 150, weight: 0.03, target: 0.2, drift: -0.17, driftBps: -1700 },
  { sleeve: "STABLE", valueUsd: 1400, weight: 0.32, target: 0.35, drift: -0.03, driftBps: -300 },
];

describe("allocation", () => {
  it("sells the heavy NEAR sleeve into thin BNB and SOL inventory", () => {
    const positions = markBook(INITIAL_BOOK, PRICES);
    const sleeves = sleeveSnapshots(positions, DEFAULT_POLICY);
    expect(totalValue(positions)).toBeGreaterThan(4000);
    const near = sleeves.find((sleeve) => sleeve.sleeve === "NEAR");
    expect(near && near.driftBps).toBeGreaterThan(DEFAULT_POLICY.driftBps);
    const plans = planAllocation(positions, sleeves, DEFAULT_POLICY);
    expect(plans.map((plan) => plan.toKey).sort()).toEqual(["bnb", "sol"]);
    expect(plans.every((plan) => plan.fromKey === "wNEAR")).toBe(true);
    expect(plans.every((plan) => plan.usd === DEFAULT_POLICY.maxTradeUsd)).toBe(true);
  });

  it("holds when every sleeve is inside the band", () => {
    const book = [
      { key: "wNEAR", amount: "100" },
      { key: "nearUsdt", amount: "200" },
      { key: "bnb", amount: "0.5" },
      { key: "bscUsdt", amount: "100" },
      { key: "bscUsdc", amount: "50" },
      { key: "sol", amount: "3.5" },
      { key: "solUsdc", amount: "150" },
    ];
    const positions = markBook(book, PRICES);
    const sleeves = sleeveSnapshots(positions, DEFAULT_POLICY);
    expect(sleeves.every((sleeve) => Math.abs(sleeve.driftBps) < DEFAULT_POLICY.driftBps)).toBe(true);
    expect(planAllocation(positions, sleeves, DEFAULT_POLICY)).toEqual([]);
  });
});

describe("decide", () => {
  it("declines a cheaper quote that would spend an underweight sleeve", () => {
    const plans = [{ id: "alloc", fromKey: "wNEAR", toKey: "sol", usd: 320, reason: "allocation" as const }];
    const quotes = [
      quote({ id: "near", fromKey: "wNEAR", toKey: "sol", loss: 110, purpose: "candidate", planId: "alloc" }),
      quote({ id: "usdt", fromKey: "nearUsdt", toKey: "sol", loss: 30, purpose: "comparison", planId: "alloc" }),
    ];
    const [leg] = decideLegs(plans, quotes, overweight, [], DEFAULT_POLICY);
    expect(leg?.chosen?.id).toBe("near");
    expect(leg?.rejected.some((row) => row.quote.id === "usdt" && /not an overweight sleeve/.test(row.why))).toBe(true);
  });

  it("holds when the only eligible quote is too expensive", () => {
    const plans = [{ id: "alloc", fromKey: "wNEAR", toKey: "sol", usd: 320, reason: "allocation" as const }];
    const quotes = [quote({ fromKey: "wNEAR", toKey: "sol", loss: 240, planId: "alloc" })];
    const [leg] = decideLegs(plans, quotes, overweight, [], DEFAULT_POLICY);
    expect(leg?.chosen).toBeNull();
    expect(leg?.holdReason).toMatch(/240 bps/);
  });

  it("discards a dry quote that somehow includes a deposit address", () => {
    const scored = quote({ fromKey: "wNEAR", toKey: "sol", loss: 40, planId: "alloc" });
    if (scored.result.ok) scored.result.hadDepositAddress = true;
    const [leg] = decideLegs(
      [{ id: "alloc", fromKey: "wNEAR", toKey: "sol", usd: 320, reason: "allocation" }],
      [scored],
      overweight,
      [],
      DEFAULT_POLICY,
    );
    expect(leg?.chosen).toBeNull();
    expect(leg?.rejected[0]?.why).toMatch(/deposit address/);
  });

  it("applies paper fills and refuses to go negative", () => {
    const chosen = quote({ fromKey: "wNEAR", toKey: "sol", loss: 80, planId: "alloc" });
    const next = applyPaperFills(INITIAL_BOOK, [
      {
        plan: { id: "alloc", fromKey: "wNEAR", toKey: "sol", usd: 320, reason: "allocation" },
        chosen,
        rejected: [],
      },
    ]);
    expect(next.find((row) => row.key === "wNEAR")?.amount).toBe("730");
    expect(next.find((row) => row.key === "sol")?.amount).toBe("5.7");
  });
});

describe("yield rotation", () => {
  const venues: Venue[] = [
    {
      id: "rhea-usdt",
      chain: "Near",
      project: "rhea-lend",
      symbol: "USDT",
      apyPercent: 2,
      tvlUsd: 2_000_000,
      pool: "a",
      role: "target",
      assetKey: "nearUsdt",
    },
    {
      id: "kamino-usdc",
      chain: "Solana",
      project: "kamino-lend",
      symbol: "USDC",
      apyPercent: 8,
      tvlUsd: 40_000_000,
      pool: "b",
      role: "target",
      assetKey: "solUsdc",
    },
  ];
  const flat: SleeveSnapshot[] = [
    { sleeve: "NEAR", valueUsd: 1, weight: 0.25, target: 0.25, drift: 0, driftBps: 0 },
    { sleeve: "BNB", valueUsd: 1, weight: 0.2, target: 0.2, drift: 0, driftBps: 0 },
    { sleeve: "SOL", valueUsd: 1, weight: 0.2, target: 0.2, drift: 0, driftBps: 0 },
    { sleeve: "STABLE", valueUsd: 1, weight: 0.35, target: 0.35, drift: 0, driftBps: 0 },
  ];

  it("moves stables toward the better venue when the fee pays back in time", () => {
    const positions = markBook(
      [
        { key: "wNEAR", amount: "0" },
        { key: "nearUsdt", amount: "400" },
        { key: "bnb", amount: "0" },
        { key: "bscUsdt", amount: "0" },
        { key: "bscUsdc", amount: "0" },
        { key: "sol", amount: "0" },
        { key: "solUsdc", amount: "100" },
      ],
      PRICES,
    );
    const plans = planYieldRotation(positions, flat, venues, DEFAULT_POLICY);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.fromKey).toBe("nearUsdt");
    expect(plans[0]?.toKey).toBe("solUsdc");
    const cheap = quote({ fromKey: "nearUsdt", toKey: "solUsdc", loss: 40, planId: plans[0]!.id, purpose: "candidate" });
    const [taken] = decideLegs(plans, [cheap], flat, venues, DEFAULT_POLICY);
    expect(taken?.chosen?.id).toBe(cheap.id);
    expect(daysToEarnFee(40, 6)).toBeCloseTo(24.33, 1);

    const expensive = quote({
      fromKey: "nearUsdt",
      toKey: "solUsdc",
      loss: 200,
      planId: plans[0]!.id,
      purpose: "candidate",
    });
    const [skipped] = decideLegs(plans, [expensive], flat, venues, DEFAULT_POLICY);
    expect(skipped?.chosen).toBeNull();
  });
});

describe("yield filter", () => {
  const pools: LlamaPool[] = [
    { chain: "Near", project: "rhea-lend", symbol: "USDT", apy: 9.9, tvlUsd: 1_800_000, pool: "a", outlier: false },
    { chain: "Near", project: "rhea-lend", symbol: "USDT", apy: 80, tvlUsd: 9_000_000, pool: "b", outlier: true },
    { chain: "Solana", project: "kamino-lend", symbol: "USDC", apy: 6.2, tvlUsd: 40_000_000, pool: "c" },
    { chain: "Solana", project: "kamino-lend", symbol: "SOL", apy: 4.8, tvlUsd: 15_000_000, pool: "d" },
    { chain: "BSC", project: "uniswap-v3", symbol: "USDT-WBNB", apy: 40, tvlUsd: 4_000_000, pool: "e" },
  ];

  it("keeps the sane lend pool and files the BSC pair as context", () => {
    const venues = selectVenues(pools, DEFAULT_POLICY);
    expect(venues.find((venue) => venue.assetKey === "nearUsdt")?.apyPercent).toBe(9.9);
    expect(venues.some((venue) => (venue.apyPercent ?? 0) > 25)).toBe(false);
    const context = selectContextPool(pools);
    expect(context?.role).toBe("context");
    expect(context?.symbol).toBe("USDT-WBNB");
  });
});

describe("quotes stay dry", () => {
  it("builds a dry request and refuses a live one unless the env gate is open", () => {
    const job: QuoteJob = {
      id: "job",
      fromKey: "wNEAR",
      toKey: "sol",
      usd: 100,
      purpose: "candidate",
      planId: "alloc",
    };
    const request = buildDryQuoteRequest({
      job,
      prices: PRICES,
      addresses: {
        accountId: "near",
        bsc: "0xbe85f3dc536fc93df590c2d20ca9b28af1ed2c39",
        solana: "2QergEo7PxaMAD83ntGBQ2SdDSC3cL2pdYB5shvCjhFS",
        bscPath: "bsc-1",
        solanaPath: "solana-1",
        contractId: "v1.signer",
      },
      accountId: "near",
      now: new Date("2026-11-13T12:00:00.000Z"),
    });
    expect(request.dry).toBe(true);
    expect(request.recipient).toBe("2QergEo7PxaMAD83ntGBQ2SdDSC3cL2pdYB5shvCjhFS");
    expect(request.refundTo).toBe("near");
    expect(request.amount).toBe(toBase("100", 3.5, 24));
    expect(liveQuoteAllowed({})).toBe(false);
    expect(() => buildLiveQuoteRequest(request)).toThrow(/non-dry/);
    expect(liveQuoteAllowed({ FUND_AGENT_MODE: "live", FUND_AGENT_CONFIRM_LIVE: "yes" })).toBe(true);
  });

  it("flags a deposit address on an otherwise complete quote", () => {
    const scored = scoreQuoteResponse({
      correlationId: "abc",
      quote: {
        amountInFormatted: "1",
        amountOutFormatted: "2",
        amountInUsd: "10",
        amountOutUsd: "9.9",
        timeEstimate: 12,
        depositAddress: "0xabc",
      },
    });
    expect(scored.ok && scored.hadDepositAddress).toBe(true);
  });
});

function toBase(usd: string, price: number, decimals: number): string {
  const human = (Number(usd) / price).toFixed(Math.min(8, decimals));
  const [whole, frac = ""] = human.split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded)).toString();
}

describe("paper cycle", () => {
  it("explains a rebalance from rules and never flips dry off", async () => {
    const requests: boolean[] = [];
    const result = await runCycle({
      book: INITIAL_BOOK,
      policy: DEFAULT_POLICY,
      accountId: "near",
      now: new Date("2026-11-13T12:00:00.000Z"),
      clients: {
        prices: PRICES,
        pools: [],
        addresses: {
          accountId: "near",
          bsc: "0xbe85f3dc536fc93df590c2d20ca9b28af1ed2c39",
          solana: "2QergEo7PxaMAD83ntGBQ2SdDSC3cL2pdYB5shvCjhFS",
          bscPath: "bsc-1",
          solanaPath: "solana-1",
          contractId: "v1.signer",
        },
        quote: async (_job, request) => {
          requests.push(request.dry);
          const fromNear = request.originAsset.includes("wrap.near");
          return {
            correlationId: "test",
            quote: {
              amountInFormatted: fromNear ? "90" : "300",
              amountOutFormatted: request.destinationAsset.includes("sol.omft") ? "3.8" : "0.5",
              amountInUsd: "320",
              amountOutUsd: "316",
              timeEstimate: 18,
            },
          };
        },
      },
    });
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every(Boolean)).toBe(true);
    expect(result.mode).toBe("paper");
    expect(result.decision.action).toBe("rebalance");
    expect(result.memoSource).toBe("rules");
    const memo = result.memo.join(" ");
    expect(memo).toMatch(/paper cycle/i);
    expect(memo).toMatch(/dry/i);
    expect(memo).toMatch(/not an overweight sleeve|cannot fund/i);
    expect(memo).toMatch(/0xbe85f3dc536fc93df590c2d20ca9b28af1ed2c39/);
    expect(result.nextBook.find((row) => row.key === "wNEAR")?.amount).not.toBe("820");
    const text = explainCycle({
      totalUsd: result.totalUsd,
      sleeves: result.sleeves,
      positions: result.positions,
      decision: result.decision,
      accountId: "near",
      addresses: result.addresses,
      policy: DEFAULT_POLICY,
    }).join(" ");
    expect(text).not.toMatch(/[—–]/);
  });
});
