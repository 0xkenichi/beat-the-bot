import type { Address, Hex, PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { HOUSE_AGENTS, UNIVERSE, botsMode, contracts, isMarketOpen, makeContractsClient, makeContractsWallet, pickBookAbi, valueWallet, weekIdAt, weekSchedule, type HouseAgent, type UniverseToken } from "@btb/shared";
import { fiveDayReturns } from "./strategies/common";
import { kvGet, kvSet, type Db } from "@btb/shared/db";
import { momentum } from "./strategies/momentum";
import { contrarian } from "./strategies/contrarian";
import { steady } from "./strategies/steady";
import { executePlan, makeBotWallet, planRebalance } from "./executor";

type Env = Record<string, string | undefined>;

export function botAddress(a: HouseAgent, env: Env = process.env): Address | undefined {
  const key = env[a.keyEnv] as Hex | undefined;
  if (key) return privateKeyToAccount(key).address;
  return env[a.addressEnv] as Address | undefined;
}

/** Inserts or updates the house agents from their keys (or public addresses). */
export async function initAgents(db: Db, env: Env = process.env, log = console.log) {
  for (const a of HOUSE_AGENTS) {
    const addr = botAddress(a, env);
    if (!addr) { log(`${a.name}: no ${a.keyEnv} or ${a.addressEnv} yet, skipped`); continue; }
    await db.query(
      `insert into agents (id, name, strategy, wallet, house) values ($1, $2, $3, $4, true)
       on conflict (id) do update set name = excluded.name, strategy = excluded.strategy, wallet = excluded.wallet`,
      [a.id, a.name, a.strategy, addr.toLowerCase()],
    );
    log(`${a.name}: ${addr}`);
  }
}

export { botsMode };

/** True when the bots should act now: picks during the entry window, trades after the US open. */
export function botsDue(now = Math.floor(Date.now() / 1000), env: Env = process.env) {
  const week = Math.max(1, weekIdAt(now));
  const s = weekSchedule(week);
  if (botsMode(env) === "picks") return now >= s.entryOpen + 300 && now < s.entryClose - 600;
  return isMarketOpen(now) && now >= s.entryClose;
}

/**
 * Turns a strategy's weights into three PickBook picks: the three largest weights, ties broken by `tieScore`
 * (lower first), weights rescaled to 10,000 basis points.
 */
export function weightsToPicks(weights: Record<string, number>, universe: UniverseToken[], tieScore: (t: UniverseToken) => number) {
  const w = (t: UniverseToken) => Object.entries(weights).find(([a]) => a.toLowerCase() === t.address.toLowerCase())?.[1] ?? 0;
  const top = universe
    .map((t, i) => ({ i, w: w(t), tb: tieScore(t) }))
    .sort((a, b) => b.w - a.w || a.tb - b.tb || a.i - b.i)
    .slice(0, 3);
  const sum = top.reduce((a, x) => a + x.w, 0);
  const bps = top.map((x) => (sum > 0 ? Math.max(1, Math.floor((x.w / sum) * 10_000)) : 3333));
  bps[0]! += 10_000 - bps.reduce((a, b) => a + b, 0);
  return top.map((x, k) => ({ tokenIndex: x.i, weightBps: bps[k]! }));
}

/** Picks mode: the bot locks its three picks for the week from its own wallet on the contracts chain. */
export async function lockBotPicks(
  a: HouseAgent,
  o: { client: PublicClient; db: Db; env?: Env; now?: number; dry?: boolean; log?: (s: string) => void },
): Promise<"locked" | "dry-run" | "already" | "paused" | "no-key" | "no-contract"> {
  const env = o.env ?? process.env;
  const log = o.log ?? console.log;
  const now = o.now ?? Math.floor(Date.now() / 1000);
  const week = Math.max(1, weekIdAt(now));
  const key = env[a.keyEnv] as Hex | undefined;
  if (!key && !o.dry) return "no-key";
  const pickBook = contracts(env).pickBook;
  if (!pickBook && !o.dry) return "no-contract";
  const doneKey = `locked:${a.id}:${week}`;
  if (await kvGet(o.db, doneKey, false)) return "already";
  const [row] = await o.db.query<{ paused: boolean }>("select paused from agents where id = $1", [a.id]);
  if (row?.paused) return "paused";
  const strat = a.id === "momentum" ? momentum : a.id === "contrarian" ? contrarian : steady;
  const targets = await strat(o.client, UNIVERSE, now, env);
  const moves = new Map((await fiveDayReturns(o.client, UNIVERSE, now)).returns.map((r) => [r.token.address, Math.abs(r.ret)]));
  const picks = weightsToPicks(targets.weights, UNIVERSE, (t) => moves.get(t.address) ?? 1);
  const label = picks.map((p) => `${UNIVERSE[p.tokenIndex]!.ticker} ${(p.weightBps / 100).toFixed(0)}%`).join(", ");
  if (o.dry) {
    log(`${a.name} (${targets.source}) would lock: ${label}. ${targets.note}`);
    return "dry-run";
  }
  const wallet = makeContractsWallet(key!, env);
  const hash = await wallet.writeContract({ address: pickBook!, abi: pickBookAbi, functionName: "lock", args: [week, picks as never] });
  const rc = await makeContractsClient(env).waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error(`${a.name}: lock reverted (${hash})`);
  const why = targets.source === "equal-weight" ? `No model answer this week, so it took the three stocks that moved least over the last five trading days.` : targets.note;
  await kvSet(o.db, `bot_note:${a.id}:${week}`, { source: targets.source, note: `Locked ${label}. ${why}`, weights: targets.weights, picks, tx: hash, at: now });
  await kvSet(o.db, doneKey, true);
  log(`${a.name} locked ${label}: ${hash}`);
  return "locked";
}

/**
 * Rebalances one house bot once per week, from its own wallet. Returns what happened.
 * Guardrails live in planRebalance/executePlan; this adds the weekly once-only rule and the 50% pause.
 */
export async function rebalanceBot(
  a: HouseAgent,
  o: { client: PublicClient; db: Db; builderCode: string; env?: Env; now?: number; dry?: boolean; log?: (s: string) => void },
): Promise<"done" | "dry-run" | "already" | "paused" | "no-wallet" | "no-key"> {
  const env = o.env ?? process.env;
  const log = o.log ?? console.log;
  const now = o.now ?? Math.floor(Date.now() / 1000);
  const week = Math.max(1, weekIdAt(now));
  const key = env[a.keyEnv] as Hex | undefined;
  const addr = botAddress(a, env);
  if (!addr) return "no-wallet";
  const doneKey = `rebalanced:${a.id}:${week}`;
  if (!o.dry && (await kvGet(o.db, doneKey, false))) return "already";
  const [row] = await o.db.query<{ start_nav: number | null; paused: boolean }>("select start_nav, paused from agents where id = $1", [a.id]);
  if (row?.paused) return "paused";
  const v = await valueWallet(o.client, addr);
  if (row?.start_nav && v.navUsd < row.start_nav * 0.5) {
    await o.db.query("update agents set paused = true, paused_reason = $2 where id = $1", [a.id, `NAV $${v.navUsd.toFixed(2)} fell below half of the $${row.start_nav.toFixed(2)} start`]);
    log(`${a.name}: paused (below 50% of starting NAV)`);
    return "paused";
  }
  const strat = a.id === "momentum" ? momentum : a.id === "contrarian" ? contrarian : steady;
  const targets = await strat(o.client, UNIVERSE, now, env);
  const plan = planRebalance(v, targets.weights);
  log(`${a.name} (${addr}) NAV $${v.navUsd.toFixed(2)} | ${targets.source}: ${targets.note}`);
  for (const p of plan) log(`  plan ${p.side} ${p.token.ticker} ~$${p.usd.toFixed(2)} (${p.why})`);
  await kvSet(o.db, `bot_note:${a.id}:${week}`, { source: targets.source, note: targets.note, weights: targets.weights, at: now });
  if (o.dry) return "dry-run";
  if (!key) return "no-key";
  const wallet = makeBotWallet(key, o.builderCode, env.BASE_RPC_URL);
  const trades = await executePlan({ client: o.client, wallet, plan, builderCode: o.builderCode, now, log });
  for (const t of trades) {
    await o.db.query(
      `insert into trades (tx_hash, wallet, kind, side, token, amount_in, amount_out, usdc_raw, builder_code, status)
       values ($1, $2, 'bot', $3, $4, $5, $6, $7, $8, 'confirmed') on conflict do nothing`,
      [t.tx, addr.toLowerCase(), t.side, t.token.address.toLowerCase(), t.amountIn.toString(), t.amountOut.toString(), t.usdc.toString(), t.builderCode],
    );
  }
  await kvSet(o.db, doneKey, true);
  return "done";
}

/** The next house bot that has not acted this week (traded or locked, by mode), if any. */
export async function nextBotToRebalance(db: Db, env: Env = process.env, now = Math.floor(Date.now() / 1000)) {
  const week = Math.max(1, weekIdAt(now));
  const prefix = botsMode(env) === "picks" ? "locked" : "rebalanced";
  for (const a of HOUSE_AGENTS) {
    if (!env[a.keyEnv]) continue;
    if (!(await kvGet(db, `${prefix}:${a.id}:${week}`, false))) return a;
  }
  return null;
}

/** One bot's weekly action in the current mode. */
export async function botWeeklyAction(a: HouseAgent, o: { client: PublicClient; db: Db; builderCode: string; env?: Env; now?: number; dry?: boolean; log?: (s: string) => void }) {
  return botsMode(o.env) === "picks" ? lockBotPicks(a, o) : rebalanceBot(a, o);
}
