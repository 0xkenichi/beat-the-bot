// Scoring job. Holds the resolver key only (RESOLVER_PRIVATE_KEY); never the owner key.
//   tsx src/cli.ts tick                       scheduled: indexer, open, score, posts, relays
//   tsx src/cli.ts open  --week N
//   tsx src/cli.ts score --week N [--dry-run] [--approve 0xa,0xb]
//   tsx src/cli.ts settle --week N [--approved]
//   tsx src/cli.ts relay-signed
//   tsx src/cli.ts metrics
import { mkdirSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { createWalletClient, http, parseEventLogs, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { makePublicClient, weekIdAt, weekSchedule, canonicalJson, contracts, prizePoolAbi, pickBookAbi, builderCodeSuffix, requireBuilderCode, weeklyMetrics, isTradingDay } from "@btb/shared";
import { getDb, migrate, kvGet, type Db } from "@btb/shared/db";
import { loadEnv } from "@btb/shared/env";
import { runOnce } from "@btb/indexer";
import { sendPost } from "@btb/telegram";
import { openWeek, publishResults, scoreWeek, type Results } from "./score";

loadEnv();
const args = process.argv.slice(3);
const opt = (n: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined);
const flag = (n: string) => args.includes(`--${n}`);
const client = makePublicClient();
const nowS = () => Math.floor(Date.now() / 1000);
const weekArg = () => Number(opt("week") ?? Math.max(1, weekIdAt(nowS())));

function resolverWallet() {
  const key = process.env.RESOLVER_PRIVATE_KEY as Hex | undefined;
  if (!key) throw new Error("RESOLVER_PRIVATE_KEY is not set");
  return createWalletClient({ account: privateKeyToAccount(key), chain: base, transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org"), dataSuffix: builderCodeSuffix(requireBuilderCode()) });
}

async function cmdScore(db: Db, week: number, dry: boolean) {
  const approved = (opt("approve") ?? "").split(",").filter(Boolean);
  const { results, hash } = await scoreWeek(client, db, week, { approved, takeSnapshot: !dry });
  mkdirSync("results", { recursive: true });
  writeFileSync(`results/week-${week}${dry ? ".dry-run" : ""}.json`, canonicalJson(results));
  printResults(results, hash);
  if (!dry) await publishResults(db, week, results, hash);
  return { results, hash };
}

function printResults(r: Results, hash: string) {
  const line = (x: { rank?: number; name: string; ret: number; openUsd?: number; flowsUsd?: number; eligible?: boolean; beatTheBot?: boolean; prize?: string }) =>
    `  ${String(x.rank).padStart(2)}. ${x.name.padEnd(14)} ${(x.ret * 100).toFixed(4).padStart(9)}%${x.openUsd != null ? `  open $${x.openUsd.toFixed(2)}` : ""}${x.flowsUsd ? `  flows $${x.flowsUsd.toFixed(2)}` : ""}${x.beatTheBot ? "  BEAT THE BOT" : ""}${x.eligible === false ? "  (not prize-eligible)" : ""}${x.prize ? `  prize ${x.prize}` : ""}`;
  console.log(`\nWeek ${r.weekId} results  hash ${hash}`);
  console.log("Prices (open -> close):");
  for (const u of r.universe) {
    const o = r.prices.open[u.address.toLowerCase()]!, c = r.prices.close[u.address.toLowerCase()]!;
    console.log(`  ${u.ticker.padEnd(6)} ${(Number(o.price8) / 1e8).toFixed(4)} -> ${(Number(c.price8) / 1e8).toFixed(4)}  ${((Number(c.price8) / Number(o.price8) - 1) * 100).toFixed(4)}%${o.stale || c.stale ? "  (stale round used)" : ""}`);
  }
  console.log("Bots:"); r.bots.forEach((x) => console.log(line(x)));
  console.log("Real money:"); r.real.forEach((x) => console.log(line(x)));
  console.log("Free play:"); r.paper.forEach((x) => console.log(line(x)));
  console.log("Winners:", r.winners.length ? "" : "none"); r.winners.forEach((w) => console.log(`  ${w.tier} #${w.rank} ${w.wallet} ${w.prizeText}`));
}

async function cmdSettle(db: Db, week: number) {
  if (week <= 2 && !flag("approved")) throw new Error("Weeks 1-2: Kenichi confirms the winners are different people, then run settle with --approved");
  const pool = contracts().prizePool;
  if (!pool) throw new Error("PrizePool is not deployed");
  const [w] = await db.query<{ results: Results | null; results_hash: string | null; settle_txs: unknown[] | null }>("select results, results_hash, settle_txs from weeks where week = $1", [week]);
  if (!w?.results || !w.results_hash) throw new Error(`Week ${week} is not scored`);
  if (w.settle_txs?.length) throw new Error(`Week ${week} is already settled`);
  const wallet = resolverWallet();
  const byToken = new Map<string, { winners: Address[]; amounts: bigint[] }>();
  for (const x of w.results.winners) {
    const e = byToken.get(x.token) ?? { winners: [], amounts: [] };
    e.winners.push(x.wallet as Address);
    e.amounts.push(BigInt(x.amountRaw));
    byToken.set(x.token, e);
  }
  if (w.results.prizeToken && !byToken.size) byToken.set(w.results.prizeToken, { winners: [], amounts: [] }); // nobody eligible: settle returns it all
  const txs = [];
  for (const [token, e] of byToken) {
    const hash = await wallet.writeContract({ address: pool, abi: prizePoolAbi, functionName: "settle", args: [week, token as Address, e.winners, e.amounts, w.results_hash as Hex] });
    const rc = await client.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") throw new Error(`settle reverted: ${hash}`);
    const deferred = parseEventLogs({ abi: prizePoolAbi, logs: rc.logs, eventName: "PayoutDeferred" });
    console.log(`settled ${token}: ${hash}${deferred.length ? ` (${deferred.length} payouts deferred to withdraw())` : ""}`);
    txs.push({ token, tx: hash, tier: "real + free play" });
  }
  await db.query("update weeks set settle_txs = $2::jsonb, status = 'settled' where week = $1", [week, JSON.stringify(txs)]);
}

async function cmdRelaySigned(db: Db) {
  const pickBook = contracts().pickBook;
  if (!pickBook) return 0;
  const rows = await db.query<{ week: number; wallet: string; picks: { tokenIndex: number; weightBps: number }[]; deadline: string; signature: string }>(
    "select week, wallet, picks, deadline, signature from signed_locks where relayed_tx is null and error is null and deadline > $1",
    [nowS()],
  );
  if (!rows.length) return 0;
  const wallet = resolverWallet();
  for (const r of rows) {
    try {
      const hash = await wallet.writeContract({
        address: pickBook, abi: pickBookAbi, functionName: "lockFor",
        args: [r.wallet as Address, r.week, r.picks as never, BigInt(r.deadline), r.signature as Hex],
      });
      await client.waitForTransactionReceipt({ hash });
      await db.query("update signed_locks set relayed_tx = $3 where week = $1 and wallet = $2", [r.week, r.wallet, hash]);
    } catch (e) {
      await db.query("update signed_locks set error = $3 where week = $1 and wallet = $2", [r.week, r.wallet, (e as Error).message.slice(0, 300)]);
    }
  }
  return rows.length;
}

async function cmdMetrics(db: Db) {
  const m = await weeklyMetrics(db);
  mkdirSync("../docs/metrics", { recursive: true });
  const day = m.generatedAt.slice(0, 10);
  writeFileSync(`../docs/metrics/${day}.json`, JSON.stringify(m, null, 2) + "\n");
  const csv = "../docs/metrics/weekly.csv";
  if (!existsSync(csv)) appendFileSync(csv, "date,users_all_time,verified,dau,wau,user_swaps,user_volume_usdc,user_volume_30d_usdc,bot_swaps,bot_volume_usdc,paper_entries,weeks_settled,agents\n");
  appendFileSync(csv, [day, m.users.allTime, m.users.verified, m.users.dau, m.users.wau, m.swaps.userCount, m.swaps.userVolumeUsdc.toFixed(2), m.swaps.userVolumeUsdc30d.toFixed(2), m.swaps.botCount, m.swaps.botVolumeUsdc.toFixed(2), m.paper.entriesAllTime, m.prizes.weeksSettled, m.agents.registered].join(",") + "\n");
  console.log(JSON.stringify(m, null, 2));
}

/** One scheduled pass. Idempotent: safe to run every 15 minutes. */
async function tick(db: Db) {
  await runOnce(client, db);
  const t = nowS();
  const week = Math.max(1, weekIdAt(t));
  const s = weekSchedule(week);
  const [w] = await db.query<{ open_prices: unknown; results: unknown; settle_txs: unknown }>("select open_prices, results, settle_txs from weeks where week = $1", [week]);
  if (t >= s.entryClose && !w?.open_prices) console.log("open:", Object.keys((await openWeek(client, db, week)).prices).length, "prices");
  if (t >= s.scoreAt + 300 && !w?.results) await cmdScore(db, week, false);
  if (t >= s.scoreAt && w?.results && !w.settle_txs && week >= 3 && (await kvGet(db, "auto_settle", false))) await cmdSettle(db, week);
  if (t < s.entryClose) console.log("relayed signed locks:", await cmdRelaySigned(db));
  const tg = process.env.TELEGRAM_BOT_TOKEN, group = process.env.TELEGRAM_GROUP_CHAT_ID;
  if (tg && group) {
    for (const kind of ["entries-open", "one-hour-left", "results"] as const) {
      const r = await sendPost(db, kind, week, { site: process.env.NEXT_PUBLIC_SITE_URL ?? "", token: tg, group });
      if (r === "sent") console.log(`posted ${kind}`);
    }
  }
  void isTradingDay;
}

const db = await getDb();
await migrate(db);
const cmd = process.argv[2];
try {
  if (cmd === "tick") await tick(db);
  else if (cmd === "open") console.log(await openWeek(client, db, weekArg()));
  else if (cmd === "score") await cmdScore(db, weekArg(), flag("dry-run"));
  else if (cmd === "settle") await cmdSettle(db, weekArg());
  else if (cmd === "relay-signed") console.log("relayed", await cmdRelaySigned(db));
  else if (cmd === "metrics") await cmdMetrics(db);
  else { console.error("usage: cli.ts tick|open|score|settle|relay-signed|metrics"); process.exit(2); }
  process.exit(0);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
