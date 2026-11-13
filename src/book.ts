import { ASSET_LIST, assetByKey } from "./assets.js";
import { parseDecimal } from "./money.js";
import type { Position } from "./types.js";

/**
 * A drifted paper book shaped like a small operator who already runs a BSC
 * WBNB/USDT liquidity bot and a Solana trading bot, with NEAR as the account
 * that would control both. Balances are simulated. Prices are not.
 *
 * wNEAR is deliberately heavy so the first cycle has a real rebalance to
 * explain. BNB and SOL inventory are thin.
 */
export const INITIAL_BOOK: Position[] = [
  { key: "wNEAR", amount: "820" },
  { key: "nearUsdt", amount: "350" },
  { key: "bnb", amount: "0.42" },
  { key: "bscUsdt", amount: "600" },
  { key: "bscUsdc", amount: "180" },
  { key: "sol", amount: "1.8" },
  { key: "solUsdc", amount: "280" },
];

export function cloneBook(book: Position[]): Position[] {
  return book.map((position) => ({ ...position }));
}

export function sanitizeBook(input: unknown): Position[] {
  if (!Array.isArray(input)) throw new Error("Book must be a list of positions");
  if (input.length === 0 || input.length > 20) throw new Error("Book length is out of range");
  const seen = new Set<string>();
  const book: Position[] = [];
  for (const row of input) {
    if (!row || typeof row !== "object") throw new Error("Bad position");
    const key = (row as { key?: unknown }).key;
    const amount = (row as { amount?: unknown }).amount;
    if (typeof key !== "string" || typeof amount !== "string") throw new Error("Bad position");
    assetByKey(key);
    if (amount.length > 40 || !/^\d+(\.\d+)?$/.test(amount)) throw new Error(`Bad amount for ${key}`);
    if (seen.has(key)) throw new Error(`Duplicate position ${key}`);
    seen.add(key);
    parseDecimal(amount);
    book.push({ key, amount });
  }
  for (const asset of ASSET_LIST) {
    if (!seen.has(asset.key)) book.push({ key: asset.key, amount: "0" });
  }
  return book;
}
