import { assetByKey } from "./assets.js";
import { addDecimal, parseDecimal, subDecimal } from "./money.js";
import type {
  Decision,
  DecisionLeg,
  MarkedPosition,
  PlannedTrade,
  Policy,
  Position,
  QuoteOk,
  ScoredQuote,
  SleeveSnapshot,
  Venue,
} from "./types.js";

export function daysToEarnFee(lossBps: number, edgePercent: number): number {
  if (edgePercent <= 0) return Number.POSITIVE_INFINITY;
  return (lossBps / edgePercent) * 3.65;
}

function sleeveOf(key: string, sleeves: SleeveSnapshot[]): SleeveSnapshot | undefined {
  return sleeves.find((sleeve) => sleeve.sleeve === assetByKey(key).sleeve);
}

function isQuoteOk(quote: ScoredQuote): quote is ScoredQuote & { result: QuoteOk } {
  return quote.result.ok;
}

export function decideLegs(
  plans: PlannedTrade[],
  quotes: ScoredQuote[],
  sleeves: SleeveSnapshot[],
  venues: Venue[],
  policy: Policy,
): DecisionLeg[] {
  return plans.map((plan) => {
    const related = quotes.filter((quote) => quote.planId === plan.id);
    const rejected: DecisionLeg["rejected"] = [];
    const eligible: Array<ScoredQuote & { result: QuoteOk }> = [];

    for (const quote of related) {
      const result = quote.result;
      if (!result.ok) {
        rejected.push({ quote, why: `No quote: ${result.message}` });
        continue;
      }
      if (result.hadDepositAddress) {
        rejected.push({ quote, why: "Dry quote included a deposit address, so it was discarded." });
        continue;
      }
      const sourceSleeve = sleeveOf(quote.fromKey, sleeves);
      const fundingOk =
        plan.reason === "yield"
          ? assetByKey(quote.fromKey).sleeve === "STABLE"
          : Boolean(sourceSleeve && sourceSleeve.driftBps > policy.driftBps);
      if (!fundingOk) {
        rejected.push({
          quote,
          why: `${assetByKey(quote.fromKey).symbol} is not an overweight sleeve, so it cannot fund this trade.`,
        });
        continue;
      }
      if (result.lossBps > policy.maxQuoteLossBps) {
        rejected.push({
          quote,
          why: `Fee is ${result.lossBps.toFixed(0)} bps, over the ${policy.maxQuoteLossBps} bps cap.`,
        });
        continue;
      }
      if (plan.reason === "yield") {
        const dest = venues.find((venue) => venue.assetKey === plan.toKey && venue.role === "target");
        const src = venues.find((venue) => venue.assetKey === quote.fromKey && venue.role === "target");
        const edge = (dest?.apyPercent ?? 0) - (src?.apyPercent ?? 0);
        const days = daysToEarnFee(result.lossBps, edge);
        if (days > policy.yieldHorizonDays) {
          rejected.push({
            quote,
            why: `Yield gap earns the fee back in ${days.toFixed(0)} days, past the ${policy.yieldHorizonDays} day horizon.`,
          });
          continue;
        }
      }
      eligible.push({ ...quote, result });
    }

    eligible.sort((a, b) => a.result.lossBps - b.result.lossBps || a.result.timeEstimateSec - b.result.timeEstimateSec);
    const chosen = eligible[0] ?? null;
    if (!chosen) {
      const cheapest = related
        .filter(isQuoteOk)
        .sort((a, b) => a.result.lossBps - b.result.lossBps)[0];
      const holdReason = cheapest
        ? `No eligible quote. The tightest price was ${assetByKey(cheapest.fromKey).symbol} to ${assetByKey(cheapest.toKey).symbol} at ${cheapest.result.lossBps.toFixed(0)} bps.`
        : "No route returned a usable dry quote.";
      return { plan, chosen: null, rejected, holdReason };
    }
    for (const quote of eligible.slice(1)) {
      rejected.push({ quote, why: "Eligible, but a cheaper quote was selected." });
    }
    return { plan, chosen, rejected };
  });
}

export function applyPaperFills(book: Position[], legs: DecisionLeg[]): Position[] {
  const next = book.map((position) => ({ ...position }));
  const byKey = new Map(next.map((position) => [position.key, position]));
  for (const leg of legs) {
    if (!leg.chosen || !leg.chosen.result.ok) continue;
    const source = byKey.get(leg.chosen.fromKey);
    const dest = byKey.get(leg.chosen.toKey);
    if (!source || !dest) throw new Error("Quote referenced a missing position");
    source.amount = subDecimal(source.amount, leg.chosen.result.amountInFormatted);
    dest.amount = addDecimal(dest.amount, leg.chosen.result.amountOutFormatted);
  }
  for (const position of next) parseDecimal(position.amount);
  return next;
}

export function buildDecision(
  legs: DecisionLeg[],
  yields: Venue[],
  contextYield: Venue | null,
): Decision {
  return {
    action: legs.some((leg) => leg.chosen) ? "rebalance" : "hold",
    legs,
    yields,
    contextYield,
  };
}

export function markedByKey(positions: MarkedPosition[]): Map<string, MarkedPosition> {
  return new Map(positions.map((position) => [position.key, position]));
}
