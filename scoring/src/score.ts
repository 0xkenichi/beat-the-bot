import type { Address, PublicClient } from "viem";
import {
  UNIVERSE, priceAtCutoff, weekSchedule, blockAt, timeWeightedReturn, paperReturn, rankTier, markBeatTheBot, prizeSplit,
  resultsHash, MIN_RANKED_USD, type Ranked, type WeekSchedule,
} from "@btb/shared";
import type { Db } from "@btb/shared/db";
import { snapshotAll } from "@btb/indexer";

export type PriceRec = { price8: string; updatedAt: number; roundId: string; stale: boolean; note?: string; feed: string };

async function cutoffPrices(client: PublicClient, cutoff: number) {
  const out: Record<string, PriceRec> = {};
  for (const t of UNIVERSE) {
    const p = await priceAtCutoff(client, t.feed, cutoff);
    out[t.address.toLowerCase()] = { price8: p.answer.toString(), updatedAt: p.updatedAt, roundId: p.roundId.toString(), stale: p.stale, note: p.note, feed: t.feed };
  }
  return out;
}
const asBig = (m: Record<string, PriceRec>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, BigInt(v.price8)]));

async function snapshotAt(client: PublicClient, db: Db, t: number, prices: Record<string, PriceRec>) {
  let blockNumber: bigint | undefined;
  try {
    blockNumber = await blockAt(client, t);
    await client.getBalance({ address: UNIVERSE[0]!.address, blockNumber }); // archive check
  } catch {
    blockNumber = undefined; // node without history: fall back to the latest block, logged in the results
  }
  const n = await snapshotAll(client, db, new Date(t * 1000), { blockNumber, prices: asBig(prices) });
  return { blockNumber: blockNumber?.toString() ?? "latest", wallets: n };
}

/** At the US open: record opening prices and value every wallet. */
export async function openWeek(client: PublicClient, db: Db, week: number) {
  const s = weekSchedule(week);
  if (Date.now() / 1000 < s.entryClose) throw new Error(`Week ${week} entries close at ${new Date(s.entryClose * 1000).toISOString()}`);
  const prices = await cutoffPrices(client, s.entryClose);
  const snap = await snapshotAt(client, db, s.entryClose, prices);
  await db.query(
    `insert into weeks (week, entry_open, entry_close, score_at, universe, open_prices, status) values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, 'live')
     on conflict (week) do update set open_prices = excluded.open_prices, status = 'live'`,
    [week, s.entryOpen, s.entryClose, s.scoreAt, JSON.stringify(UNIVERSE.map((u) => u.address)), JSON.stringify(prices)],
  );
  return { prices, snap };
}

type Row = Ranked & { name: string; valueUsd?: number; agentId?: string; picks?: { ticker: string; weightBps: number }[]; lockedTx?: string; openUsd?: number; flowsUsd?: number; telegram?: boolean; prize?: string };

export type Results = {
  league: "Beat the Bot";
  weekId: number;
  schedule: WeekSchedule;
  phase: "final";
  universe: { ticker: string; symbol: string; address: string; feed: string }[];
  prices: { open: Record<string, PriceRec>; close: Record<string, PriceRec> };
  bots: Row[];
  real: Row[];
  paper: Row[];
  bestBot?: Row;
  winners: { tier: "real" | "paper"; rank: number; wallet: string; amountRaw: string; token: string; prizeText: string }[];
  prizeToken: string | null;
  pots: { real: string; paper: string };
  snapshots: { open: string; close: string };
  updatedAt: number;
};

/**
 * Scores a week at the US close. Pure inputs: snapshots, flows, locks and Chainlink cutoff prices, so a dry run
 * can be checked by hand. Winners need a linked Telegram account and must not be on Kenichi's exclusion list.
 */
export async function scoreWeek(
  client: PublicClient,
  db: Db,
  week: number,
  opts: { excluded?: string[]; takeSnapshot?: boolean; now?: number; closePrices?: Record<string, PriceRec> } = {},
): Promise<{ results: Results; hash: `0x${string}` }> {
  const s = weekSchedule(week);
  if ((opts.now ?? Date.now() / 1000) < s.scoreAt) throw new Error(`Week ${week} is scored at ${new Date(s.scoreAt * 1000).toISOString()}`);
  const [w] = await db.query<{ open_prices: Record<string, PriceRec> | null; universe: string[]; prize_token: string | null; real_pot_raw: string | null; paper_pot_raw: string | null }>(
    "select open_prices, universe, prize_token, real_pot_raw, paper_pot_raw from weeks where week = $1",
    [week],
  );
  if (!w?.open_prices) throw new Error(`Week ${week} has no opening prices (run open first)`);
  const close = opts.closePrices ?? (await cutoffPrices(client, s.scoreAt));
  const closeSnap = opts.takeSnapshot === false ? { blockNumber: "skipped" } : await snapshotAt(client, db, s.scoreAt, close);

  const snaps = await db.query<{ wallet: string; taken_at: Date | string; nav_usd: number }>(
    "select wallet, taken_at, nav_usd from nav_snapshots where taken_at >= to_timestamp($1) and taken_at <= to_timestamp($2) order by taken_at",
    [s.entryClose, s.scoreAt],
  );
  const flows = await db.query<{ wallet: string; ts: Date | string; usd: number }>("select wallet, ts, usd from flows where ts > to_timestamp($1) and ts <= to_timestamp($2)", [s.entryClose, s.scoreAt]);
  const byWallet = <T extends { wallet: string }>(rows: T[]) => rows.reduce((m, r) => m.set(r.wallet, [...(m.get(r.wallet) ?? []), r]), new Map<string, T[]>());
  const S = byWallet(snaps), F = byWallet(flows);
  const tsOf = (d: Date | string) => Math.floor(new Date(d).getTime() / 1000);
  const twr = (wallet: string) => {
    const sn = (S.get(wallet) ?? []).map((x) => ({ t: tsOf(x.taken_at), valueUsd: Number(x.nav_usd) }));
    const fl = (F.get(wallet) ?? []).map((x) => ({ t: tsOf(x.ts), usd: Number(x.usd) }));
    const open = sn.find((x) => x.t === s.entryClose);
    const last = sn.find((x) => x.t === s.scoreAt) ?? sn[sn.length - 1];
    return { ret: sn.length >= 2 ? timeWeightedReturn(sn, fl) : null, openUsd: open?.valueUsd, closeUsd: last?.valueUsd, flowsUsd: fl.reduce((a, x) => a + x.usd, 0) };
  };

  const agents = await db.query<{ id: string; name: string; wallet: string }>("select id, name, wallet from agents where not paused or house");
  const bots: Row[] = rankTier(
    agents.map((a) => ({ a, r: twr(a.wallet) })).filter((x) => x.r.ret != null).map(({ a, r }) => ({ wallet: a.wallet, tier: "bot" as const, name: a.name, agentId: a.id, ret: r.ret!, valueUsd: r.closeUsd, openUsd: r.openUsd, flowsUsd: r.flowsUsd })),
  );
  const players = await db.query<{ wallet: string; display_name: string | null; telegram_id: string | null }>("select wallet, display_name, telegram_id from players where non_us_confirmed_at is not null");
  const short = (x: string) => `${x.slice(0, 6)}…${x.slice(-4)}`;
  // Prize eligibility: a linked Telegram account (one each way). Kenichi can exclude wallets he finds belong to
  // the same person; in weeks 1-2 settlement also waits for his confirmation (see cli.ts settle --approved).
  const excluded = new Set((opts.excluded ?? []).map((x) => x.toLowerCase()));
  const eligible = (wallet: string, tg: string | null) => !!tg && !excluded.has(wallet.toLowerCase());
  const real: Row[] = rankTier(
    players
      .map((p) => ({ p, r: twr(p.wallet) }))
      .filter((x) => x.r.ret != null && (x.r.openUsd ?? 0) >= MIN_RANKED_USD)
      .map(({ p, r }) => ({ wallet: p.wallet, tier: "real" as const, name: p.display_name ?? short(p.wallet), ret: r.ret!, valueUsd: r.closeUsd, openUsd: r.openUsd, flowsUsd: r.flowsUsd, telegram: !!p.telegram_id, eligible: eligible(p.wallet, p.telegram_id) })),
  );
  const locks = await db.query<{ wallet: string; picks: { tokenIndex: number; weightBps: number }[]; locked_at: string; tx_hash: string }>(
    "select wallet, picks, locked_at, tx_hash from paper_locks where week = $1 and locked_at < $2",
    [week, s.entryClose],
  );
  const uni = w.universe.map((a) => a.toLowerCase());
  const tick = (a: string) => UNIVERSE.find((u) => u.address.toLowerCase() === a)?.ticker ?? a.slice(0, 8);
  const paper: Row[] = rankTier(
    locks.map((l) => {
      const p = players.find((x) => x.wallet === l.wallet);
      return {
        wallet: l.wallet, tier: "paper" as const, name: p?.display_name ?? short(l.wallet),
        ret: paperReturn(l.picks, uni, asBig(w.open_prices!), asBig(close)),
        lockedAt: Number(l.locked_at), lockedTx: l.tx_hash, telegram: !!p?.telegram_id, eligible: eligible(l.wallet, p?.telegram_id ?? null),
        picks: l.picks.map((x) => ({ ticker: tick(uni[x.tokenIndex] ?? ""), weightBps: x.weightBps })),
      };
    }),
  );
  markBeatTheBot(real, bots);
  markBeatTheBot(paper, bots);

  const token = w.prize_token;
  const sym = token ? (UNIVERSE.find((u) => u.address.toLowerCase() === token.toLowerCase())?.symbol ?? "USDC") : "USDC";
  const dec = sym === "USDC" ? 6 : 8;
  const winners: Results["winners"] = [];
  const award = (rows: Row[], tier: "real" | "paper", pot: string | null) => {
    if (!pot || !token) return;
    const top = rows.filter((r) => r.eligible).slice(0, 3);
    prizeSplit(BigInt(pot), top.length).forEach((amt, i) => {
      const text = `${(Number(amt) / 10 ** dec).toFixed(dec === 6 ? 2 : 6)} ${sym}`;
      top[i]!.prize = text;
      winners.push({ tier, rank: top[i]!.rank!, wallet: top[i]!.wallet, amountRaw: amt.toString(), token, prizeText: text });
    });
  };
  award(real, "real", w.real_pot_raw);
  award(paper, "paper", w.paper_pot_raw);

  const results: Results = {
    league: "Beat the Bot",
    weekId: week,
    schedule: s,
    phase: "final",
    universe: UNIVERSE.filter((u) => uni.includes(u.address.toLowerCase())).map((u) => ({ ticker: u.ticker, symbol: u.symbol, address: u.address, feed: u.feed })),
    prices: { open: w.open_prices, close },
    bots, real, paper,
    bestBot: bots[0],
    winners,
    prizeToken: token,
    pots: { real: w.real_pot_raw ?? "0", paper: w.paper_pot_raw ?? "0" },
    snapshots: { open: String(s.entryClose), close: String(closeSnap.blockNumber) },
    updatedAt: Math.floor(opts.now ?? Date.now() / 1000),
  };
  return { results, hash: resultsHash(results) };
}

export async function publishResults(db: Db, week: number, results: Results, hash: string) {
  await db.query("update weeks set results = $2::jsonb, results_hash = $3, close_prices = $4::jsonb, status = 'scored' where week = $1", [week, JSON.stringify(results), hash, JSON.stringify(results.prices.close)]);
}

export type { Address };
