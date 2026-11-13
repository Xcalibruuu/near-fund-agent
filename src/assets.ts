import { CHAINS, demoChains } from "./chains.js";
import type { Asset, ChainId, Sleeve } from "./types.js";

/**
 * Paper-book assets. Ids are pinned from GET /v0/tokens so a cycle does not
 * pick a deprecated row. BSC USDT is included because that is the inventory
 * pair. The solver has returned 500 for it. The agent records that and uses
 * another route.
 *
 * Chains that are not in the demo (Base, Ethereum, Arbitrum, Optimism,
 * Hyperliquid) live on the registry in src/chains.ts and are not positions.
 */
function demoAssets(): Record<string, Asset> {
  const book: Record<string, Asset> = {};
  for (const chain of demoChains()) {
    for (const asset of chain.assets) {
      book[asset.key] = {
        key: asset.key,
        chain: chain.id as ChainId,
        symbol: asset.symbol,
        sleeve: asset.sleeve,
        decimals: asset.decimals,
        assetId: asset.assetId,
      };
    }
  }
  return book;
}

export const ASSETS: Record<string, Asset> = demoAssets();

export const ASSET_LIST = Object.values(ASSETS);

export const SLEEVES: Sleeve[] = ["NEAR", "BNB", "SOL", "STABLE"];

export function assetByKey(key: string): Asset {
  const asset = ASSETS[key];
  if (!asset) throw new Error(`Unknown asset ${key}`);
  return asset;
}

/** The asset a sleeve buys when it is underweight. */
export const SLEEVE_BUY: Record<Sleeve, string> = {
  NEAR: "wNEAR",
  BNB: "bnb",
  SOL: "sol",
  STABLE: "nearUsdt",
};

export const CHAIN_LABEL: Record<ChainId, string> = {
  near: "NEAR",
  bsc: "BSC",
  solana: "Solana",
};

export function chainLabel(id: string): string {
  return CHAINS.find((chain) => chain.id === id)?.label ?? id;
}
