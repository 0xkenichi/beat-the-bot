// Scoring and scheduled jobs from the command line (the same functions the /api/cron/tick route calls).
//   tsx src/cli.ts tick                         one scheduled pass
//   tsx src/cli.ts open   --week N
//   tsx src/cli.ts score  --week N [--dry-run] [--exclude 0xa,0xb]
//   tsx src/cli.ts settle --week N [--approved]   resolver key
//   tsx src/cli.ts relay-signed                   resolver key
//   tsx src/cli.ts metrics
import { mkdirSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { makePublicClient, weekIdAt, canonicalJson, weeklyMetrics } from "@btb/shared";
import { getDb, migrate, type Db } from "@btb/shared/db";
import { loadEnv } from "@btb/shared/env";
import { openWeek, type Results } from "./score";
import { relaySigned, runTick, scoreAndPublish, settleWeek } from "./jobs";

loadEnv();
const args = process.argv.slice(3);
const opt = (n: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined);
const flag = (n: string) => args.includes(`--${n}`);
const client = makePublicClient();
const weekArg = () => Number(opt("week") ?? Math.max(1, weekIdAt(Math.floor(Date.now() / 1000))));

function printResults(r: Results, hash: string) {
  const line = (x: { rank?: number; name: string; ret: number; openUsd?: number; flowsUsd?: number; eligible?: boolean; beatTheBot?: boolean; prize?: string }) =>
    `  ${String(x.rank).padStart(2)}. ${x.name.padEnd(14)} ${(x.ret * 100).toFixed(4).padStart(9)}%${x.openUsd != null ? `  open $${x.openUsd.toFixed(2)}` : ""}${x.flowsUsd ? `  flows $${x.flowsUsd.toFixed(2)}` : ""}${x.beatTheBot ? "  BEAT THE BOT" : ""}${x.eligible === false ? "  (not prize-eligible)" : ""}${x.prize ? `  prize ${x.prize}` : ""}`;
  console.log(`\nWeek ${r.weekId} results  hash ${hash}`);
  for (const u of r.universe) {
    const o = r.prices.open[u.address.toLowerCase()]!, c = r.prices.close[u.address.toLowerCase()]!;
    console.log(`  ${u.ticker.padEnd(6)} ${(Number(o.price8) / 1e8).toFixed(4)} -> ${(Number(c.price8) / 1e8).toFixed(4)}  ${((Number(c.price8) / Number(o.price8) - 1) * 100).toFixed(4)}%${o.stale || c.stale ? "  (stale round used)" : ""}`);
  }
  console.log("Bots:"); r.bots.forEach((x) => console.log(line(x)));
  console.log("Real money:"); r.real.forEach((x) => console.log(line(x)));
  console.log("Free play:"); r.paper.forEach((x) => console.log(line(x)));
  console.log("Winners:", r.winners.length ? "" : "none"); r.winners.forEach((w) => console.log(`  ${w.tier} #${w.rank} ${w.wallet} ${w.prizeText}`));
}

async function metrics(db: Db) {
  const m = await weeklyMetrics(db);
  mkdirSync("../docs/metrics", { recursive: true });
  const day = m.generatedAt.slice(0, 10);
  writeFileSync(`../docs/metrics/${day}.json`, JSON.stringify(m, null, 2) + "\n");
  const csv = "../docs/metrics/weekly.csv";
  if (!existsSync(csv)) appendFileSync(csv, "date,users_all_time,verified,dau,wau,user_swaps,user_volume_usdc,user_volume_30d_usdc,bot_swaps,bot_volume_usdc,paper_entries,weeks_settled,agents\n");
  appendFileSync(csv, [day, m.users.allTime, m.users.verified, m.users.dau, m.users.wau, m.swaps.userCount, m.swaps.userVolumeUsdc.toFixed(2), m.swaps.userVolumeUsdc30d.toFixed(2), m.swaps.botCount, m.swaps.botVolumeUsdc.toFixed(2), m.paper.entriesAllTime, m.prizes.weeksSettled, m.agents.registered].join(",") + "\n");
  console.log(JSON.stringify(m, null, 2));
}

const db = await getDb();
await migrate(db);
const cmd = process.argv[2];
try {
  if (cmd === "tick") await runTick(client, db);
  else if (cmd === "open") console.log(await openWeek(client, db, weekArg()));
  else if (cmd === "score") {
    const dry = flag("dry-run");
    const { results, hash } = await scoreAndPublish(client, db, weekArg(), { excluded: (opt("exclude") ?? "").split(",").filter(Boolean), dry });
    mkdirSync("results", { recursive: true });
    writeFileSync(`results/week-${weekArg()}${dry ? ".dry-run" : ""}.json`, canonicalJson(results));
    printResults(results, hash);
  } else if (cmd === "settle") await settleWeek(client, db, weekArg(), { approved: flag("approved") });
  else if (cmd === "relay-signed") console.log("relayed", await relaySigned(client, db));
  else if (cmd === "metrics") await metrics(db);
  else { console.error("usage: cli.ts tick|open|score|settle|relay-signed|metrics"); process.exit(2); }
  process.exit(0);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
