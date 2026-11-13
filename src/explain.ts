import { CHAIN_LABEL, assetByKey } from "./assets.js";
import { formatAmount, formatBps, formatUsd } from "./money.js";
import type { CycleResult, DecisionLeg, MarkedPosition, ScoredQuote, SleeveSnapshot } from "./types.js";
import type { Policy } from "./types.js";

function sleeveLine(sleeve: SleeveSnapshot): string {
  const direction = sleeve.drift >= 0 ? "over" : "under";
  return `${sleeve.sleeve} is ${formatUsd(sleeve.valueUsd)} (${(sleeve.weight * 100).toFixed(1)}%, target ${(sleeve.target * 100).toFixed(0)}%, ${Math.abs(sleeve.drift * 100).toFixed(1)} points ${direction})`;
}

function routeName(quote: ScoredQuote): string {
  const from = assetByKey(quote.fromKey);
  const to = assetByKey(quote.toKey);
  return `${from.symbol} on ${CHAIN_LABEL[from.chain]} to ${to.symbol} on ${CHAIN_LABEL[to.chain]}`;
}

function describeQuote(quote: ScoredQuote): string {
  if (!quote.result.ok) return `${routeName(quote)} did not quote (${quote.result.message})`;
  const out = quote.result;
  return `${routeName(quote)} turns ${formatAmount(out.amountInFormatted)} into ${formatAmount(out.amountOutFormatted)} (${formatUsd(out.amountInUsd)} to ${formatUsd(out.amountOutUsd)}, ${formatBps(out.lossBps)}, about ${out.timeEstimateSec}s)`;
}

function alternativeLine(leg: DecisionLeg): string {
  if (!leg.chosen || !leg.chosen.result.ok) return "";
  const chosenLoss = leg.chosen.result.lossBps;
  const alternatives = leg.rejected.filter((row) => {
    if (!row.quote.result.ok) return false;
    const cheaper = row.quote.result.lossBps + 1 < chosenLoss;
    const blocked = /overweight sleeve|deposit address|fee cap|horizon/i.test(row.why);
    return cheaper || blocked;
  });
  if (alternatives.length === 0) return "";
  const listed = alternatives
    .slice(0, 3)
    .map((row) => {
      const from = assetByKey(row.quote.fromKey);
      const result = row.quote.result;
      const loss = result.ok ? result.lossBps : Number.NaN;
      return `${from.symbol} on ${CHAIN_LABEL[from.chain]} at ${formatBps(loss)}`;
    })
    .join(", ");
  const why = alternatives[0]?.why ?? "The policy declined them.";
  return `Other routes on the tape: ${listed}. ${why}`;
}

function legParagraph(leg: DecisionLeg, policy: Policy): string {
  const from = assetByKey(leg.plan.fromKey);
  const to = assetByKey(leg.plan.toKey);
  if (!leg.chosen || !leg.chosen.result.ok) {
    return `I looked at buying ${to.symbol} and did not take it. ${leg.holdReason ?? "No route passed the policy."}`.trim();
  }
  const chosen = leg.chosen.result;
  const verb = leg.plan.reason === "yield" ? "I rotate stables" : "I sell the overweight sleeve";
  return [
    `${verb}: ${describeQuote(leg.chosen)}. That clears the ${policy.maxQuoteLossBps} bps fee cap.`,
    alternativeLine(leg),
    `The paper book spends ${formatAmount(chosen.amountInFormatted)} ${from.symbol} and receives ${formatAmount(chosen.amountOutFormatted)} ${to.symbol}. Nothing is sent.`,
  ]
    .filter(Boolean)
    .join(" ");
}

export function explainCycle(input: {
  totalUsd: number;
  sleeves: SleeveSnapshot[];
  positions: MarkedPosition[];
  decision: CycleResult["decision"];
  accountId: string;
  addresses: CycleResult["addresses"];
  policy: Policy;
}): string[] {
  const { sleeves, decision, policy } = input;
  const overweight = [...sleeves].sort((a, b) => b.driftBps - a.driftBps)[0];
  const lines: string[] = [];

  lines.push(
    `This is a paper cycle. Quotes are live NEAR Intents dry runs, so there is no deposit address and no transfer. The book is marked at ${formatUsd(input.totalUsd)}.`,
  );

  lines.push(
    `Policy wants NEAR ${policy.targets.NEAR * 100}%, BNB ${policy.targets.BNB * 100}%, SOL ${policy.targets.SOL * 100}%, and stables ${policy.targets.STABLE * 100}%. ${sleeves.map(sleeveLine).join(". ")}.`,
  );

  if (overweight && overweight.driftBps > policy.driftBps) {
    lines.push(
      `${overweight.sleeve} is the sleeve that can fund a trade. A cheaper quote from a sleeve that is already under its target is shown, then declined.`,
    );
  }

  if (decision.legs.length === 0) {
    lines.push("Every sleeve is inside its band, so there is no allocation trade this cycle.");
  } else {
    for (const leg of decision.legs) lines.push(legParagraph(leg, policy));
  }

  const yieldBits = decision.yields
    .filter((venue) => venue.role === "target")
    .map((venue) => `${venue.project} ${venue.symbol} at ${venue.apyPercent.toFixed(2)}% on ${venue.chain} (TVL ${formatUsd(venue.tvlUsd)})`);
  if (yieldBits.length) {
    lines.push(`Yields I checked, and will not chase above ${policy.maxApyPercent}%: ${yieldBits.join("; ")}.`);
  } else {
    lines.push("Yield venues did not match the filter this cycle, so the memo does not invent an APY.");
  }

  if (decision.contextYield) {
    const row = decision.contextYield;
    lines.push(
      `Context only: ${row.project} ${row.symbol} on ${row.chain} shows ${row.apyPercent.toFixed(1)}% at ${formatUsd(row.tvlUsd)} TVL. That is the kind of fee APR on the BSC inventory pair. It is not a target, because the policy ignores yields above ${policy.maxApyPercent}% and does not take liquidity-pool inventory risk from a quote.`,
    );
  }

  if (decision.action === "hold" && decision.legs.length > 0) {
    lines.push("Decision: hold. The live quotes did not beat the policy, so the paper book stays as it is.");
  } else if (decision.action === "rebalance") {
    const fills = decision.legs.filter((leg) => leg.chosen).length;
    lines.push(
      `Decision: ${fills} paper fill${fills === 1 ? "" : "s"}. Each fill is capped at ${formatUsd(policy.maxTradeUsd)}, so a sleeve that is still outside its band after this cycle needs another paper cycle. Run it again and the agent will keep going from the new book.`,
    );
  } else {
    lines.push("Decision: hold. The book is inside the bands, and no stable rotation earned its quote cost inside the horizon.");
  }

  if (input.addresses) {
    lines.push(
      `Chain signatures, read from ${input.addresses.contractId}: ${input.accountId} derives BSC ${input.addresses.bsc} on path ${input.addresses.bscPath}, and Solana ${input.addresses.solana} on path ${input.addresses.solanaPath}. A live trade would ask that same account to sign. This cycle does not.`,
    );
  } else {
    lines.push("Chain-signature addresses were not derived this cycle. The paper decision does not need them, and no fallback address is treated as yours.");
  }

  return lines;
}
