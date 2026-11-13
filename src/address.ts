import { keccak_256 } from "@noble/hashes/sha3";
import { base58 } from "@scure/base";

export function evmAddressFromUncompressed(xy: Uint8Array): string {
  const body = xy.length === 65 && xy[0] === 0x04 ? xy.slice(1) : xy;
  if (body.length !== 64) {
    throw new Error(`Expected a 64-byte secp256k1 key, got ${xy.length}`);
  }
  const hash = keccak_256(body);
  const addr = hash.slice(12);
  let hex = "0x";
  for (const byte of addr) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

export function parseMpcPublicKey(raw: string): { scheme: "secp256k1" | "ed25519"; data: string } {
  const text = raw.trim().replace(/^"|"$/g, "");
  const split = text.indexOf(":");
  if (split < 0) throw new Error("MPC key is missing a scheme prefix");
  const scheme = text.slice(0, split);
  const data = text.slice(split + 1);
  if (scheme !== "secp256k1" && scheme !== "ed25519") {
    throw new Error(`Unsupported MPC scheme ${scheme}`);
  }
  if (!data) throw new Error("MPC key payload is empty");
  return { scheme, data };
}

export function addressFromMpcKey(raw: string): { scheme: "secp256k1" | "ed25519"; address: string } {
  const parsed = parseMpcPublicKey(raw);
  if (parsed.scheme === "ed25519") {
    const bytes = base58.decode(parsed.data);
    if (bytes.length !== 32) throw new Error(`Ed25519 key decoded to ${bytes.length} bytes`);
    return { scheme: "ed25519", address: parsed.data };
  }
  const bytes = base58.decode(parsed.data);
  return { scheme: "secp256k1", address: evmAddressFromUncompressed(bytes) };
}

/** NEAR account id, including 64-char implicit accounts. */
export function isNearAccount(id: string): boolean {
  return id.length >= 2 && id.length <= 64 && /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(id);
}
