import { parseEventLogs, type Address, type Hex, type PublicClient } from "viem";
import { weekIdAt, weekSchedule, contracts, prizePoolAbi, pickBookAbi, agentRosterAbi, requireBuilderCode, HOUSE_AGENTS, makeContractsClient, makeContractsWallet } from "@btb/shared";
import { kvGet, type Db } from "@btb/shared/db";
import { runOnce } from "@btb/indexer";
import { sendPost } from "@btb/telegram";
import { botsDue, botWeeklyAction, initAgents, nextBotToRebalance } from "@btb/bots";
import { openWeek, publishResults, scoreWeek, type Results } from "./score";

type Env = Record<string, string | undefined>;
type Log = (s: string) => void;
const nowS = () => Math.floor(Date.now() / 1000);

/** The resolver's wallet on the contracts chain (Base Sepolia by default). Settles, relays signed picks and entries. */
export function resolverWallet(env: Env = process.env) {
  const key = env.RESOLVER_PRIVATE_KEY as Hex | undefined;
  if (!key) throw new Error("RESOLVER_PRIVATE_KEY is not set");
  return makeContractsWallet(key, env);
}

export async function scoreAndPublish(client: PublicClient, db: Db, week: number, o: { excluded?: string[]; dry?: boolean } = {}) {
  const { results, hash } = await scoreWeek(client, db, week, { excluded: o.excluded, takeSnapshot: !o.dry });
  if (!o.dry) await publishResults(db, week, results, hash);
  return { results, hash };
}

/** Pays a scored week: one PrizePool.settle per prize token. Weeks 1-2 need Kenichi's confirmation. */
export async function settleWeek(_client: PublicClient, db: Db, week: number, o: { approved?: boolean; env?: Env; log?: Log } = {}) {
  const client = makeContractsClient(o.env);
  const log = o.log ?? console.log;
  if (week <= 2 && !o.approved) throw new Error("Weeks 1-2: Kenichi confirms the winners are different people, then settle with --approved");
  const pool = contracts().prizePool;
  if (!pool) throw new Error("PrizePool is not deployed");
  const [w] = await db.query<{ results: Results | null; results_hash: string | null; settle_txs: unknown[] | null }>("select results, results_hash, settle_txs from weeks where week = $1", [week]);
  if (!w?.results || !w.results_hash) throw new Error(`Week ${week} is not scored`);
  if (w.settle_txs?.length) throw new Error(`Week ${week} is already settled`);
  const wallet = resolverWallet(o.env);
  const byToken = new Map<string, { winners: Address[]; amounts: bigint[] }>();
  for (const x of w.results.winners) {
    const e = byToken.get(x.token) ?? { winners: [], amounts: [] };
    e.winners.push(x.wallet as Address);
    e.amounts.push(BigInt(x.amountRaw));
    byToken.set(x.token, e);
  }
  if (w.results.prizeToken && !byToken.size) byToken.set(w.results.prizeToken, { winners: [], amounts: [] });
  const txs = [];
  for (const [token, e] of byToken) {
    const hash = await wallet.writeContract({ address: pool, abi: prizePoolAbi, functionName: "settle", args: [week, token as Address, e.winners, e.amounts, w.results_hash as Hex] });
    const rc = await client.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") throw new Error(`settle reverted: ${hash}`);
    const deferred = parseEventLogs({ abi: prizePoolAbi, logs: rc.logs, eventName: "PayoutDeferred" });
    log(`settled ${token}: ${hash}${deferred.length ? ` (${deferred.length} payouts kept for withdraw())` : ""}`);
    txs.push({ token, tx: hash, tier: "real + free play" });
  }
  await db.query("update weeks set settle_txs = $2::jsonb, status = 'settled' where week = $1", [week, JSON.stringify(txs)]);
  return txs;
}

/** Submits free-play picks that players signed while gas sponsorship was down (PickBook.lockFor). */
export async function relaySigned(_client: PublicClient, db: Db, env: Env = process.env, now = nowS()) {
  const client = makeContractsClient(env);
  const pickBook = contracts(env).pickBook;
  if (!pickBook || !env.RESOLVER_PRIVATE_KEY) return 0;
  const pending = await db.query<{ week: number; wallet: string; picks: { tokenIndex: number; weightBps: number }[]; deadline: string; signature: string }>(
    "select week, wallet, picks, deadline, signature from signed_locks where relayed_tx is null and error is null and deadline > $1",
    [now],
  );
  // Picks signed before their week opens wait here until it does (PickBook would refuse them before then).
  const rows = pending.filter((r) => { const w = weekSchedule(r.week); return now >= w.entryOpen && now < w.entryClose; });
  if (!rows.length) return 0;
  const wallet = resolverWallet(env);
  for (const r of rows) {
    try {
      const hash = await wallet.writeContract({ address: pickBook, abi: pickBookAbi, functionName: "lockFor", args: [r.wallet as Address, r.week, r.picks as never, BigInt(r.deadline), r.signature as Hex] });
      const rc = await client.waitForTransactionReceipt({ hash });
      if (rc.status !== "success") throw new Error(`lockFor reverted: ${hash}`);
      await db.query("update signed_locks set relayed_tx = $3 where week = $1 and wallet = $2", [r.week, r.wallet, hash]);
    } catch (e) {
      await db.query("update signed_locks set error = $3 where week = $1 and wallet = $2", [r.week, r.wallet, (e as Error).message.slice(0, 300)]);
    }
  }
  return rows.length;
}

/**
 * Submits agents' signed registrations with AgentRoster.registerFor (the resolver is the registrar). Used by agents
 * whose wallets cannot send transactions on the contracts chain; their identity was checked when they signed.
 */
export async function relayRegistrations(db: Db, env: Env = process.env, now = nowS()) {
  const roster = contracts(env).agentRoster;
  if (!roster || !env.RESOLVER_PRIVATE_KEY) return 0;
  const client = makeContractsClient(env);
  const rows = await db.query<{ wallet: string; erc8004_id: string; identity_chain: number; metadata_uri: string; deadline: string; signature: string }>(
    "select wallet, erc8004_id, identity_chain, metadata_uri, deadline, signature from signed_registrations where relayed_tx is null and error is null and deadline > $1",
    [now],
  );
  if (!rows.length) return 0;
  const wallet = resolverWallet(env);
  const termsHash = await client.readContract({ address: roster, abi: agentRosterAbi, functionName: "termsHash" });
  for (const r of rows) {
    try {
      const hash = await wallet.writeContract({
        address: roster, abi: agentRosterAbi, functionName: "registerFor",
        args: [r.wallet as Address, r.metadata_uri, BigInt(r.erc8004_id), BigInt(r.identity_chain), termsHash, BigInt(r.deadline), r.signature as Hex],
      });
      const rc = await client.waitForTransactionReceipt({ hash });
      if (rc.status !== "success") throw new Error(`registerFor reverted: ${hash}`);
      await db.query("update signed_registrations set relayed_tx = $2 where wallet = $1", [r.wallet, hash]);
    } catch (e) {
      await db.query("update signed_registrations set error = $2 where wallet = $1", [r.wallet, (e as Error).message.slice(0, 300)]);
    }
  }
  return rows.length;
}

/** Overlapping calls skip instead of doubling up. The lock expires on its own after a few minutes. */
async function takeLock(db: Db, name: string, ttlSeconds: number) {
  const rows = await db.query(
    `insert into kv (key, value, updated_at) values ($1, 'true'::jsonb, now())
     on conflict (key) do update set updated_at = now() where kv.updated_at < now() - make_interval(secs => $2)
     returning key`,
    [`lock:${name}`, ttlSeconds],
  );
  return rows.length > 0;
}
const releaseLock = (db: Db, name: string) => db.query("update kv set updated_at = to_timestamp(0) where key = $1", [`lock:${name}`]);

/**
 * One scheduled pass, called every 5 minutes by an external cron (or locally). Idempotent. Every post time falls on
 * a 5-minute mark, so posts go out on their exact minute. Each step is independent: one failing does not stop the rest.
 * Holds whichever keys the environment gives it: the resolver key for settling and relays, the bot keys for trading.
 */
export async function runTick(client: PublicClient, db: Db, o: { env?: Env; log?: Log; now?: number } = {}) {
  const env = o.env ?? process.env;
  const lines: string[] = [];
  const log: Log = (s) => { lines.push(s); (o.log ?? console.log)(s); };
  if (!(await takeLock(db, "tick", 270))) { log("another tick is running; skipped"); return lines; }
  const step = async (name: string, f: () => Promise<unknown>) => {
    try {
      const r = await f();
      if (r !== undefined && r !== null && r !== false) log(`${name}: ${typeof r === "string" ? r : JSON.stringify(r)}`);
    } catch (e) {
      log(`${name} FAILED: ${(e as Error).message.split("\n")[0]}`);
    }
  };
  try {
    const t = o.now ?? nowS();
    const week = Math.max(1, weekIdAt(t));
    const s = weekSchedule(week);
    const tg = env.TELEGRAM_BOT_TOKEN, group = env.TELEGRAM_GROUP_CHAT_ID, site = env.NEXT_PUBLIC_SITE_URL ?? "";

    // 1. Posts first, so they land on their minute.
    if (tg && group) {
      for (const kind of ["entries-open", "one-hour-left", "results"] as const) {
        await step(`post ${kind}`, async () => {
          const r = await sendPost(db, kind, week, { site, token: tg, group, waitMaxMs: 0 });
          return r === "sent" ? "sent" : null;
        });
      }
    }
    // 2. Prices, locks, deposits and withdrawals, hourly snapshots.
    await step("indexer", () => runOnce(client, db, () => {}));
    const [w] = await db.query<{ open_prices: unknown; results: unknown; settle_txs: unknown }>("select open_prices, results, settle_txs from weeks where week = $1", [week]);
    // 3. Opening prices and snapshot at the US open.
    if (t >= s.entryClose && !w?.open_prices) await step("open week", async () => `${Object.keys((await openWeek(client, db, week)).prices).length} prices`);
    // 4. Score five minutes after the US close (the results post follows at close + 30 minutes).
    if (t >= s.scoreAt + 300 && !w?.results) await step("score week", async () => (await scoreAndPublish(client, db, week)).hash);
    // 5. From week 3, settle automatically if Kenichi turned it on.
    if (w?.results && !w.settle_txs && week >= 3 && env.RESOLVER_PRIVATE_KEY && (await kvGet(db, "auto_settle", false))) await step("settle", () => settleWeek(client, db, week, { env, log }));
    // 6. Signed free-play picks (before entries close) and signed agent entries.
    if (env.RESOLVER_PRIVATE_KEY) await step("relay signed locks", async () => (await relaySigned(client, db, env, t)) || null);
    if (env.RESOLVER_PRIVATE_KEY) await step("relay signed agent entries", async () => (await relayRegistrations(db, env, t)) || null);
    // 7. One house bot per tick: picks during the entry window (no-cost setup) or trades after the US open.
    if (HOUSE_AGENTS.some((a) => env[a.keyEnv]) && botsDue(t, env)) {
      await step("bots", async () => {
        await initAgents(db, env, () => {});
        const next = await nextBotToRebalance(db, env, t);
        if (!next) return null;
        return `${next.name} ${await botWeeklyAction(next, { client, db, builderCode: requireBuilderCode(env), env, now: t, log })}`;
      });
    }
  } finally {
    await releaseLock(db, "tick");
  }
  return lines;
}
