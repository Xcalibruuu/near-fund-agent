import { assetByKey } from "./assets.js";
import { chainById, type ChainEntry } from "./chains.js";
import { addressFromMpcKey } from "./address.js";
import { lossBps, toBaseUnits } from "./money.js";
import type { DerivedAddresses, QuoteFail, QuoteJob, QuoteOk, TokenPrice } from "./types.js";

export type DryQuoteRequest = {
  dry: true;
  swapType: "EXACT_INPUT";
  slippageTolerance: number;
  originAsset: string;
  depositType: "ORIGIN_CHAIN";
  destinationAsset: string;
  amount: string;
  recipient: string;
  recipientType: "DESTINATION_CHAIN";
  refundTo: string;
  refundType: "ORIGIN_CHAIN";
  deadline: string;
  quoteWaitingTimeMs: number;
};

const PAPER_RECIPIENTS: Record<string, string> = {
  near: "near",
  // Used only when derivation is unavailable. Dry quotes do not move funds.
  solana: "So11111111111111111111111111111111111111112",
  bsc: "0x55d398326f99059ff775485246999027b3197955",
  eth: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  base: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  arb: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
  op: "0x4200000000000000000000000000000000000006",
};

export function recipientFor(chain: string, addresses: DerivedAddresses | null, accountId: string): string {
  const entry = chainById(chain);
  if (entry.family === "near") return accountId || PAPER_RECIPIENTS.near;
  if (addresses) {
    if (chain === "bsc") return addresses.bsc;
    if (chain === "solana") return addresses.solana;
    const extra = addresses.extra?.[chain];
    if (extra) return extra;
  }
  const fallback = PAPER_RECIPIENTS[chain];
  if (!fallback) throw new Error(`No recipient for ${chain}. Derive an address or pass one in.`);
  return fallback;
}

/** Address for any registry row, including one that is not in the demo. */
export function addressForEntry(entry: ChainEntry, mpcPublicKey: string): string {
  if (!entry.derivation) throw new Error(`${entry.id} has no chain-signature derivation in the registry`);
  const parsed = addressFromMpcKey(mpcPublicKey);
  if (parsed.scheme !== entry.derivation.scheme) {
    throw new Error(`${entry.id} expects ${entry.derivation.scheme}, got ${parsed.scheme}`);
  }
  return parsed.address;
}

/** Dry quote for a registry asset. Does not touch the paper book. */
export function buildRegistryQuote(input: {
  entry: ChainEntry;
  assetId: string;
  amount: string;
  recipient: string;
  refundTo: string;
  now: Date;
}): DryQuoteRequest {
  const known = input.entry.assets.some((asset) => asset.assetId === input.assetId);
  if (!known) throw new Error(`${input.assetId} is not on the ${input.entry.id} registry row`);
  return {
    dry: true,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset: "nep141:wrap.near",
    depositType: "ORIGIN_CHAIN",
    destinationAsset: input.assetId,
    amount: input.amount,
    recipient: input.recipient,
    recipientType: "DESTINATION_CHAIN",
    refundTo: input.refundTo,
    refundType: "ORIGIN_CHAIN",
    deadline: new Date(input.now.getTime() + 6 * 60 * 60 * 1000).toISOString(),
    quoteWaitingTimeMs: 800,
  };
}

export function humanAmountForUsd(usd: number, priceUsd: number, decimals: number): string {
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) throw new Error("Missing price");
  const human = usd / priceUsd;
  const digits = Math.min(8, decimals);
  return human.toFixed(digits);
}

export function buildDryQuoteRequest(input: {
  job: QuoteJob;
  prices: TokenPrice[];
  addresses: DerivedAddresses | null;
  accountId: string;
  now: Date;
}): DryQuoteRequest {
  const from = assetByKey(input.job.fromKey);
  const to = assetByKey(input.job.toKey);
  const price = input.prices.find((token) => token.assetId === from.assetId);
  if (!price) throw new Error(`No price for ${from.symbol}`);
  const human = humanAmountForUsd(input.job.usd, price.priceUsd, from.decimals);
  const deadline = new Date(input.now.getTime() + 6 * 60 * 60 * 1000).toISOString();
  return {
    dry: true,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset: from.assetId,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: to.assetId,
    amount: toBaseUnits(human, from.decimals),
    recipient: recipientFor(to.chain, input.addresses, input.accountId),
    recipientType: "DESTINATION_CHAIN",
    refundTo: recipientFor(from.chain, input.addresses, input.accountId),
    refundType: "ORIGIN_CHAIN",
    deadline,
    quoteWaitingTimeMs: 800,
  };
}

export function scoreQuoteResponse(payload: unknown): QuoteOk | QuoteFail {
  if (!payload || typeof payload !== "object") return { ok: false, message: "Empty quote response" };
  const body = payload as {
    message?: string;
    correlationId?: string;
    quote?: Record<string, unknown>;
  };
  const quote = body.quote;
  if (!quote) return { ok: false, message: body.message || "Quote unavailable" };
  const amountInUsd = Number(quote.amountInUsd);
  const amountOutUsd = Number(quote.amountOutUsd);
  const amountInFormatted = String(quote.amountInFormatted ?? "");
  const amountOutFormatted = String(quote.amountOutFormatted ?? "");
  if (!amountInFormatted || !amountOutFormatted || !Number.isFinite(amountInUsd) || !Number.isFinite(amountOutUsd)) {
    return { ok: false, message: "Quote was missing amounts" };
  }
  return {
    ok: true,
    amountInFormatted,
    amountOutFormatted,
    amountInUsd,
    amountOutUsd,
    timeEstimateSec: Number(quote.timeEstimate ?? 0),
    lossBps: lossBps(amountInUsd, amountOutUsd),
    correlationId: body.correlationId,
    hadDepositAddress: typeof quote.depositAddress === "string" && quote.depositAddress.length > 0,
  };
}

