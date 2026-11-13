import { ASSET_LIST, SLEEVES, assetByKey } from "./assets.js";
import { parseDecimal } from "./money.js";
import type { MarkedPosition, Policy, Position, SleeveSnapshot, TokenPrice } from "./types.js";

export function priceMap(tokens: TokenPrice[]): Map<string, TokenPrice> {
  const map = new Map<string, TokenPrice>();
  for (const token of tokens) map.set(token.assetId, token);
  return map;
}

export function markBook(book: Position[], tokens: TokenPrice[]): MarkedPosition[] {
  const prices = priceMap(tokens);
  return book.map((position) => {
    const asset = assetByKey(position.key);
    const token = prices.get(asset.assetId);
    const priceUsd = token?.priceUsd ?? 0;
    const amount = parseDecimal(position.amount);
    return {
      ...position,
      asset,
      priceUsd,
      valueUsd: amount * priceUsd,
    };
  });
}

export function totalValue(positions: MarkedPosition[]): number {
  return positions.reduce((sum, position) => sum + position.valueUsd, 0);
}

export function sleeveSnapshots(positions: MarkedPosition[], policy: Policy): SleeveSnapshot[] {
  const total = totalValue(positions);
  return SLEEVES.map((sleeve) => {
    const valueUsd = positions
      .filter((position) => position.asset.sleeve === sleeve)
      .reduce((sum, position) => sum + position.valueUsd, 0);
    const weight = total > 0 ? valueUsd / total : 0;
    const target = policy.targets[sleeve];
    const drift = weight - target;
    return {
      sleeve,
      valueUsd,
      weight,
      target,
      drift,
      driftBps: drift * 10_000,
    };
  });
}

export function positionValue(positions: MarkedPosition[], key: string): number {
  return positions.find((position) => position.key === key)?.valueUsd ?? 0;
}

export function knownAssetIds(): string[] {
  return ASSET_LIST.map((asset) => asset.assetId);
}
