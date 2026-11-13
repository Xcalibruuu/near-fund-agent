import type { Sleeve } from "./types.js";

export type ChainFamily = "evm" | "svm" | "near" | "other";

export type ChainAssetRef = {
  key: string;
  symbol: string;
  sleeve: Sleeve;
  decimals: number;
  /** Live id from GET https://1click.chaindefuser.com/v0/tokens */
  assetId: string;
};

export type ChainDerivation = {
  path: string;
  /** 0 secp256k1 (EVM), 1 ed25519 (Solana and similar). */
  domainId: 0 | 1;
  scheme: "secp256k1" | "ed25519";
};

/**
 * One row per chain. `demo: true` is the paper book (NEAR, BSC, Solana).
 * Other rows are chains the live 1Click list knows about and, where noted,
 * a dry quote has priced. They are not in the demo.
 */
export type ChainEntry = {
  id: string;
  label: string;
  family: ChainFamily;
  demo: boolean;
  derivation?: ChainDerivation;
  /** Explorer URL with a `{address}` placeholder. Empty when we have not checked one. */
  explorer: string;
  assets: ChainAssetRef[];
  /** What we actually checked. Not a marketing claim. */
  note: string;
};

const CHECKED = "13 Nov 2026";

export const CHAINS: ChainEntry[] = [
  {
    id: "near",
    label: "NEAR",
    family: "near",
    demo: true,
    explorer: "https://nearblocks.io/address/{address}",
    assets: [
      { key: "wNEAR", symbol: "wNEAR", sleeve: "NEAR", decimals: 24, assetId: "nep141:wrap.near" },
      {
        key: "nearUsdt",
        symbol: "USDT",
        sleeve: "STABLE",
        decimals: 6,
        assetId: "nep141:usdt.tether-token.near",
      },
    ],
    note: "Home chain of the paper book. Quotes and the NEAR account id were checked in the demo.",
  },
  {
    id: "bsc",
    label: "BSC",
    family: "evm",
    demo: true,
    derivation: { path: "bsc-1", domainId: 0, scheme: "secp256k1" },
    explorer: "https://bscscan.com/address/{address}",
    assets: [
      { key: "bnb", symbol: "BNB", sleeve: "BNB", decimals: 18, assetId: "nep141:bnb.omdep.near" },
      {
        key: "bscUsdt",
        symbol: "USDT",
        sleeve: "STABLE",
        decimals: 18,
        assetId: "nep141:bnb-0x55d398326f99059ff775485246999027b3197955.omdep.near",
      },
      {
        key: "bscUsdc",
        symbol: "USDC",
        sleeve: "STABLE",
        decimals: 18,
        assetId: "nep141:bnb-0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d.omdep.near",
      },
    ],
    note: "Tested in the demo. Chain-signature path bsc-1, domain 0.",
  },
  {
    id: "solana",
    label: "Solana",
    family: "svm",
    demo: true,
    derivation: { path: "solana-1", domainId: 1, scheme: "ed25519" },
    explorer: "https://solscan.io/account/{address}",
    assets: [
      { key: "sol", symbol: "SOL", sleeve: "SOL", decimals: 9, assetId: "nep141:sol.omft.near" },
      {
        key: "solUsdc",
        symbol: "USDC",
        sleeve: "STABLE",
        decimals: 6,
        assetId: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near",
      },
    ],
    note: "Tested in the demo. Chain-signature path solana-1, domain 1. The ed25519 key is the address.",
  },
  {
    id: "eth",
    label: "Ethereum",
    family: "evm",
    demo: false,
    derivation: { path: "eth-1", domainId: 0, scheme: "secp256k1" },
    explorer: "https://etherscan.io/address/{address}",
    assets: [
      { key: "eth", symbol: "ETH", sleeve: "STABLE", decimals: 18, assetId: "nep141:eth.omft.near" },
      {
        key: "ethUsdc",
        symbol: "USDC",
        sleeve: "STABLE",
        decimals: 6,
        assetId: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near",
      },
    ],
    note: `On the live token list as blockchain "eth". A dry quote from 20 wNEAR into ETH returned a price on ${CHECKED}. Not in the paper book. sign has not been called.`,
  },
  {
    id: "base",
    label: "Base",
    family: "evm",
    demo: false,
    derivation: { path: "base-1", domainId: 0, scheme: "secp256k1" },
    explorer: "https://basescan.org/address/{address}",
    assets: [
      { key: "baseEth", symbol: "ETH", sleeve: "STABLE", decimals: 18, assetId: "nep141:base.omft.near" },
      {
        key: "baseUsdc",
        symbol: "USDC",
        sleeve: "STABLE",
        decimals: 6,
        assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
      },
    ],
    note: `On the live token list as blockchain "base". A dry quote from 20 wNEAR into ETH on Base returned a price on ${CHECKED}. The same call with Base USDC as the origin returned an internal error, so only the wNEAR-to-ETH direction is checked. Not in the paper book.`,
  },
  {
    id: "arb",
    label: "Arbitrum",
    family: "evm",
    demo: false,
    derivation: { path: "arb-1", domainId: 0, scheme: "secp256k1" },
    explorer: "https://arbiscan.io/address/{address}",
    assets: [
      { key: "arbEth", symbol: "ETH", sleeve: "STABLE", decimals: 18, assetId: "nep141:arb.omft.near" },
      {
        key: "arbUsdc",
        symbol: "USDC",
        sleeve: "STABLE",
        decimals: 6,
        assetId: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near",
      },
    ],
    note: `On the live token list as blockchain "arb". A dry quote from 20 wNEAR into ETH on Arbitrum returned a price on ${CHECKED}. Not in the paper book.`,
  },
  {
    id: "op",
    label: "Optimism",
    family: "evm",
    demo: false,
    derivation: { path: "op-1", domainId: 0, scheme: "secp256k1" },
    explorer: "https://optimistic.etherscan.io/address/{address}",
    assets: [
      {
        key: "opEth",
        symbol: "ETH",
        sleeve: "STABLE",
        decimals: 18,
        assetId: "nep245:v2_1.omni.hot.tg:10_11111111111111111111",
      },
    ],
    note: `On the live token list as blockchain "op". ETH, WETH, and USDC there use the older nep245 ids, not the nep141 form used on Ethereum, Base, and Arbitrum. A dry quote from that ETH id into wNEAR returned a price on ${CHECKED}. Not in the paper book.`,
  },
  {
    id: "hypercore",
    label: "Hyperliquid",
    family: "other",
    demo: false,
    explorer: "",
    assets: [
      {
        key: "hlUsdcHip1",
        symbol: "USDC",
        sleeve: "STABLE",
        decimals: 8,
        assetId: "1cs_v1:hypercore:hip1:0x6d1e7cde53ba9467b783cb7c530ce054",
      },
      {
        key: "hlUsdcErc20",
        symbol: "USDC",
        sleeve: "STABLE",
        decimals: 6,
        assetId: "1cs_v1:hypercore:erc20:0xb88339CB7199b77E23DB6E890353E22632Ba630f",
      },
      {
        key: "hlWnear",
        symbol: "wNEAR",
        sleeve: "NEAR",
        decimals: 8,
        assetId: "1cs_v1:hypercore:hip1:0x20b8c9d2f022ffd2aea4f7962b7b1d8b",
      },
    ],
    note: `Routable via NEAR Intents for USDC and wNEAR. blockchain "hypercore" on the live list, three assets, no HYPE token. Dry quotes on ${CHECKED}: 20 wNEAR to HIP-1 USDC (about 70.5 USDC) and to the erc20 USDC id (about 70.5 USDC), and 15 wNEAR to Hyperliquid wNEAR (about 14.99). The erc20 USDC id was rejected as an origin. No chain-signature path is wired for Hyperliquid orders. Not a trading integration and not in the demo.`,
  },
];

export function chainById(id: string): ChainEntry {
  const chain = CHAINS.find((entry) => entry.id === id);
  if (!chain) throw new Error(`Unknown chain ${id}`);
  return chain;
}

export function demoChains(): ChainEntry[] {
  return CHAINS.filter((entry) => entry.demo);
}

export function evmChains(): ChainEntry[] {
  return CHAINS.filter((entry) => entry.family === "evm");
}

export function explorerUrl(entry: ChainEntry, address: string): string | null {
  if (!entry.explorer) return null;
  return entry.explorer.replace("{address}", address);
}
