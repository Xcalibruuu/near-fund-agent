import { addressFromMpcKey, isNearAccount } from "./address.js";
import { chainById } from "./chains.js";
import type { DerivedAddresses, LlamaPool, TokenPrice } from "./types.js";

export const DEFAULT_ONECLICK = "https://1click.chaindefuser.com";
export const DEFAULT_RPC = "https://rpc.mainnet.near.org";
export const YIELDS_URL = "https://yields.llama.fi/pools";
export const SIGNER_CONTRACT = "v1.signer";

const USER_AGENT = "near-fund-agent/0.1 (+https://github.com/Xcalibruuu/near-fund-agent)";

type FetchLike = typeof fetch;

function headers(extra?: Record<string, string>): HeadersInit {
  return {
    Accept: "application/json",
    "User-Agent": USER_AGENT,
    ...extra,
  };
}

export async function fetchTokenPrices(base = DEFAULT_ONECLICK, fetchImpl: FetchLike = fetch): Promise<TokenPrice[]> {
  const response = await fetchImpl(`${base.replace(/\/$/, "")}/v0/tokens`, { headers: headers() });
  if (!response.ok) throw new Error(`Token list failed (${response.status})`);
  const body = (await response.json()) as Array<{
    assetId: string;
    symbol: string;
    blockchain: string;
    decimals: number;
    price?: number | string;
    priceUpdatedAt?: string;
  }>;
  if (!Array.isArray(body)) throw new Error("Token list was not a list");
  return body.map((token) => ({
    assetId: token.assetId,
    symbol: token.symbol,
    blockchain: token.blockchain,
    decimals: token.decimals,
    priceUsd: Number(token.price ?? 0),
    priceUpdatedAt: token.priceUpdatedAt,
  }));
}

export async function fetchYieldPools(fetchImpl: FetchLike = fetch): Promise<LlamaPool[]> {
  const response = await fetchImpl(YIELDS_URL, { headers: headers() });
  if (!response.ok) throw new Error(`Yield list failed (${response.status})`);
  const body = (await response.json()) as { data?: LlamaPool[] } | LlamaPool[];
  const pools = Array.isArray(body) ? body : body.data;
  if (!Array.isArray(pools)) throw new Error("Yield list was not a list");
  return pools;
}

export async function postDryQuote(
  request: { dry: true },
  base = DEFAULT_ONECLICK,
  fetchImpl: FetchLike = fetch,
  jwt?: string,
): Promise<unknown> {
  if (request.dry !== true) throw new Error("postDryQuote refuses a non-dry body");
  const extra: Record<string, string> = { "Content-Type": "application/json" };
  if (jwt) extra.Authorization = `Bearer ${jwt}`;
  const response = await fetchImpl(`${base.replace(/\/$/, "")}/v0/quote`, {
    method: "POST",
    headers: headers(extra),
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(12_000),
  });
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text.slice(0, 180) || `Quote failed (${response.status})` };
  }
}

function utf8ToBase64(value: string): string {
  const bufferish = (globalThis as { Buffer?: { from(text: string, encoding: string): { toString(encoding: string): string } } }).Buffer;
  if (bufferish) return bufferish.from(value, "utf8").toString("base64");
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function derivedKey(
  rpcUrl: string,
  args: { path: string; predecessor: string; domain_id: number },
  fetchImpl: FetchLike,
): Promise<string> {
  const response = await fetchImpl(rpcUrl, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "near-fund-agent",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: SIGNER_CONTRACT,
        method_name: "derived_public_key",
        args_base64: utf8ToBase64(JSON.stringify(args)),
      },
    }),
  });
  if (!response.ok) throw new Error(`NEAR RPC failed (${response.status})`);
  const body = (await response.json()) as {
    error?: { message?: string };
    result?: { result?: number[]; error?: string };
  };
  if (body.error) throw new Error(body.error.message || "NEAR RPC error");
  const raw = body.result?.result;
  if (!raw) throw new Error(body.result?.error || "Missing derived key");
  const text = new TextDecoder().decode(Uint8Array.from(raw));
  return JSON.parse(text) as string;
}

export async function deriveAddresses(
  accountId: string,
  rpcUrl = DEFAULT_RPC,
  fetchImpl: FetchLike = fetch,
): Promise<DerivedAddresses> {
  if (!isNearAccount(accountId)) throw new Error("That is not a NEAR account id");
  const bsc = chainById("bsc");
  const solana = chainById("solana");
  if (!bsc.derivation || !solana.derivation) throw new Error("Demo chains are missing derivation");
  const [bscKey, solKey] = await Promise.all([
    derivedKey(
      rpcUrl,
      { path: bsc.derivation.path, predecessor: accountId, domain_id: bsc.derivation.domainId },
      fetchImpl,
    ),
    derivedKey(
      rpcUrl,
      { path: solana.derivation.path, predecessor: accountId, domain_id: solana.derivation.domainId },
      fetchImpl,
    ),
  ]);
  return {
    accountId,
    bsc: addressFromMpcKey(bscKey).address,
    solana: addressFromMpcKey(solKey).address,
    bscPath: bsc.derivation.path,
    solanaPath: solana.derivation.path,
    contractId: SIGNER_CONTRACT,
  };
}
