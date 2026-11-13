import { assetByKey } from "./assets.js";
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

const PAPER_RECIPIENTS = {
  near: "near",
  // A valid pubkey used only when derivation is unavailable. Dry quotes do not move funds.
  solana: "So11111111111111111111111111111111111111112",
  bsc: "0x55d398326f99059ff775485246999027b3197955",
};

export function recipientFor(chain: "near" | "bsc" | "solana", addresses: DerivedAddresses | null, accountId: string): string {
  if (chain === "near") return accountId || PAPER_RECIPIENTS.near;
  if (addresses) return chain === "bsc" ? addresses.bsc : addresses.solana;
  return PAPER_RECIPIENTS[chain];
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

