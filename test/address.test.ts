import { describe, expect, it } from "vitest";
import { base58 } from "@scure/base";
import { addressFromMpcKey, evmAddressFromUncompressed, isNearAccount } from "../src/address.js";

describe("chain signature addresses", () => {
  it("turns a 64-byte secp256k1 key into an EVM address", () => {
    const xy = new Uint8Array(64);
    for (let i = 0; i < 64; i += 1) xy[i] = (i * 7 + 3) & 255;
    expect(evmAddressFromUncompressed(xy)).toBe("0xbe85f3dc536fc93df590c2d20ca9b28af1ed2c39");
    const encoded = `secp256k1:${base58.encode(xy)}`;
    expect(addressFromMpcKey(encoded).address).toBe("0xbe85f3dc536fc93df590c2d20ca9b28af1ed2c39");
  });

  it("accepts a 65-byte key that still has the 0x04 prefix", () => {
    const xy = new Uint8Array(64);
    for (let i = 0; i < 64; i += 1) xy[i] = (i * 7 + 3) & 255;
    const prefixed = new Uint8Array(65);
    prefixed[0] = 0x04;
    prefixed.set(xy, 1);
    expect(evmAddressFromUncompressed(prefixed)).toBe(evmAddressFromUncompressed(xy));
  });

  it("uses the ed25519 payload as the Solana address", () => {
    const raw = "ed25519:2QergEo7PxaMAD83ntGBQ2SdDSC3cL2pdYB5shvCjhFS";
    expect(addressFromMpcKey(raw)).toEqual({
      scheme: "ed25519",
      address: "2QergEo7PxaMAD83ntGBQ2SdDSC3cL2pdYB5shvCjhFS",
    });
  });

  it("checks NEAR account ids", () => {
    expect(isNearAccount("near")).toBe(true);
    expect(isNearAccount("fund-agent.near")).toBe(true);
    expect(isNearAccount("A".repeat(64))).toBe(false);
    expect(isNearAccount("nope!")).toBe(false);
  });
});
