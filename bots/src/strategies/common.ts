import type { PublicClient } from "viem";
import { priceAtCutoff, tradingCloseBefore, type UniverseToken } from "@btb/shared";

export type Targets = { weights: Record<string, number>; note: string; source: string };

/** Five-trading-day return per stock: last close vs the close five trading days earlier (Chainlink). */
export async function fiveDayReturns(client: PublicClient, universe: UniverseToken[], now: number) {
  const last = tradingCloseBefore(now, 0);
  const prev = tradingCloseBefore(now, 5);
  const out: { token: UniverseToken; ret: number; last: bigint; prev: bigint }[] = [];
  for (const t of universe) {
    const [a, b] = await Promise.all([priceAtCutoff(client, t.feed, last), priceAtCutoff(client, t.feed, prev)]);
    out.push({ token: t, ret: Number(a.answer) / Number(b.answer) - 1, last: a.answer, prev: b.answer });
  }
  return { from: prev, to: last, returns: out };
}

/** Equal weight across the given tokens, in basis points of the invested part of the portfolio. */
export function equalWeights(tokens: UniverseToken[]): Record<string, number> {
  const w: Record<string, number> = {};
  const base = Math.floor(10_000 / tokens.length);
  tokens.forEach((t, i) => (w[t.address] = base + (i < 10_000 - base * tokens.length ? 1 : 0)));
  return w;
}
