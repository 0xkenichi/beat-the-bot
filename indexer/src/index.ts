import { parseAbi, parseEventLogs, type Address, type PublicClient } from "viem";
import { ADDR, UNIVERSE, latestRound, valueUsd, valueWallet, pickBookAbi, contracts, DEPLOYMENTS, b20Abi } from "@btb/shared";
import { kvGet, kvSet, type Db } from "@btb/shared/db";

const transferAbi = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const CHUNK = Number(process.env.LOGS_CHUNK ?? 500);

/** Caches the latest Chainlink price per stock (the web pages read this instead of calling the chain). */
export async function cachePrices(client: PublicClient, db: Db) {
  const out: Record<string, { price8: string; updatedAt: number; roundId: string }> = {};
  for (const t of UNIVERSE) {
    const r = await latestRound(client, t.feed);
    out[t.address.toLowerCase()] = { price8: r.answer.toString(), updatedAt: r.updatedAt, roundId: r.roundId.toString() };
  }
  await kvSet(db, "prices:latest", out);
  await kvSet(db, "tickers", Object.fromEntries(UNIVERSE.map((t) => [t.address.toLowerCase(), t.ticker])));
  return out;
}

type RawLog = { address: Address; topics: [`0x${string}`, ...`0x${string}`[]]; data: `0x${string}`; blockNumber: `0x${string}`; transactionHash: `0x${string}`; logIndex: `0x${string}` };

async function getLogsChunked(client: PublicClient, params: { address: Address | Address[]; topics: (string | string[] | null)[] }, from: bigint, to: bigint): Promise<RawLog[]> {
  const logs: RawLog[] = [];
  let size = BigInt(CHUNK);
  for (let start = from; start <= to; ) {
    const end = start + size - 1n > to ? to : start + size - 1n;
    try {
      const res = await client.request({
        method: "eth_getLogs",
        params: [{ address: params.address, topics: params.topics as never, fromBlock: `0x${start.toString(16)}`, toBlock: `0x${end.toString(16)}` }],
      });
      logs.push(...(res as RawLog[]));
      start = end + 1n;
    } catch (e) {
      if (size <= 100n) throw e;
      size = 100n; // public endpoints cap the range
    }
  }
  return logs;
}

/** PickBook Locked events -> paper_locks. */
export async function indexLocks(client: PublicClient, db: Db, head: bigint) {
  const pickBook = contracts().pickBook;
  if (!pickBook) return 0;
  const from = BigInt(await kvGet<string>(db, "cursor:locks", String(DEPLOYMENTS.deployedBlock ?? head - 1000n)));
  if (from > head) return 0;
  const raw = await getLogsChunked(client, { address: pickBook, topics: [] }, from, head);
  const events = parseEventLogs({ abi: pickBookAbi, logs: raw.map((l) => ({ ...l, blockNumber: BigInt(l.blockNumber), logIndex: Number(l.logIndex) })) as never, eventName: "Locked" });
  for (const e of events) {
    const block = await client.getBlock({ blockNumber: e.blockNumber! });
    const picks = e.args.tokenIndexes.map((ti, i) => ({ tokenIndex: Number(ti), weightBps: Number(e.args.weightsBps[i]) }));
    await db.query(
      `insert into paper_locks (week, wallet, picks, picks_hash, locked_at, tx_hash, block) values ($1, $2, $3::jsonb, $4, $5, $6, $7)
       on conflict (week, wallet) do update set picks = excluded.picks, picks_hash = excluded.picks_hash, locked_at = excluded.locked_at, tx_hash = excluded.tx_hash, block = excluded.block
       where paper_locks.block <= excluded.block`,
      [e.args.weekId, e.args.player.toLowerCase(), JSON.stringify(picks), e.args.picksHash, Number(block.timestamp), e.transactionHash, e.blockNumber!.toString()],
    );
  }
  await kvSet(db, "cursor:locks", String(head + 1n));
  return events.length;
}

/**
 * Deposits and withdrawals of USDC and universe stocks for tracked wallets -> flows. Transfers to or from a
 * universe pool are swap legs, not flows. Stock flows are valued with the multiplier and the latest price.
 */
export async function indexFlows(client: PublicClient, db: Db, head: bigint) {
  const wallets = [
    ...(await db.query<{ wallet: string }>("select wallet from players where non_us_confirmed_at is not null")),
    ...(await db.query<{ wallet: string }>("select wallet from agents")),
  ].map((r) => r.wallet.toLowerCase());
  const from = BigInt(await kvGet<string>(db, "cursor:flows", String(head - 300n)));
  if (!wallets.length || from > head) {
    await kvSet(db, "cursor:flows", String(head + 1n));
    return 0;
  }
  const pools = new Set(UNIVERSE.map((t) => t.pool.address.toLowerCase()));
  const tokens = [ADDR.USDC, ...UNIVERSE.map((t) => t.address)] as Address[];
  const padded = wallets.map((w) => `0x${w.slice(2).padStart(64, "0")}`);
  const out = await getLogsChunked(client, { address: tokens, topics: [TRANSFER, padded] }, from, head);
  const inc = await getLogsChunked(client, { address: tokens, topics: [TRANSFER, null, padded] }, from, head);
  const prices = await kvGet<Record<string, { price8: string }>>(db, "prices:latest", {});
  let n = 0;
  for (const l of [...out, ...inc]) {
    const [ev] = parseEventLogs({ abi: transferAbi, logs: [{ ...l, blockNumber: BigInt(l.blockNumber), logIndex: Number(l.logIndex) }] as never });
    if (!ev) continue;
    const fromA = ev.args.from.toLowerCase(), toA = ev.args.to.toLowerCase();
    const outgoing = wallets.includes(fromA);
    const wallet = outgoing ? fromA : toA;
    const counterparty = outgoing ? toA : fromA;
    if (pools.has(counterparty)) continue; // swap leg
    if (wallets.includes(fromA) && wallets.includes(toA)) continue;
    const token = l.address.toLowerCase();
    let usd: number;
    if (token === ADDR.USDC.toLowerCase()) usd = Number(ev.args.value) / 1e6;
    else {
      const t = UNIVERSE.find((u) => u.address.toLowerCase() === token)!;
      const mult = await client.readContract({ address: t.address, abi: b20Abi, functionName: "uiMultiplier" });
      usd = valueUsd(ev.args.value, mult, BigInt(prices[token]?.price8 ?? "0"));
    }
    const block = await client.getBlock({ blockNumber: BigInt(l.blockNumber) });
    await db.query(
      `insert into flows (tx_hash, log_index, wallet, token, amount_raw, usd, ts, block) values ($1, $2, $3, $4, $5, $6, to_timestamp($7), $8) on conflict do nothing`,
      [l.transactionHash, Number(l.logIndex), wallet, token, ev.args.value.toString(), outgoing ? -usd : usd, Number(block.timestamp), BigInt(l.blockNumber).toString()],
    );
    n++;
  }
  await kvSet(db, "cursor:flows", String(head + 1n));
  return n;
}

/** Hourly valuation of every tracked wallet (bots and players), stamped at the top of the hour. */
export async function snapshotAll(client: PublicClient, db: Db, stamp: Date, opts: { blockNumber?: bigint; prices?: Record<string, bigint> } = {}) {
  const wallets = [
    ...(await db.query<{ wallet: string }>("select wallet from agents")),
    ...(await db.query<{ wallet: string }>("select wallet from players where non_us_confirmed_at is not null")),
  ].map((r) => r.wallet.toLowerCase() as Address);
  let n = 0;
  for (const w of [...new Set(wallets)]) {
    const v = await valueWallet(client, w, undefined, opts);
    await db.query(
      `insert into nav_snapshots (wallet, taken_at, block, nav_usd, usdc_raw, holdings) values ($1, $2, $3, $4, $5, $6::jsonb)
       on conflict (wallet, taken_at) do update set block = excluded.block, nav_usd = excluded.nav_usd, usdc_raw = excluded.usdc_raw, holdings = excluded.holdings`,
      [w, stamp.toISOString(), v.block.toString(), v.navUsd, v.usdcRaw.toString(), JSON.stringify(v.holdings.filter((h) => h.raw !== "0"))],
    );
    n++;
  }
  // Agents' starting value is their first snapshot of at least $1.
  await db.query(
    `update agents a set start_nav = s.nav_usd, started_at = s.taken_at
     from (select distinct on (wallet) wallet, nav_usd, taken_at from nav_snapshots where nav_usd >= 1 order by wallet, taken_at) s
     where a.wallet = s.wallet and a.start_nav is null`,
  );
  return n;
}

export async function runOnce(client: PublicClient, db: Db, log = console.log) {
  const head = await client.getBlockNumber();
  await cachePrices(client, db);
  const locks = await indexLocks(client, db, head);
  const flows = await indexFlows(client, db, head);
  const stamp = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
  const [have] = await db.query("select 1 from nav_snapshots where taken_at = $1 limit 1", [stamp.toISOString()]);
  const snaps = have ? 0 : await snapshotAll(client, db, stamp);
  log(`indexer: head ${head}, ${locks} locks, ${flows} flows, ${snaps} snapshots`);
}
