const SCALE = 12n;
const SCALE_FACTOR = 10n ** SCALE;

export function parseDecimal(value: string): number {
  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new Error(`Not a positive decimal: ${value}`);
  }
  return Number(value);
}

export function toScaled(value: string): bigint {
  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new Error(`Not a positive decimal: ${value}`);
  }
  const [whole, frac = ""] = value.split(".");
  const padded = (frac + "0".repeat(Number(SCALE))).slice(0, Number(SCALE));
  return BigInt(whole) * SCALE_FACTOR + BigInt(padded);
}

export function fromScaled(value: bigint): string {
  if (value < 0n) throw new Error("Negative amount");
  const whole = value / SCALE_FACTOR;
  const frac = (value % SCALE_FACTOR).toString().padStart(Number(SCALE), "0");
  const trimmed = frac.replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole.toString();
}

export function addDecimal(a: string, b: string): string {
  return fromScaled(toScaled(a) + toScaled(b));
}

export function subDecimal(a: string, b: string): string {
  const next = toScaled(a) - toScaled(b);
  if (next < 0n) throw new Error(`Amount underflow: ${a} - ${b}`);
  return fromScaled(next);
}

/** Human amount to the integer string 1Click expects. */
export function toBaseUnits(human: string, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error(`Bad decimals ${decimals}`);
  }
  if (!/^\d+(\.\d+)?$/.test(human)) throw new Error(`Not a positive decimal: ${human}`);
  const [whole, frac = ""] = human.split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || "0")).toString();
}

export function lossBps(amountInUsd: number, amountOutUsd: number): number {
  if (!Number.isFinite(amountInUsd) || amountInUsd <= 0) return Number.POSITIVE_INFINITY;
  if (!Number.isFinite(amountOutUsd)) return Number.POSITIVE_INFINITY;
  return ((amountInUsd - amountOutUsd) / amountInUsd) * 10_000;
}

export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

export function formatAmount(value: string, digits = 4): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  if (n >= 100) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function formatBps(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  const sign = value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(0)} bps`;
}

export function formatPercent(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "n/a";
  return `${(value * 100).toFixed(digits)}%`;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function roundUsd(n: number): number {
  return Math.round(n * 100) / 100;
}
