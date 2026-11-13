import { describe, expect, it } from "vitest";
import { base58 } from "@scure/base";
import { addressForEntry, buildRegistryQuote } from "../src/intents.js";
import { CHAINS, chainById, demoChains } from "../src/chains.js";

describe("chain registry", () => {
  it("keeps the demo to NEAR, BSC, and Solana", () => {
    expect(demoChains().map((chain) => chain.id)).toEqual(["near", "bsc", "solana"]);
    expect(CHAINS.filter((chain) => chain.demo).every((chain) => chain.assets.length > 0)).toBe(true);
  });

  it("derives an EVM address for a non-demo registry row and builds a dry quote", () => {
    const base = chainById("base");
    expect(base.demo).toBe(false);
    expect(base.family).toBe("evm");
    expect(base.derivation).toEqual({ path: "base-1", domainId: 0, scheme: "secp256k1" });

    const xy = new Uint8Array(64);
    for (let i = 0; i < 64; i += 1) xy[i] = (i * 7 + 3) & 255;
    const mpcKey = `secp256k1:${base58.encode(xy)}`;
    const address = addressForEntry(base, mpcKey);
    expect(address).toBe("0xbe85f3dc536fc93df590c2d20ca9b28af1ed2c39");

    const eth = base.assets.find((asset) => asset.symbol === "ETH");
    expect(eth?.assetId).toBe("nep141:base.omft.near");
    const request = buildRegistryQuote({
      entry: base,
      assetId: eth!.assetId,
      amount: "20000000000000000000000000",
      recipient: address,
      refundTo: "near",
      now: new Date("2026-11-13T12:00:00.000Z"),
    });
    expect(request.dry).toBe(true);
    expect(request.destinationAsset).toBe("nep141:base.omft.near");
    expect(request.recipient).toBe(address);
    expect(request.refundTo).toBe("near");
    expect(request.originAsset).toBe("nep141:wrap.near");
  });

  it("records Hyperliquid as routable assets, not a demo chain", () => {
    const hl = chainById("hypercore");
    expect(hl.demo).toBe(false);
    expect(hl.family).toBe("other");
    expect(hl.derivation).toBeUndefined();
    expect(hl.assets.map((asset) => asset.symbol).sort()).toEqual(["USDC", "USDC", "wNEAR"]);
    expect(hl.assets.some((asset) => asset.symbol === "HYPE")).toBe(false);
    expect(hl.note).toMatch(/Routable via NEAR Intents/);
    expect(hl.note).toMatch(/not a trading integration/i);
  });
});
