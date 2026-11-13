import { llmMode } from "./live-gate.js";

type ChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

export async function rewriteMemo(
  memo: string[],
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<{ text: string; source: "near-ai" | "compatible" } | null> {
  const mode = llmMode(env);
  if (mode === "off") return null;
  const base = (mode === "near-ai" ? env.NEAR_AI_BASE_URL || "https://cloud-api.near.ai/v1" : env.LLM_BASE_URL || "")
    .replace(/\/$/, "");
  const key = mode === "near-ai" ? env.NEAR_AI_API_KEY : env.LLM_API_KEY;
  const model = mode === "near-ai" ? env.NEAR_AI_MODEL || "z-ai/glm-5.2" : env.LLM_MODEL || "gpt-4o-mini";
  if (!base || !key) return null;

  const response = await fetchImpl(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 380,
      messages: [
        {
          role: "system",
          content:
            "You rewrite a fund memo in two short paragraphs of plain words. Keep every number and the same decision. Do not add a trade, a deposit address, or a request for keys. No emoji.",
        },
        { role: "user", content: memo.join("\n\n") },
      ],
    }),
  });
  if (!response.ok) throw new Error(`LLM failed (${response.status})`);
  const body = (await response.json()) as ChatResponse;
  const text = body.choices?.[0]?.message?.content?.trim();
  if (!text) return null;
  return { text, source: mode };
}
