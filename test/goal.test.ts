import { describe, expect, it } from "vitest";
import { applyGoal, goalFromModel, interpretGoal, normalizeGoal, parseGoalRules, sanitizePolicy } from "../src/goal.js";
import { DEFAULT_POLICY } from "../src/policy.js";

const sum = (targets: Record<string, number>) => Object.values(targets).reduce((a, b) => a + b, 0);

describe("goal parser", () => {
  it("reads a named share and spreads the rest like the base policy", () => {
    const goal = parseGoalRules("Keep 50% stable and move the rest to the best yield, low risk");
    expect(goal.targets).toEqual({ STABLE: 0.5 });
    expect(goal.risk).toBe("low");
    expect(goal.yieldFocus).toBe(true);
    const policy = applyGoal(goal);
    expect(policy.targets.STABLE).toBeCloseTo(0.5, 3);
    expect(sum(policy.targets)).toBeCloseTo(1, 3);
    // NEAR, BNB and SOL share the other 50% in the base ratio 25:20:20.
    expect(policy.targets.NEAR).toBeGreaterThan(policy.targets.BNB);
  });

  it("reads several shares, in either order", () => {
    const goal = parseGoalRules("Safe: 60% stables, 20% NEAR, 10% BNB, SOL 10%");
    const policy = applyGoal(goal);
    expect(policy.targets).toMatchObject({ STABLE: 0.6, NEAR: 0.2, BNB: 0.1, SOL: 0.1 });
  });

  it("refuses a goal that adds past 100%", () => {
    expect(() => applyGoal(parseGoalRules("70% stable and 60% SOL"))).toThrow(/100%/);
  });

  it("low risk tightens limits and never loosens them", () => {
    const policy = applyGoal(parseGoalRules("conservative"));
    expect(policy.maxTradeUsd).toBeLessThanOrEqual(DEFAULT_POLICY.maxTradeUsd);
    expect(policy.maxQuoteLossBps).toBeLessThan(DEFAULT_POLICY.maxQuoteLossBps);
    expect(policy.targets.STABLE).toBeGreaterThanOrEqual(0.5);
  });

  it("high risk never raises the quote loss cap or trade size", () => {
    const policy = applyGoal(parseGoalRules("aggressive, 10% stable"));
    expect(policy.maxQuoteLossBps).toBe(DEFAULT_POLICY.maxQuoteLossBps);
    expect(policy.maxTradeUsd).toBe(DEFAULT_POLICY.maxTradeUsd);
  });

  it("an empty goal keeps the default targets", () => {
    const policy = applyGoal(parseGoalRules("make me money"));
    expect(policy.targets).toEqual(DEFAULT_POLICY.targets);
  });
});

describe("model goal", () => {
  const reply = (content: string): typeof fetch =>
    (async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })) as typeof fetch;

  it("accepts JSON wrapped in prose and percentages", async () => {
    const { goal } = await goalFromModel(
      "x",
      { base: "https://m.example/v1", key: "k", model: "m", source: "near-ai" },
      reply('Sure! {"targets":{"NEAR":10,"BNB":10,"SOL":30,"STABLE":50},"risk":"low","yieldFocus":true}'),
    );
    expect(goal.targets?.STABLE).toBeCloseTo(0.5, 3);
    expect(goal.risk).toBe("low");
  });

  it("falls back to the rules parser when the model fails", async () => {
    const failing = (async () => new Response("no", { status: 500 })) as typeof fetch;
    const result = await interpretGoal("keep 40% stable", { NEAR_AI_API_KEY: "k" }, failing);
    expect(result.source).toBe("rules");
    expect(result.policy.targets.STABLE).toBeCloseTo(0.4, 3);
  });

  it("uses the model answer when it fits and reports the source", async () => {
    const result = await interpretGoal(
      "anything",
      { NEAR_AI_API_KEY: "k" },
      reply('{"targets":{"STABLE":0.4,"NEAR":0.3,"BNB":0.15,"SOL":0.15},"risk":"medium","yieldFocus":false}'),
    );
    expect(result.source).toBe("near-ai");
    expect(result.policy.targets.NEAR).toBeCloseTo(0.3, 3);
  });

  it("a model cannot loosen the caps", async () => {
    const result = await interpretGoal(
      "anything",
      { NEAR_AI_API_KEY: "k" },
      reply('{"risk":"high","maxQuoteLossBps":9999,"maxTradeUsd":99999}'),
    );
    expect(result.policy.maxQuoteLossBps).toBeLessThanOrEqual(DEFAULT_POLICY.maxQuoteLossBps);
    expect(result.policy.maxTradeUsd).toBeLessThanOrEqual(DEFAULT_POLICY.maxTradeUsd);
  });

  it("rejects non-object goals", () => {
    expect(() => normalizeGoal("hi")).toThrow();
  });
});

describe("sanitizePolicy", () => {
  it("clamps a client policy to the caps", () => {
    const policy = sanitizePolicy({
      ...DEFAULT_POLICY,
      maxTradeUsd: 1_000_000,
      maxQuoteLossBps: 5000,
      driftBps: 1,
    });
    expect(policy.maxTradeUsd).toBe(DEFAULT_POLICY.maxTradeUsd);
    expect(policy.maxQuoteLossBps).toBe(DEFAULT_POLICY.maxQuoteLossBps);
    expect(policy.driftBps).toBe(100);
  });

  it("rejects targets that do not sum to 1", () => {
    expect(() => sanitizePolicy({ ...DEFAULT_POLICY, targets: { NEAR: 0.9, BNB: 0.9, SOL: 0.9, STABLE: 0.9 } })).toThrow();
  });

  it("returns the default for junk", () => {
    expect(sanitizePolicy(null)).toEqual(DEFAULT_POLICY);
  });
});
