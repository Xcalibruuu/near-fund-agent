import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { knownAssetIds } from "./portfolio.js";
import { INITIAL_BOOK, sanitizeBook } from "./book.js";
import { DEFAULT_POLICY } from "./policy.js";
import { runCycle } from "./cycle.js";
import {
  DEFAULT_ONECLICK,
  DEFAULT_RPC,
  deriveAddresses,
  fetchTokenPrices,
  fetchYieldPools,
  postDryQuote,
} from "./clients.js";
import { buildDryQuoteRequest } from "./intents.js";
import { buildLiveQuoteRequest } from "./live-quote.js";
import { liveQuoteAllowed, llmMode } from "./live-gate.js";
import { rewriteMemo } from "./llm.js";
import { selectContextPool, selectVenues } from "./yields.js";
import { interpretGoal, sanitizePolicy } from "./goal.js";
import type { LlamaPool, TokenPrice } from "./types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");

function loadDotEnv(): void {
  const file = path.join(root, ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

const port = Number(process.env.PORT || 8787);
const oneclick = process.env.ONECLICK_BASE_URL || DEFAULT_ONECLICK;
const rpc = process.env.NEAR_RPC_URL || DEFAULT_RPC;

let prices: { at: number; tokens: TokenPrice[] } | null = null;
let pools: { at: number; rows: LlamaPool[] } | null = null;

async function getPrices(): Promise<TokenPrice[]> {
  if (prices && Date.now() - prices.at < 60_000) return prices.tokens;
  const tokens = await fetchTokenPrices(oneclick);
  prices = { at: Date.now(), tokens };
  return tokens;
}

async function getPools(): Promise<LlamaPool[]> {
  if (pools && Date.now() - pools.at < 5 * 60_000) return pools.rows;
  const rows = await fetchYieldPools();
  pools = { at: Date.now(), rows };
  return rows;
}

function send(res: ServerResponse, status: number, body: unknown, type = "application/json"): void {
  const payload = type === "application/json" ? JSON.stringify(body) : String(body);
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > 100_000) throw new Error("Body too large");
    chunks.push(buf);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};

function serveStatic(res: ServerResponse, pathname: string): void {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const file = path.normalize(path.join(publicDir, requested));
  if (!file.startsWith(publicDir)) {
    send(res, 403, { message: "Forbidden" });
    return;
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    send(res, 404, { message: "Not found" });
    return;
  }
  const ext = path.extname(file);
  res.writeHead(200, { "Content-Type": TYPES[ext] || "application/octet-stream" });
  res.end(readFileSync(file));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/health") {
      send(res, 200, {
        ok: true,
        product: "NEAR Fund Agent",
        mode: "paper",
        liveUnlocked: liveQuoteAllowed(),
        llm: llmMode(),
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/market") {
      const [tokens, rows] = await Promise.all([getPrices(), getPools()]);
      const wanted = new Set(knownAssetIds());
      const accountId = url.searchParams.get("account") || "";
      let addresses = null;
      let addressError: string | undefined;
      if (accountId) {
        try {
          addresses = await deriveAddresses(accountId, rpc);
        } catch (error) {
          addressError = error instanceof Error ? error.message : "Derivation failed";
        }
      }
      send(res, 200, {
        prices: tokens.filter((token) => wanted.has(token.assetId)),
        venues: selectVenues(rows, DEFAULT_POLICY),
        context: selectContextPool(rows),
        addresses,
        addressError,
        book: INITIAL_BOOK,
        policy: DEFAULT_POLICY,
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/cycle") {
      const body = (await readJson(req)) as { accountId?: string; book?: unknown; policy?: unknown };
      const accountId = body.accountId || "near";
      const policy = sanitizePolicy(body.policy);
      const book = sanitizeBook(body.book ?? INITIAL_BOOK);
      const [tokens, rows] = await Promise.all([getPrices(), getPools()]);
      let addresses = null;
      let addressError: string | undefined;
      try {
        addresses = await deriveAddresses(accountId, rpc);
      } catch (error) {
        addressError = error instanceof Error ? error.message : "Derivation failed";
      }
      const result = await runCycle({
        book,
        policy,
        accountId,
        clients: {
          prices: tokens,
          pools: rows,
          addresses,
          addressError,
          quote: async (_job, request) => postDryQuote(request, oneclick, fetch, process.env.ONECLICK_JWT),
          llm: (memo) => rewriteMemo(memo),
        },
      });
      send(res, 200, result);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/goal") {
      const body = (await readJson(req)) as { goal?: string };
      send(res, 200, await interpretGoal(String(body.goal ?? "")));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/live-quote") {
      if (!liveQuoteAllowed()) {
        send(res, 403, {
          message: "Live quotes are off. Set FUND_AGENT_MODE=live and FUND_AGENT_CONFIRM_LIVE=yes. This still does not broadcast a transfer.",
        });
        return;
      }
      const body = (await readJson(req)) as { fromKey?: string; toKey?: string; usd?: number; accountId?: string };
      if (!body.fromKey || !body.toKey || !body.usd || !body.accountId) {
        send(res, 400, { message: "fromKey, toKey, usd, and accountId are required" });
        return;
      }
      const tokens = await getPrices();
      const addresses = await deriveAddresses(body.accountId, rpc);
      const dry = buildDryQuoteRequest({
        job: {
          id: "live",
          fromKey: body.fromKey,
          toKey: body.toKey,
          usd: body.usd,
          purpose: "candidate",
          planId: "live",
        },
        prices: tokens,
        addresses,
        accountId: body.accountId,
        now: new Date(),
      });
      const request = buildLiveQuoteRequest(dry);
      const response = await fetch(`${oneclick.replace(/\/$/, "")}/v0/quote`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(process.env.ONECLICK_JWT ? { Authorization: `Bearer ${process.env.ONECLICK_JWT}` } : {}),
        },
        body: JSON.stringify(request),
      });
      const payload = await response.json();
      send(res, response.ok ? 200 : 502, {
        warning: "This is a deposit address from 1Click. The server did not send funds. Paper mode is the supported demo.",
        payload,
      });
      return;
    }
    if (req.method === "GET") {
      serveStatic(res, url.pathname);
      return;
    }
    send(res, 405, { message: "Method not allowed" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Server error";
    send(res, 400, { message });
  }
});

server.listen(port, () => {
  console.log(`NEAR Fund Agent desk  http://localhost:${port}`);
  console.log(`Mode: paper. Live quotes unlocked: ${liveQuoteAllowed()}`);
});
