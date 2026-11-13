import { DEFAULT_POLICY, assertPolicy } from "./policy.js";
import type { Policy, Sleeve } from "./types.js";

export type Risk = "low" | "medium" | "high";

export type Goal = {
  /** Fractions that sum to 1 once normalised. Missing means keep the base targets. */
  targets?: Partial<Record<Sleeve, number>>;
  risk: Risk;
  yieldFocus: boolean;
};

export type GoalResult = {
  goal: Goal;
  policy: Policy;
  source: "rules" | "near-ai" | "compatible";
  /** Plain-language lines describing what changed. */
  summary: string[];
};

const SLEEVES: Sleeve[] = ["NEAR", "BNB", "SOL", "STABLE"];
const MIN_TARGET = 0.05;
const MAX_TARGET = 0.8;

const KEYWORDS: Array<[RegExp, Sleeve]> = [
  [/^(stable\w*|usdt|usdc|cash|dollar\w*)$/i, "STABLE"],
  [/^(w?near)$/i, "NEAR"],
  [/^(bnb|bsc|wbnb|binance)$/i, "BNB"],
  [/^(sol|solana)$/i, "SOL"],
];

function sleeveOf(word: string): Sleeve | null {
  for (const [pattern, sleeve] of KEYWORDS) if (pattern.test(word)) return sleeve;
  return null;
}

/**
 * Deterministic parser. It reads things like "keep 50% stable, move the rest
 * to the highest yield, low risk". It never invents a number: anything not
 * named keeps its share of whatever is left, in proportion to the base policy.
 */
export function parseGoalRules(text: string): Goal {
  const lower = text.toLowerCase();
  const named: Partial<Record<Sleeve, number>> = {};
  const patterns = [
    /(\d{1,3}(?:\.\d+)?)\s*%\s*(?:in|of|to|on|into)?\s*([a-z]+)/g,
    /([a-z]+)\s*(?:at|to|=|:)?\s*(\d{1,3}(?:\.\d+)?)\s*%/g,
  ];
  for (const [index, pattern] of patterns.entries()) {
    for (const match of lower.matchAll(pattern)) {
      const numberText = index === 0 ? match[1] : match[2];
      const word = index === 0 ? match[2] : match[1];
      const sleeve = word ? sleeveOf(word) : null;
      const value = Number(numberText) / 100;
      if (sleeve && Number.isFinite(value) && named[sleeve] === undefined) named[sleeve] = value;
    }
  }

  let risk: Risk = "medium";
  if (/\b(low[- ]?risk|conservative|safe|safer|cautious|careful)\b/.test(lower)) risk = "low";
  else if (/\b(high[- ]?risk|aggressive|degen|max(imi[sz]e)? (growth|upside))\b/.test(lower)) risk = "high";

  const yieldFocus = /\b(yield|apy|apr|earn|interest)\b/.test(lower);
  const hasTargets = Object.keys(named).length > 0;
  return { targets: hasTargets ? named : undefined, risk, yieldFocus };
}

function clampTargets(
  partial: Partial<Record<Sleeve, number>> | undefined,
  base: Record<Sleeve, number>,
  risk: Risk,
): Record<Sleeve, number> {
  let seed: Partial<Record<Sleeve, number>> = partial ? { ...partial } : {};
  if (!partial) {
    // No explicit shares: let the risk word nudge the stable sleeve.
    if (risk === "low") seed = { STABLE: Math.max(base.STABLE, 0.5) };
    else if (risk === "high") seed = { STABLE: Math.min(base.STABLE, 0.15) };
  }
  const named = SLEEVES.filter((sleeve) => seed[sleeve] !== undefined);
  const used = named.reduce((sum, sleeve) => sum + (seed[sleeve] ?? 0), 0);
  if (used > 1.001) throw new Error(`The goal asks for ${(used * 100).toFixed(0)}% in total. It has to fit in 100%.`);
  const open = SLEEVES.filter((sleeve) => seed[sleeve] === undefined);
  const rest = Math.max(0, 1 - used);
  const openBase = open.reduce((sum, sleeve) => sum + base[sleeve], 0) || 1;
  const raw = {} as Record<Sleeve, number>;
  for (const sleeve of SLEEVES) {
    raw[sleeve] = seed[sleeve] !== undefined ? (seed[sleeve] as number) : (rest * base[sleeve]) / openBase;
  }
  // Clamp, then give the rounding slack to the largest sleeve.
  const clamped = {} as Record<Sleeve, number>;
  for (const sleeve of SLEEVES) {
    clamped[sleeve] = Math.min(MAX_TARGET, Math.max(MIN_TARGET, Number.isFinite(raw[sleeve]) ? raw[sleeve] : base[sleeve]));
  }
  const total = SLEEVES.reduce((sum, sleeve) => sum + clamped[sleeve], 0);
  const out = {} as Record<Sleeve, number>;
  for (const sleeve of SLEEVES) out[sleeve] = Math.round((clamped[sleeve] / total) * 10_000) / 10_000;
  const drift = 1 - SLEEVES.reduce((sum, sleeve) => sum + out[sleeve], 0);
  const largest = SLEEVES.reduce((a, b) => (out[b] > out[a] ? b : a));
  out[largest] = Math.round((out[largest] + drift) * 10_000) / 10_000;
  return out;
}

/** Applies a goal on top of a base policy. Limits can only move inside the caps below. */
export function applyGoal(goal: Goal, base: Policy = DEFAULT_POLICY): GoalResult["policy"] {
  const targets = clampTargets(goal.targets, base.targets, goal.risk);
  const policy: Policy = { ...base, targets };
  if (goal.risk === "low") {
    policy.maxTradeUsd = Math.min(base.maxTradeUsd, 150);
    policy.maxQuoteLossBps = Math.min(base.maxQuoteLossBps, 60);
    policy.driftBps = Math.max(base.driftBps, 600);
  } else if (goal.risk === "high") {
    policy.driftBps = Math.min(base.driftBps, 250);
  }
  if (goal.yieldFocus) {
    policy.minYieldEdgePercent = Math.min(base.minYieldEdgePercent, 0.5);
    policy.yieldHorizonDays = Math.max(base.yieldHorizonDays, 90);
  }
  assertPolicy(policy);
  return policy;
}

export function describeGoal(goal: Goal, policy: Policy): string[] {
  const t = policy.targets;
  const lines = [
    `Targets: NEAR ${pct(t.NEAR)}, BNB ${pct(t.BNB)}, SOL ${pct(t.SOL)}, stables ${pct(t.STABLE)}.`,
    `Risk ${goal.risk}: trades up to $${policy.maxTradeUsd}, quote loss cap ${policy.maxQuoteLossBps} bps, rebalance past ${policy.driftBps / 100} points of drift.`,
  ];
  if (goal.yieldFocus) {
    lines.push(
      `Yield focus: a stable may rotate when the gap clears ${policy.minYieldEdgePercent} points and earns the fee back inside ${policy.yieldHorizonDays} days.`,
    );
  }
  return lines;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1).replace(/\.0$/, "")}%`;
}

/** Turns untrusted JSON (from a model or a client) into a Goal. Throws on junk. */
export function normalizeGoal(input: unknown): Goal {
  if (!input || typeof input !== "object") throw new Error("Goal must be an object");
  const raw = input as { targets?: unknown; risk?: unknown; yieldFocus?: unknown };
  const risk: Risk = raw.risk === "low" || raw.risk === "high" ? raw.risk : "medium";
  let targets: Partial<Record<Sleeve, number>> | undefined;
  if (raw.targets && typeof raw.targets === "object") {
    const given = raw.targets as Record<string, unknown>;
    const entries: Partial<Record<Sleeve, number>> = {};
    for (const sleeve of SLEEVES) {
      const value = given[sleeve];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) entries[sleeve] = value;
    }
    const sum = Object.values(entries).reduce((a, b) => a + b, 0);
    if (sum > 1.5) for (const sleeve of SLEEVES) if (entries[sleeve] !== undefined) entries[sleeve] = (entries[sleeve] as number) / 100;
    if (Object.keys(entries).length > 0) targets = entries;
  }
  return { targets, risk, yieldFocus: raw.yieldFocus === true };
}

export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The model did not return JSON");
  return JSON.parse(text.slice(start, end + 1)) as unknown;
}

/** Clamp a client-supplied policy so it can never loosen the caps. */
export function sanitizePolicy(input: unknown, base: Policy = DEFAULT_POLICY): Policy {
  if (!input || typeof input !== "object") return base;
  const raw = input as Partial<Policy> & { targets?: Partial<Record<Sleeve, number>> };
  const num = (value: unknown, lo: number, hi: number, fallback: number): number =>
    typeof value === "number" && Number.isFinite(value) ? Math.min(hi, Math.max(lo, value)) : fallback;
  const targets = {} as Record<Sleeve, number>;
  for (const sleeve of SLEEVES) targets[sleeve] = num(raw.targets?.[sleeve], 0, 1, base.targets[sleeve]);
  const policy: Policy = {
    ...base,
    targets,
    driftBps: num(raw.driftBps, 100, 1000, base.driftBps),
    minTradeUsd: base.minTradeUsd,
    maxTradeUsd: num(raw.maxTradeUsd, base.minTradeUsd, base.maxTradeUsd, base.maxTradeUsd),
    maxQuoteLossBps: num(raw.maxQuoteLossBps, 10, base.maxQuoteLossBps, base.maxQuoteLossBps),
    minYieldEdgePercent: num(raw.minYieldEdgePercent, 0.25, 5, base.minYieldEdgePercent),
    yieldHorizonDays: num(raw.yieldHorizonDays, 14, 90, base.yieldHorizonDays),
  };
  assertPolicy(policy);
  return policy;
}

const SYSTEM_PROMPT = [
  "You turn a fund manager's goal into JSON. Reply with JSON only, no prose.",
  'Shape: {"targets":{"NEAR":0.25,"BNB":0.2,"SOL":0.2,"STABLE":0.35},"risk":"low|medium|high","yieldFocus":true|false}.',
  "Targets are fractions that sum to 1. Omit targets when the goal names no shares.",
  "Never output addresses, keys, amounts to send, or extra fields.",
].join(" ");

/** Asks a model for a Goal. The result is validated and clamped by applyGoal, so the model cannot loosen a cap. */
export async function goalFromModel(
  text: string,
  config: { base: string; key: string; model: string; source: "near-ai" | "compatible" },
  fetchImpl: typeof fetch = fetch,
): Promise<{ goal: Goal; source: "near-ai" | "compatible" }> {
  const response = await fetchImpl(`${config.base.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.key}` },
    body: JSON.stringify({
      model: config.model,
      temperature: 0,
      max_tokens: 200,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: text.slice(0, 500) },
      ],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Model failed (${response.status})`);
  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("Model returned nothing");
  return { goal: normalizeGoal(extractJson(content)), source: config.source };
}

export async function interpretGoal(
  text: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
  base: Policy = DEFAULT_POLICY,
): Promise<GoalResult> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Write a goal first");
  let goal = parseGoalRules(trimmed);
  let source: GoalResult["source"] = "rules";
  const near = env.NEAR_AI_API_KEY;
  const compatible = env.LLM_API_KEY && env.LLM_BASE_URL;
  if (near || compatible) {
    try {
      const modelled = await goalFromModel(
        trimmed,
        near
          ? {
              base: env.NEAR_AI_BASE_URL || "https://cloud-api.near.ai/v1",
              key: near,
              model: env.NEAR_AI_MODEL || "z-ai/glm-5.2",
              source: "near-ai",
            }
          : {
              base: env.LLM_BASE_URL as string,
              key: env.LLM_API_KEY as string,
              model: env.LLM_MODEL || "gpt-4o-mini",
              source: "compatible",
            },
        fetchImpl,
      );
      // Validate by applying. If the model's answer does not fit, fall back to the rules.
      applyGoal(modelled.goal, base);
      goal = modelled.goal;
      source = modelled.source;
    } catch {
      source = "rules";
    }
  }
  const policy = applyGoal(goal, base);
  return { goal, policy, source, summary: describeGoal(goal, policy) };
}
