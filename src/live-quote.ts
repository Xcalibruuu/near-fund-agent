import { liveQuoteAllowed } from "./live-gate.js";
import type { DryQuoteRequest } from "./intents.js";

export function buildLiveQuoteRequest(dry: DryQuoteRequest): Omit<DryQuoteRequest, "dry"> & { dry: false } {
  if (dry.dry !== true) {
    throw new Error("Refusing a request that was not built as a dry quote.");
  }
  if (!liveQuoteAllowed()) {
    throw new Error("Refusing a non-dry quote. Paper mode never asks for a deposit address.");
  }
  return { ...dry, dry: false };
}
