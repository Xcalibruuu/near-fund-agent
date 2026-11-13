import { explainCycle } from "./explain.js";
import { buildDryQuoteRequest, scoreQuoteResponse } from "./intents.js";
import { assertPolicy } from "./policy.js";
import { applyPaperFills, buildDecision, decideLegs } from "./decide.js";
import { markBook, sleeveSnapshots, totalValue } from "./portfolio.js";
import { planAllocation, planYieldRotation, quoteJobs } from "./planner.js";
import { selectContextPool, selectVenues } from "./yields.js";
import type {
  CycleResult,
  DerivedAddresses,
  LlamaPool,
  PlannedTrade,
  Policy,
  Position,
  QuoteJob,
  ScoredQuote,
  TokenPrice,
} from "./types.js";

export type CycleClients = {
  prices: TokenPrice[];
  pools: LlamaPool[];
  addresses: DerivedAddresses | null;
  addressError?: string;
  quote: (job: QuoteJob, request: ReturnType<typeof buildDryQuoteRequest>) => Promise<unknown>;
  llm?: (memo: string[]) => Promise<{ text: string; source: "near-ai" | "compatible" } | null>;
};

export async function runCycle(input: {
  book: Position[];
  policy: Policy;
  accountId: string;
  now?: Date;
  clients: CycleClients;
}): Promise<CycleResult> {
  assertPolicy(input.policy);
  const now = input.now ?? new Date();
  const positions = markBook(input.book, input.clients.prices);
  const totalUsd = totalValue(positions);
  const sleeves = sleeveSnapshots(positions, input.policy);
  const yields = selectVenues(input.clients.pools, input.policy);
  const contextYield = selectContextPool(input.clients.pools);

  let plans: PlannedTrade[] = planAllocation(positions, sleeves, input.policy);
  if (plans.length === 0) {
    plans = planYieldRotation(positions, sleeves, yields, input.policy);
  }
  const jobs = quoteJobs(plans, positions, input.policy);

  const quotes: ScoredQuote[] = await Promise.all(
    jobs.map(async (job) => {
      try {
        const request = buildDryQuoteRequest({
          job,
          prices: input.clients.prices,
          addresses: input.clients.addresses,
          accountId: input.accountId,
          now,
        });
        if (request.dry !== true) throw new Error("Paper cycle tried to leave dry mode");
        const payload = await input.clients.quote(job, request);
        return { ...job, result: scoreQuoteResponse(payload) };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Quote failed";
        return { ...job, result: { ok: false as const, message } };
      }
    }),
  );

  const legs = decideLegs(plans, quotes, sleeves, yields, input.policy);
  const decision = buildDecision(legs, yields, contextYield);
  const nextBook = applyPaperFills(input.book, legs);
  const memo = explainCycle({
    totalUsd,
    sleeves,
    positions,
    decision,
    accountId: input.accountId,
    addresses: input.clients.addresses,
    policy: input.policy,
  });

  let llmMemo: string | undefined;
  let memoSource: CycleResult["memoSource"] = "rules";
  if (input.clients.llm) {
    try {
      const rewritten = await input.clients.llm(memo);
      if (rewritten?.text) {
        llmMemo = rewritten.text;
        memoSource = rewritten.source;
      }
    } catch {
      llmMemo = undefined;
      memoSource = "rules";
    }
  }

  const updated = input.clients.prices
    .map((token) => token.priceUpdatedAt)
    .filter((value): value is string => Boolean(value))
    .sort();

  return {
    mode: "paper",
    ranAt: now.toISOString(),
    accountId: input.accountId,
    addresses: input.clients.addresses,
    addressError: input.clients.addressError,
    totalUsd,
    positions,
    sleeves,
    quotes,
    decision,
    memo,
    llmMemo,
    memoSource,
    nextBook,
    pricesUpdatedAt: updated.at(-1),
  };
}
