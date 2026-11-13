/**
 * Live 1Click quotes (dry: false) create a deposit address. They still do
 * not broadcast a transfer. Both env vars must be set, and nothing in the
 * repository sets them.
 */
export function liveQuoteAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.FUND_AGENT_MODE === "live" && env.FUND_AGENT_CONFIRM_LIVE === "yes";
}

export function llmMode(env: NodeJS.ProcessEnv = process.env): "near-ai" | "compatible" | "off" {
  if (env.NEAR_AI_API_KEY) return "near-ai";
  if (env.LLM_API_KEY && env.LLM_BASE_URL) return "compatible";
  return "off";
}
