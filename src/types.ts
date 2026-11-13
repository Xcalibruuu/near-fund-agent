export type ChainId = "near" | "bsc" | "solana";

export type Sleeve = "NEAR" | "BNB" | "SOL" | "STABLE";

export type Asset = {
  key: string;
  chain: ChainId;
  symbol: string;
  sleeve: Sleeve;
  decimals: number;
  assetId: string;
};

export type Position = {
  key: string;
  amount: string;
};

export type MarkedPosition = Position & {
  asset: Asset;
  priceUsd: number;
  valueUsd: number;
};

export type SleeveSnapshot = {
  sleeve: Sleeve;
  valueUsd: number;
  weight: number;
  target: number;
  drift: number;
  driftBps: number;
};

export type Policy = {
  targets: Record<Sleeve, number>;
  /** Absolute weight drift, in basis points, before an allocation trade. */
  driftBps: number;
  minTradeUsd: number;
  maxTradeUsd: number;
  /** Reject a quote whose USD loss exceeds this. 100 bps = 1%. */
  maxQuoteLossBps: number;
  /** Ignore lend/stake yields above this percent. They are treated as outliers. */
  maxApyPercent: number;
  minTvlUsd: number;
  /** Minimum yield gap, in percentage points, before a stable rotation. */
  minYieldEdgePercent: number;
  yieldHorizonDays: number;
};

export type PlannedTrade = {
  id: string;
  fromKey: string;
  toKey: string;
  usd: number;
  reason: "allocation" | "yield";
};

export type QuoteJob = {
  id: string;
  fromKey: string;
  toKey: string;
  usd: number;
  purpose: "candidate" | "comparison";
  planId: string;
};

export type QuoteOk = {
  ok: true;
  amountInFormatted: string;
  amountOutFormatted: string;
  amountInUsd: number;
  amountOutUsd: number;
  timeEstimateSec: number;
  lossBps: number;
  correlationId?: string;
  hadDepositAddress: boolean;
};

export type QuoteFail = {
  ok: false;
  message: string;
};

export type ScoredQuote = QuoteJob & {
  result: QuoteOk | QuoteFail;
};

export type RejectedQuote = {
  quote: ScoredQuote;
  why: string;
};

export type DecisionLeg = {
  plan: PlannedTrade;
  chosen: ScoredQuote | null;
  rejected: RejectedQuote[];
  holdReason?: string;
};

export type Venue = {
  id: string;
  chain: string;
  project: string;
  symbol: string;
  apyPercent: number;
  tvlUsd: number;
  pool: string;
  role: "target" | "context";
  assetKey?: string;
};

export type Decision = {
  action: "rebalance" | "hold";
  legs: DecisionLeg[];
  yields: Venue[];
  contextYield: Venue | null;
};

export type DerivedAddresses = {
  accountId: string;
  bsc: string;
  solana: string;
  bscPath: string;
  solanaPath: string;
  contractId: string;
  /** Addresses for registry rows that are not the demo pair. Keyed by chain id. */
  extra?: Record<string, string>;
};

export type TokenPrice = {
  assetId: string;
  symbol: string;
  blockchain: string;
  decimals: number;
  priceUsd: number;
  priceUpdatedAt?: string;
};

export type CycleResult = {
  mode: "paper";
  ranAt: string;
  accountId: string;
  addresses: DerivedAddresses | null;
  addressError?: string;
  totalUsd: number;
  positions: MarkedPosition[];
  sleeves: SleeveSnapshot[];
  quotes: ScoredQuote[];
  decision: Decision;
  /** Paragraphs. The policy wrote these. A model may only add `llmMemo`. */
  memo: string[];
  llmMemo?: string;
  memoSource: "rules" | "near-ai" | "compatible";
  nextBook: Position[];
  pricesUpdatedAt?: string;
};

export type LlamaPool = {
  chain: string;
  project: string;
  symbol: string;
  tvlUsd?: number | null;
  apy?: number | null;
  pool?: string;
  outlier?: boolean;
};
