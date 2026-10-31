import type { Db } from "./db";
import { kvGet } from "./db";
import { weekSchedule, weekIdAt, type WeekSchedule } from "./schedule";
import { MIN_RANKED_USD, markBeatTheBot, paperReturn, rankTier, timeWeightedReturn, type Ranked, type Snapshot, type Flow } from "./scoring";

export type Row = Ranked & {
  name: string;
  valueUsd?: number;
  picks?: { ticker: string; weightBps: number }[];
  lockedTx?: string;
  agentId?: string;
  telegram?: boolean;
};

export type WeekTable = {
  weekId: number;
  schedule: WeekSchedule;
  phase: "upcoming" | "entries-open" | "live" | "scoring" | "final";
  bots: Row[];
  real: Row[];
  paper: Row[];
  bestBot?: Row;
  updatedAt: number;
  resultsHash?: string;
};

export type PriceMap = Record<string, { price8: string; updatedAt: number }>;

const shortName = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`;

export function phaseOf(s: WeekSchedule, now: number): WeekTable["phase"] {
  if (now < s.entryOpen) return "upcoming";
  if (now < s.entryClose) return "entries-open";
  if (now < s.scoreAt) return "live";
  return "scoring";
}

async function snapshotsFor(db: Db, wallets: string[], from: number, to: number) {
  if (!wallets.length) return new Map<string, Snapshot[]>();
  const rows = await db.query<{ wallet: string; taken_at: string | Date; nav_usd: number }>(
    `select wallet, taken_at, nav_usd from nav_snapshots
     where wallet = any($1) and taken_at >= to_timestamp($2) and taken_at <= to_timestamp($3)
     order by taken_at`,
    [wallets.map((w) => w.toLowerCase()), from, to],
  );
  const m = new Map<string, Snapshot[]>();
  for (const r of rows) {
    const t = Math.floor(new Date(r.taken_at).getTime() / 1000);
    (m.get(r.wallet) ?? m.set(r.wallet, []).get(r.wallet)!).push({ t, valueUsd: Number(r.nav_usd) });
  }
  return m;
}

async function flowsFor(db: Db, wallets: string[], from: number, to: number) {
  if (!wallets.length) return new Map<string, Flow[]>();
  const rows = await db.query<{ wallet: string; ts: string | Date; usd: number }>(
    `select wallet, ts, usd from flows where wallet = any($1) and ts > to_timestamp($2) and ts <= to_timestamp($3)`,
    [wallets.map((w) => w.toLowerCase()), from, to],
  );
  const m = new Map<string, Flow[]>();
  for (const r of rows) (m.get(r.wallet) ?? m.set(r.wallet, []).get(r.wallet)!).push({ t: Math.floor(new Date(r.ts).getTime() / 1000), usd: Number(r.usd) });
  return m;
}

/** The week's table. Final weeks come from the published results file; live weeks are computed from snapshots. */
export async function weekTable(db: Db, weekId = weekIdAt(Math.floor(Date.now() / 1000)), now = Math.floor(Date.now() / 1000)): Promise<WeekTable> {
  const schedule = weekSchedule(Math.max(1, weekId));
  const [week] = await db.query<{ results: WeekTable | null; results_hash: string | null; open_prices: PriceMap | null; universe: string[] }>(
    "select results, results_hash, open_prices, universe from weeks where week = $1",
    [schedule.weekId],
  );
  if (week?.results) return { ...week.results, phase: "final", resultsHash: week.results_hash ?? undefined };

  const phase = phaseOf(schedule, now);
  const base: WeekTable = { weekId: schedule.weekId, schedule, phase, bots: [], real: [], paper: [], updatedAt: now };
  if (phase === "upcoming") return base;

  const agents = await db.query<{ id: string; name: string; wallet: string }>("select id, name, wallet from agents where not paused or house");
  const players = await db.query<{ wallet: string; display_name: string | null; telegram_id: string | null }>(
    "select wallet, display_name, telegram_id from players where non_us_confirmed_at is not null",
  );
  const to = Math.min(now, schedule.scoreAt);
  const wallets = [...agents.map((a) => a.wallet), ...players.map((p) => p.wallet)];
  const snaps = phase === "entries-open" ? new Map<string, Snapshot[]>() : await snapshotsFor(db, wallets, schedule.entryClose, to);
  const flows = phase === "entries-open" ? new Map<string, Flow[]>() : await flowsFor(db, wallets, schedule.entryClose, to);

  const rowFor = (wallet: string, tier: "bot" | "real", name: string, agentId?: string, telegram?: boolean): Row | null => {
    const s = snaps.get(wallet.toLowerCase()) ?? [];
    if (s.length < 1) return null;
    const ret = s.length >= 2 ? timeWeightedReturn(s, flows.get(wallet.toLowerCase()) ?? []) : 0;
    return { wallet, tier, name, ret, valueUsd: s[s.length - 1]!.valueUsd, agentId, telegram, eligible: tier === "real" ? (s[0]!.valueUsd >= MIN_RANKED_USD) : true };
  };

  base.bots = rankTier(agents.map((a) => rowFor(a.wallet, "bot", a.name, a.id)).filter((r): r is Row => !!r));
  base.real = rankTier(
    players
      .map((p) => rowFor(p.wallet, "real", p.display_name ?? shortName(p.wallet), undefined, !!p.telegram_id))
      .filter((r): r is Row => !!r && r.eligible === true),
  );

  // Paper picks: weighted change from the open price to the latest price.
  const locks = await db.query<{ wallet: string; picks: { tokenIndex: number; weightBps: number }[]; locked_at: string; tx_hash: string }>(
    "select wallet, picks, locked_at, tx_hash from paper_locks where week = $1",
    [schedule.weekId],
  );
  const latest = await kvGet<PriceMap>(db, "prices:latest", {});
  const universe = (week?.universe ?? []).map((a) => a.toLowerCase());
  const tickers = await kvGet<Record<string, string>>(db, "tickers", {});
  const open = week?.open_prices;
  base.paper = rankTier(
    locks.map((l) => {
      let ret = 0;
      if (open && phase !== "entries-open") {
        const o = Object.fromEntries(Object.entries(open).map(([k, v]) => [k.toLowerCase(), BigInt(v.price8)]));
        const c = Object.fromEntries(Object.entries(latest).map(([k, v]) => [k.toLowerCase(), BigInt(v.price8)]));
        try {
          ret = paperReturn(l.picks, universe, o, c);
        } catch {
          ret = 0;
        }
      }
      const p = players.find((x) => x.wallet === l.wallet.toLowerCase());
      return {
        wallet: l.wallet,
        tier: "paper" as const,
        name: p?.display_name ?? shortName(l.wallet),
        ret,
        lockedAt: Number(l.locked_at),
        lockedTx: l.tx_hash,
        telegram: !!p?.telegram_id,
        picks: l.picks.map((x) => ({ ticker: tickers[universe[x.tokenIndex] ?? ""] ?? `#${x.tokenIndex}`, weightBps: x.weightBps })),
      };
    }),
  );
  if (phase !== "entries-open") {
    markBeatTheBot(base.real, base.bots);
    markBeatTheBot(base.paper, base.bots);
  }
  base.bestBot = base.bots[0];
  return base;
}
