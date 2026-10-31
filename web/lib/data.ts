import "server-only";
import type { Address } from "viem";
import { getDb, kvGet, type Db } from "@btb/shared/db";
import { weekTable, type PriceMap } from "@btb/shared/league";
import { UNIVERSE } from "@btb/shared/universe";
import { makePublicClient } from "@btb/shared/rpc";
import { latestRound } from "@btb/shared/prices";
import { weekIdAt } from "@btb/shared/schedule";

export const db = (): Promise<Db> => getDb();
export const client = () => makePublicClient();

export type TradeMode = "live" | "view-only";

/** Kill switch: TRADE_MODE env wins, then the database flag. View-only keeps prices, portfolio and sells visible. */
export async function tradeMode(): Promise<TradeMode> {
  const env = process.env.TRADE_MODE;
  if (env === "live" || env === "view-only") return env;
  return (await kvGet<TradeMode>(await db(), "trade_mode", "live")) === "view-only" ? "view-only" : "live";
}

/** Latest Chainlink prices: from the hourly job's cache, else read live. */
export async function prices(): Promise<PriceMap> {
  const cached = await kvGet<PriceMap>(await db(), "prices:latest", {});
  if (Object.keys(cached).length === UNIVERSE.length) return cached;
  const c = client();
  const out: PriceMap = {};
  await Promise.all(
    UNIVERSE.map(async (t) => {
      const r = await latestRound(c, t.feed);
      out[t.address.toLowerCase()] = { price8: r.answer.toString(), updatedAt: r.updatedAt };
    }),
  );
  return out;
}

export async function table(week?: number) {
  return weekTable(await db(), week ?? weekIdAt(Math.floor(Date.now() / 1000)));
}

export type AgentRow = { id: string; name: string; strategy: string; wallet: Address; house: boolean; erc8004_id: string | null; start_nav: number | null; started_at: string | null; paused: boolean; paused_reason: string | null };

export async function agents(): Promise<(AgentRow & { nav: number | null; navAt: string | null })[]> {
  return (await db()).query(
    `select a.*, s.nav_usd as nav, s.taken_at as "navAt" from agents a
     left join lateral (select nav_usd, taken_at from nav_snapshots where wallet = a.wallet order by taken_at desc limit 1) s on true
     order by a.house desc, a.id`,
  );
}

export async function agent(id: string) {
  const d = await db();
  const [a] = await d.query<AgentRow>("select * from agents where id = $1", [id]);
  if (!a) return null;
  const snaps = await d.query<{ taken_at: string; nav_usd: number; block: string; holdings: { ticker: string; valueUsd: number; token: string }[] }>(
    "select taken_at, nav_usd, block, holdings from nav_snapshots where wallet = $1 order by taken_at",
    [a.wallet],
  );
  const trades = await d.query<{ tx_hash: string; side: string; token: string; amount_in: string; amount_out: string; usdc_raw: string; ts: string; builder_code: boolean }>(
    "select tx_hash, side, token, amount_in, amount_out, usdc_raw, ts, builder_code from trades where wallet = $1 order by ts desc limit 200",
    [a.wallet],
  );
  const weeks = await d.query<{ week: number; results: { bots: { wallet: string; ret: number }[] } | null }>(
    "select week, results from weeks where results is not null order by week",
  );
  const weekly = weeks
    .map((w) => ({ week: w.week, ret: w.results?.bots.find((b) => b.wallet.toLowerCase() === a.wallet.toLowerCase())?.ret }))
    .filter((w): w is { week: number; ret: number } => typeof w.ret === "number");
  return { agent: a, snaps, trades, weekly };
}

export async function player(wallet: string) {
  const [p] = await (await db()).query<{ wallet: string; universal: string | null; non_us_confirmed_at: string | null; telegram_id: string | null; telegram_username: string | null; display_name: string | null }>(
    "select wallet, universal, non_us_confirmed_at, telegram_id, telegram_username, display_name from players where wallet = $1",
    [wallet.toLowerCase()],
  );
  return p ?? null;
}
