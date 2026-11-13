import type { Asset, Sleeve } from "./types.js";

/**
 * Asset ids are the live 1Click identifiers (GET /v0/tokens), pinned so a
 * paper cycle does not depend on a search through deprecated nep245 rows.
 * BSC USDT is listed because that is the inventory pair, and the solver
 * currently returns 500 for it. The agent still requests the quote and
 * records the failure, then uses another route.
 */
export const ASSETS: Record<string, Asset> = {
  wNEAR: {
    key: "wNEAR",
    chain: "near",
    symbol: "wNEAR",
    sleeve: "NEAR",
    decimals: 24,
    assetId: "nep141:wrap.near",
  },
  nearUsdt: {
    key: "nearUsdt",
    chain: "near",
    symbol: "USDT",
    sleeve: "STABLE",
    decimals: 6,
    assetId: "nep141:usdt.tether-token.near",
  },
  bnb: {
    key: "bnb",
    chain: "bsc",
    symbol: "BNB",
    sleeve: "BNB",
    decimals: 18,
    assetId: "nep141:bnb.omdep.near",
  },
  bscUsdt: {
    key: "bscUsdt",
    chain: "bsc",
    symbol: "USDT",
    sleeve: "STABLE",
    decimals: 18,
    assetId: "nep141:bnb-0x55d398326f99059ff775485246999027b3197955.omdep.near",
  },
  bscUsdc: {
    key: "bscUsdc",
    chain: "bsc",
    symbol: "USDC",
    sleeve: "STABLE",
    decimals: 18,
    assetId: "nep141:bnb-0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d.omdep.near",
  },
  sol: {
    key: "sol",
    chain: "solana",
    symbol: "SOL",
    sleeve: "SOL",
    decimals: 9,
    assetId: "nep141:sol.omft.near",
  },
  solUsdc: {
    key: "solUsdc",
    chain: "solana",
    symbol: "USDC",
    sleeve: "STABLE",
    decimals: 6,
    assetId: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near",
  },
};

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

export const CHAIN_LABEL: Record<Asset["chain"], string> = {
  near: "NEAR",
  bsc: "BSC",
  solana: "Solana",
};
