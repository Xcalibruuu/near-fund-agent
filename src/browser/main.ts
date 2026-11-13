import { ASSETS, CHAIN_LABEL, assetByKey } from "../assets.js";
import { INITIAL_BOOK, cloneBook, sanitizeBook } from "../book.js";
import { deriveAddresses, fetchTokenPrices, fetchYieldPools, postDryQuote } from "../clients.js";
import { runCycle } from "../cycle.js";
import { formatAmount, formatBps, formatUsd } from "../money.js";
import { DEFAULT_POLICY } from "../policy.js";
import { markBook, sleeveSnapshots, totalValue } from "../portfolio.js";
import type {
  CycleResult,
  DerivedAddresses,
  MarkedPosition,
  Position,
  ScoredQuote,
  SleeveSnapshot,
  TokenPrice,
  Venue,
} from "../types.js";
import { selectContextPool, selectVenues } from "../yields.js";

const BOOK_KEY = "nfa-book-v1";
const LOG_KEY = "nfa-log-v1";

type LogItem = {
  ranAt: string;
  action: string;
  totalUsd: number;
  memo: string[];
  llmMemo?: string;
  memoSource: string;
};

const CHAIN_COLOR: Record<string, string> = {
  near: "#1f6b45",
  bsc: "#a68445",
  solana: "#c45c26",
};

const state: {
  book: Position[];
  prices: TokenPrice[];
  venues: Venue[];
  context: Venue | null;
  addresses: DerivedAddresses | null;
  addressError?: string;
  result: CycleResult | null;
  log: LogItem[];
  busy: boolean;
  status: string;
  warn: boolean;
  server: boolean;
} = {
  book: loadBook(),
  prices: [],
  venues: [],
  context: null,
  addresses: null,
  result: null,
  log: loadLog(),
  busy: false,
  status: "Opening the book…",
  warn: false,
  server: false,
};

function loadBook(): Position[] {
  try {
    const raw = localStorage.getItem(BOOK_KEY);
    if (!raw) return cloneBook(INITIAL_BOOK);
    return sanitizeBook(JSON.parse(raw) as unknown);
  } catch {
    return cloneBook(INITIAL_BOOK);
  }
}

function loadLog(): LogItem[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LogItem[];
    return Array.isArray(parsed) ? parsed.slice(0, 6) : [];
  } catch {
    return [];
  }
}

function persist(): void {
  localStorage.setItem(BOOK_KEY, JSON.stringify(state.book));
  localStorage.setItem(LOG_KEY, JSON.stringify(state.log.slice(0, 6)));
}

function accountId(): string {
  return (document.querySelector<HTMLInputElement>("#account")?.value || "near").trim().toLowerCase();
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function clear(parent: Element): void {
  while (parent.firstChild) parent.removeChild(parent.firstChild);
}

function setStatus(text: string, warn = false): void {
  state.status = text;
  state.warn = warn;
  const status = document.querySelector("#status");
  if (!status) return;
  status.textContent = text;
  status.classList.toggle("warn", warn);
}

async function boot(): Promise<void> {
  try {
    const health = await fetch("api/health", { signal: AbortSignal.timeout(2000) })
      .then(async (response) => (response.ok ? ((await response.json()) as { ok?: boolean }) : null))
      .catch(() => null);
    if (health?.ok) {
      state.server = true;
      await refreshFromServer();
    } else {
      state.server = false;
      await refreshDirect();
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "The feeds did not load.", true);
  }
  render();
}

async function refreshFromServer(): Promise<void> {
  setStatus("Marking the book from the local server…");
  const response = await fetch(`api/market?account=${encodeURIComponent(accountId())}`);
  const body = (await response.json()) as {
    message?: string;
    prices: TokenPrice[];
    venues: Venue[];
    context: Venue | null;
    addresses: DerivedAddresses | null;
    addressError?: string;
  };
  if (!response.ok) throw new Error(body.message || "Market feed failed");
  state.prices = body.prices;
  state.venues = body.venues;
  state.context = body.context;
  state.addresses = body.addresses;
  state.addressError = body.addressError;
  setStatus("Live prices loaded. Run a paper cycle when you want quotes.");
}

async function refreshDirect(): Promise<void> {
  setStatus("Reading 1Click prices, DefiLlama yields, and v1.signer from the browser…");
  const [prices, pools] = await Promise.all([fetchTokenPrices(), fetchYieldPools()]);
  const wanted = new Set(Object.values(ASSETS).map((asset) => asset.assetId));
  state.prices = prices.filter((token) => wanted.has(token.assetId));
  state.venues = selectVenues(pools, DEFAULT_POLICY);
  state.context = selectContextPool(pools);
  try {
    state.addresses = await deriveAddresses(accountId());
    state.addressError = undefined;
  } catch (error) {
    state.addresses = null;
    state.addressError = error instanceof Error ? error.message : "Derivation failed";
  }
  setStatus("Live feeds loaded in the browser. A paper cycle requests dry quotes directly.");
}

async function deriveOnly(): Promise<void> {
  state.busy = true;
  render();
  try {
    if (state.server) await refreshFromServer();
    else {
      state.addresses = await deriveAddresses(accountId());
      state.addressError = undefined;
      setStatus("Addresses updated from v1.signer. No signature was requested.");
    }
  } catch (error) {
    state.addresses = null;
    state.addressError = error instanceof Error ? error.message : "Derivation failed";
    setStatus(state.addressError, true);
  } finally {
    state.busy = false;
    render();
  }
}

async function run(): Promise<void> {
  state.busy = true;
  setStatus("Requesting dry quotes from NEAR Intents…");
  render();
  try {
    let result: CycleResult;
    if (state.server) {
      const response = await fetch("api/cycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: accountId(), book: state.book }),
      });
      const body = (await response.json()) as CycleResult & { message?: string };
      if (!response.ok) throw new Error(body.message || "Cycle failed");
      result = body;
    } else {
      const pools = await fetchYieldPools();
      let addresses = state.addresses;
      let addressError = state.addressError;
      try {
        addresses = await deriveAddresses(accountId());
        addressError = undefined;
      } catch (error) {
        addressError = error instanceof Error ? error.message : "Derivation failed";
      }
      result = await runCycle({
        book: state.book,
        policy: DEFAULT_POLICY,
        accountId: accountId(),
        clients: {
          prices: state.prices,
          pools,
          addresses,
          addressError,
          quote: (_job, request) => postDryQuote(request),
        },
      });
    }
    state.result = result;
    state.book = sanitizeBook(result.nextBook);
    state.addresses = result.addresses;
    state.addressError = result.addressError;
    state.log.unshift({
      ranAt: result.ranAt,
      action: result.decision.action,
      totalUsd: result.totalUsd,
      memo: result.memo,
      llmMemo: result.llmMemo,
      memoSource: result.memoSource,
    });
    state.log = state.log.slice(0, 6);
    persist();
    const fills = result.decision.legs.filter((leg) => leg.chosen).length;
    setStatus(
      result.decision.action === "rebalance"
        ? `Paper cycle recorded ${fills} fill${fills === 1 ? "" : "s"}. No funds moved.`
        : "Paper cycle finished with a hold. No funds moved.",
    );
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Cycle failed", true);
  } finally {
    state.busy = false;
    render();
  }
}

function resetBook(): void {
  state.book = cloneBook(INITIAL_BOOK);
  state.result = null;
  persist();
  setStatus("Book reset to the sample inventory. Prices stay live.");
  render();
}

function currentPositions(): MarkedPosition[] {
  if (state.prices.length === 0) return [];
  try {
    return markBook(state.book, state.prices);
  } catch {
    return [];
  }
}

function render(): void {
  const positions = currentPositions();
  const total = totalValue(positions);
  const sleeves = positions.length ? sleeveSnapshots(positions, DEFAULT_POLICY) : [];
  const totalNode = document.querySelector("#total");
  if (totalNode) {
    totalNode.textContent = positions.length
      ? state.result?.decision.action === "rebalance"
        ? `${formatUsd(total)} now`
        : formatUsd(total)
      : "—";
  }
  renderPrices(positions);
  renderAddresses();
  renderDonut(positions);
  renderPositions(positions);
  renderSleeves(sleeves);
  renderRules();
  renderYields();
  renderMemo();
  renderQuotes();
  renderLog();
  const runButton = document.querySelector<HTMLButtonElement>("#run");
  const resetButton = document.querySelector<HTMLButtonElement>("#reset");
  const deriveButton = document.querySelector<HTMLButtonElement>("#account-form button");
  if (runButton) runButton.disabled = state.busy || positions.length === 0;
  if (resetButton) resetButton.disabled = state.busy;
  if (deriveButton) deriveButton.disabled = state.busy;
  const status = document.querySelector("#status");
  if (status) {
    status.textContent = state.status;
    status.classList.toggle("warn", state.warn);
  }
}

function renderPrices(positions: MarkedPosition[]): void {
  const root = document.querySelector("#prices");
  if (!root) return;
  clear(root);
  for (const key of ["wNEAR", "bnb", "sol"]) {
    const position = positions.find((row) => row.key === key);
    const wrap = node("span");
    wrap.append(node("strong", undefined, position ? formatUsd(position.priceUsd) : "—"));
    wrap.append(document.createTextNode(assetByKey(key).symbol));
    root.append(wrap);
  }
}

function renderAddresses(): void {
  const root = document.querySelector("#addresses");
  if (!root) return;
  if (state.addresses) {
    root.textContent = `v1.signer · ${state.addresses.accountId} · BSC ${state.addresses.bsc} · Solana ${state.addresses.solana}`;
    return;
  }
  root.textContent = state.addressError || "Addresses appear after a read of v1.signer. The view call does not sign.";
}

function renderDonut(positions: MarkedPosition[]): void {
  const root = document.querySelector("#donut");
  if (!root) return;
  clear(root);
  const chains = ["near", "bsc", "solana"].map((chain) => ({
    chain,
    label: CHAIN_LABEL[chain as "near" | "bsc" | "solana"],
    value: positions.filter((row) => row.asset.chain === chain).reduce((sum, row) => sum + row.valueUsd, 0),
    color: CHAIN_COLOR[chain] || "#1c140e",
  }));
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 42 42");
  const background = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  background.setAttribute("cx", "21");
  background.setAttribute("cy", "21");
  background.setAttribute("r", "15.915");
  background.setAttribute("fill", "none");
  background.setAttribute("stroke", "#efe4d0");
  background.setAttribute("stroke-width", "6");
  svg.append(background);
  const total = chains.reduce((sum, chain) => sum + chain.value, 0) || 1;
  let offset = 25;
  for (const chain of chains) {
    const pct = (chain.value / total) * 100;
    if (pct <= 0) continue;
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", "21");
    circle.setAttribute("cy", "21");
    circle.setAttribute("r", "15.915");
    circle.setAttribute("fill", "none");
    circle.setAttribute("stroke", chain.color);
    circle.setAttribute("stroke-width", "6");
    circle.setAttribute("stroke-dasharray", `${pct} ${100 - pct}`);
    circle.setAttribute("stroke-dashoffset", String(offset));
    svg.append(circle);
    offset -= pct;
  }
  root.append(svg);
  const legend = node("div", "legend");
  for (const chain of chains) {
    const row = node("div");
    const swatch = node("i");
    swatch.style.background = chain.color;
    row.append(swatch, document.createTextNode(`${chain.label} ${formatUsd(chain.value)}`));
    legend.append(row);
  }
  root.append(legend);
}

function renderPositions(positions: MarkedPosition[]): void {
  const root = document.querySelector("#positions");
  if (!root) return;
  clear(root);
  const ordered = [...positions].sort((a, b) => b.valueUsd - a.valueUsd);
  for (const position of ordered) {
    if (Number(position.amount) === 0) continue;
    const row = node("div", "pos-row");
    const left = node("div");
    left.append(node("strong", undefined, `${formatAmount(position.amount)} ${position.asset.symbol}`));
    left.append(node("small", undefined, CHAIN_LABEL[position.asset.chain]));
    row.append(left, node("strong", undefined, formatUsd(position.valueUsd)));
    root.append(row);
  }
  if (!root.childElementCount) root.append(node("p", "empty", "Waiting for prices."));
}

function renderSleeves(sleeves: SleeveSnapshot[]): void {
  const root = document.querySelector("#sleeves");
  if (!root) return;
  clear(root);
  for (const sleeve of sleeves) {
    const row = node("div", "sleeve-row");
    row.append(node("strong", undefined, sleeve.sleeve));
    const bar = node("div", "bar");
    const fill = node("i");
    fill.style.width = `${Math.min(100, Math.max(0, sleeve.weight * 100))}%`;
    const tick = node("b");
    tick.style.left = `${sleeve.target * 100}%`;
    bar.append(fill, tick);
    const label = node("em", undefined, `${(sleeve.weight * 100).toFixed(1)}%`);
    row.append(bar, label);
    root.append(row);
  }
}

function renderRules(): void {
  const root = document.querySelector("#rules");
  if (!root) return;
  clear(root);
  const policy = DEFAULT_POLICY;
  const lines = [
    `Trade when a sleeve drifts past ${(policy.driftBps / 100).toFixed(0)} points`,
    `Size ${formatUsd(policy.minTradeUsd)} to ${formatUsd(policy.maxTradeUsd)}`,
    `Reject a quote worse than ${policy.maxQuoteLossBps} bps`,
    `Ignore yields above ${policy.maxApyPercent}%`,
    `A stable move must earn its fee back in ${policy.yieldHorizonDays} days`,
  ];
  for (const line of lines) root.append(node("li", undefined, line));
}

function renderYields(): void {
  const root = document.querySelector("#yields");
  if (!root) return;
  clear(root);
  if (state.venues.length === 0 && !state.context) {
    root.append(node("p", "empty", "Yield feed not in yet."));
    return;
  }
  for (const venue of state.venues) {
    const row = node("div", "yield-row");
    const left = node("div");
    left.append(node("strong", undefined, `${venue.symbol} · ${venue.apyPercent.toFixed(2)}%`));
    left.append(node("small", undefined, `${venue.project} · ${venue.chain}`));
    row.append(left, node("em", undefined, formatUsd(venue.tvlUsd)));
    root.append(row);
  }
  if (state.context) {
    const row = node("div", "yield-row context");
    const left = node("div");
    const title = node("strong", undefined, `${state.context.symbol} · ${state.context.apyPercent.toFixed(1)}%`);
    const tag = node("span", "tag", "context");
    title.append(tag);
    left.append(title);
    left.append(node("small", undefined, `${state.context.project} on ${state.context.chain}. Not a target.`));
    row.append(left, node("em", undefined, formatUsd(state.context.tvlUsd)));
    root.append(row);
  }
}

function renderMemo(): void {
  const root = document.querySelector("#memo");
  if (!root) return;
  clear(root);
  root.append(node("p", "eyebrow", "Decision memo"));
  if (!state.result) {
    root.append(node("h2", undefined, "Waiting for the first cycle."));
    root.append(
      node(
        "p",
        undefined,
        "The book is marked with live token prices once the feed connects. The cycle is what asks NEAR Intents for quotes.",
      ),
    );
    return;
  }
  const title = state.result.decision.action === "rebalance" ? "Paper rebalance recorded." : "Hold. The book stays put.";
  root.append(node("h2", undefined, title));
  for (const paragraph of state.result.memo) root.append(node("p", undefined, paragraph));
  if (state.result.llmMemo) {
    const extra = node("div", "llm");
    const label = state.result.memoSource === "near-ai" ? "NEAR AI Cloud rewrite" : "Model rewrite";
    extra.append(node("p", "eyebrow", label));
    extra.append(node("p", undefined, state.result.llmMemo));
    root.append(extra);
  }
}

function quoteVerdict(quote: ScoredQuote): { label: string; chosen: boolean } {
  const result = state.result;
  if (!result) return { label: "", chosen: false };
  for (const leg of result.decision.legs) {
    if (leg.chosen?.id === quote.id) return { label: "Chosen", chosen: true };
    const rejected = leg.rejected.find((row) => row.quote.id === quote.id);
    if (rejected) return { label: rejected.why, chosen: false };
  }
  return { label: "Not used", chosen: false };
}

function renderQuotes(): void {
  const section = document.querySelector<HTMLElement>("#quotes");
  const root = document.querySelector("#quote-table");
  if (!section || !root) return;
  const quotes = state.result?.quotes ?? [];
  section.hidden = quotes.length === 0;
  clear(root);
  if (quotes.length === 0) return;
  const table = node("table");
  const thead = document.createElement("thead");
  const headerRow = node("tr");
  for (const label of ["Route", "Spend", "Receive", "Loss", "ETA", "Verdict"]) {
    headerRow.append(node("th", undefined, label));
  }
  thead.append(headerRow);
  const body = document.createElement("tbody");
  table.append(thead, body);

  for (const quote of quotes) {
    const from = assetByKey(quote.fromKey);
    const to = assetByKey(quote.toKey);
    const verdict = quoteVerdict(quote);
    const row = node("tr");
    if (verdict.chosen) row.className = "chosen";
    row.append(node("td", undefined, `${from.symbol} ${CHAIN_LABEL[from.chain]} → ${to.symbol} ${CHAIN_LABEL[to.chain]}`));
    if (!quote.result.ok) {
      const cell = node("td", undefined, quote.result.message);
      cell.colSpan = 4;
      row.append(cell);
    } else {
      row.append(
        node("td", undefined, `${formatAmount(quote.result.amountInFormatted)} ${from.symbol}`),
        node("td", undefined, `${formatAmount(quote.result.amountOutFormatted)} ${to.symbol}`),
        node("td", undefined, formatBps(quote.result.lossBps)),
        node("td", undefined, `${quote.result.timeEstimateSec}s`),
      );
    }
    const verdictCell = node("td", verdict.chosen ? "verdict-chosen" : "verdict-no", verdict.label);
    row.append(verdictCell);
    body.append(row);
  }
  root.append(table);
}

function renderLog(): void {
  const root = document.querySelector("#log-list");
  if (!root) return;
  clear(root);
  if (state.log.length === 0) {
    root.append(node("p", "empty", "No cycle yet."));
    return;
  }
  for (const item of state.log) {
    const block = node("article", "log-item");
    const when = new Date(item.ranAt).toLocaleString();
    block.append(node("h3", undefined, `${item.action === "rebalance" ? "Rebalance" : "Hold"} · ${formatUsd(item.totalUsd)}`));
    block.append(node("p", "eyebrow", when));
    for (const paragraph of item.memo) block.append(node("p", undefined, paragraph));
    root.append(block);
  }
}

document.querySelector("#account-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  void deriveOnly();
});
document.querySelector("#run")?.addEventListener("click", () => void run());
document.querySelector("#reset")?.addEventListener("click", () => resetBook());

render();
void boot();
