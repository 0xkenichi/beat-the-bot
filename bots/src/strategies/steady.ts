import type { PublicClient } from "viem";
import { GUARDRAILS, pct, type UniverseToken } from "@btb/shared";
import { equalWeights, fiveDayReturns, type Targets } from "./common";

/**
 * One model call a week. Any OpenAI-compatible chat-completions endpoint on a free tier works
 * (LLM_BASE_URL, LLM_API_KEY, LLM_MODEL in Kenichi's own env). The answer is validated against the
 * guardrails; if the key is missing or anything fails, Steady holds every stock equally and says so.
 */
export async function steady(
  client: PublicClient,
  universe: UniverseToken[],
  now: number,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<Targets> {
  const fallback = (why: string): Targets => ({ weights: equalWeights(universe), source: "equal-weight", note: `Equal weight across all ${universe.length} stocks (${why}).` });
  if (!env.LLM_BASE_URL || !env.LLM_API_KEY || !env.LLM_MODEL) return fallback("no model key is configured");

  let summary: string;
  try {
    const { returns } = await fiveDayReturns(client, universe, now);
    summary = returns.map((r) => `${r.token.ticker} (${r.token.name}): ${pct(r.ret, 2)} over 5 trading days`).join("\n");
  } catch (e) {
    return fallback(`price history unavailable: ${(e as Error).message}`);
  }
  const prompt = [
    "You manage a small, long-only stock portfolio for one week. Choose weights for some or all of these stocks.",
    "Rules: weights are whole percentages, they sum to exactly 100, no stock above 50, and only these tickers.",
    'Answer with JSON only, in the form {"weights": {"TICKER": percent, ...}, "reason": "one sentence"}.',
    "",
    summary,
  ].join("\n");
  try {
    const res = await fetchImpl(`${env.LLM_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.LLM_API_KEY}` },
      body: JSON.stringify({ model: env.LLM_MODEL, messages: [{ role: "user", content: prompt }], temperature: 0 }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return fallback(`model returned HTTP ${res.status}`);
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = body.choices?.[0]?.message?.content ?? "";
    const parsed = parseWeights(text, universe);
    if ("error" in parsed) return fallback(`model answer rejected: ${parsed.error}`);
    return { weights: parsed.weights, source: `model:${env.LLM_MODEL}`, note: parsed.reason };
  } catch (e) {
    return fallback(`model call failed: ${(e as Error).message}`);
  }
}

/** Validates a model answer: known tickers, integer percents, sum 100, each at most the 50% guardrail. */
export function parseWeights(text: string, universe: UniverseToken[]): { weights: Record<string, number>; reason: string } | { error: string } {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { error: "no JSON object" };
  let obj: { weights?: Record<string, unknown>; reason?: unknown };
  try {
    obj = JSON.parse(m[0]);
  } catch {
    return { error: "invalid JSON" };
  }
  const w = obj.weights;
  if (!w || typeof w !== "object") return { error: "missing weights" };
  const out: Record<string, number> = {};
  let sum = 0;
  for (const [ticker, v] of Object.entries(w)) {
    const t = universe.find((u) => u.ticker.toUpperCase() === ticker.toUpperCase() || u.symbol.toUpperCase() === ticker.toUpperCase());
    if (!t) return { error: `unknown ticker ${ticker}` };
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) return { error: `bad weight for ${ticker}` };
    if (v * 100 > GUARDRAILS.maxWeightBps) return { error: `${ticker} above 50%` };
    if (v > 0) out[t.address] = v * 100;
    sum += v;
  }
  if (sum !== 100) return { error: `weights sum to ${sum}` };
  const reason = typeof obj.reason === "string" ? obj.reason.slice(0, 280) : "Model-chosen weights.";
  return { weights: out, reason };
}
