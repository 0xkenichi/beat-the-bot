import { keccak256, toBytes, type Hex } from "viem";

export type Snapshot = { t: number; valueUsd: number };
/** External money in (+) or out (-) of a wallet, in USD at the time. Swaps are not flows. */
export type Flow = { t: number; usd: number };

/** Minimum value held at the entry close to be ranked in the real tier. */
export const MIN_RANKED_USD = 5;
/** Prize shares for first, second and third place. */
export const PRIZE_SHARES_BPS = [5000, 3000, 2000] as const;

/**
 * Time-weighted return over a series of valuations (hourly snapshots from the entry close to the score time).
 * Each flow is attributed to the start of the sub-period it falls in, so deposits and withdrawals change the
 * capital at work but never count as performance.
 */
export function timeWeightedReturn(snapshots: Snapshot[], flows: Flow[]): number {
  const s = [...snapshots].sort((a, b) => a.t - b.t);
  let growth = 1;
  for (let k = 1; k < s.length; k++) {
    const prev = s[k - 1]!;
    const cur = s[k]!;
    const f = flows.filter((x) => x.t > prev.t && x.t <= cur.t).reduce((a, x) => a + x.usd, 0);
    const base = prev.valueUsd + f;
    if (base <= 1e-9) continue; // nothing at work in this sub-period
    growth *= cur.valueUsd / base;
  }
  return growth - 1;
}

export type PaperPick = { tokenIndex: number; weightBps: number };

/** Paper return: sum of weight x (P_close / P_open - 1). Prices are 8-decimal Chainlink answers. */
export function paperReturn(picks: PaperPick[], tokens: string[], open: Record<string, bigint>, close: Record<string, bigint>) {
  let r = 0;
  for (const p of picks) {
    const t = tokens[p.tokenIndex]?.toLowerCase();
    if (!t) throw new Error(`pick index ${p.tokenIndex} outside the universe`);
    const o = open[t];
    const c = close[t];
    if (!o || !c) throw new Error(`missing price for ${t}`);
    r += (p.weightBps / 10_000) * (Number(c) / Number(o) - 1);
  }
  return r;
}

export type Tier = "real" | "paper" | "bot";
export type Ranked = {
  wallet: string;
  tier: Tier;
  ret: number;
  name?: string;
  lockedAt?: number;
  eligible?: boolean;
  rank?: number;
  beats?: string[];
  beatTheBot?: boolean;
};

/** Ranks one tier: higher return first; paper ties go to the earlier lock; then by wallet for determinism. */
export function rankTier<T extends Ranked>(entries: T[]): T[] {
  const sorted = [...entries].sort((a, b) => {
    if (b.ret !== a.ret) return b.ret - a.ret;
    const la = a.lockedAt ?? Infinity;
    const lb = b.lockedAt ?? Infinity;
    if (la !== lb) return la - lb;
    return a.wallet.toLowerCase() < b.wallet.toLowerCase() ? -1 : 1;
  });
  sorted.forEach((e, i) => (e.rank = i + 1));
  return sorted;
}

/** Marks which bots each human beat, and the badge when they beat the best bot. */
export function markBeatTheBot<T extends Ranked>(humans: T[], bots: Ranked[]): T[] {
  const best = bots.length ? Math.max(...bots.map((b) => b.ret)) : Infinity;
  for (const h of humans) {
    h.beats = bots.filter((b) => h.ret > b.ret).map((b) => b.name ?? b.wallet);
    h.beatTheBot = bots.length > 0 && h.ret > best;
  }
  return humans;
}

/** Splits a pot (smallest units) 50/30/20 across up to three winners. Unawarded shares stay with the sponsor. */
export function prizeSplit(pot: bigint, winners: number): bigint[] {
  return PRIZE_SHARES_BPS.slice(0, Math.min(winners, 3)).map((bps) => (pot * BigInt(bps)) / 10_000n);
}

/** Deterministic JSON: sorted keys, bigint as string. The results hash is keccak256 of these bytes. */
export function canonicalJson(v: unknown): string {
  return JSON.stringify(sortKeys(v));
}
function sortKeys(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v as object)
        .sort()
        .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
        .map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}
export const resultsHash = (results: unknown): Hex => keccak256(toBytes(canonicalJson(results)));

export const pct = (r: number, digits = 1) => `${r >= 0 ? "+" : ""}${(r * 100).toFixed(digits)}%`;
