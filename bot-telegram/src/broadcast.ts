// Manual broadcast: tsx src/broadcast.ts entries-open|one-hour-left|results [--week N] [--force]
import { getDb } from "@btb/shared/db";
import { loadEnv, need } from "@btb/shared/env";
import { weekIdAt } from "@btb/shared/schedule";
import { sendPost, type PostKind } from "./posts";

loadEnv();
const kind = process.argv[2] as PostKind;
const args = process.argv.slice(3);
if (!["entries-open", "one-hour-left", "results"].includes(kind)) {
  console.error("usage: broadcast.ts entries-open|one-hour-left|results [--week N] [--force]");
  process.exit(2);
}
const week = args.includes("--week") ? Number(args[args.indexOf("--week") + 1]) : Math.max(1, weekIdAt(Math.floor(Date.now() / 1000)));
const r = await sendPost(await getDb(), kind, week, {
  site: process.env.NEXT_PUBLIC_SITE_URL ?? "",
  token: need("TELEGRAM_BOT_TOKEN"),
  group: need("TELEGRAM_GROUP_CHAT_ID"),
  waitMaxMs: 2 * 3600_000,
  force: args.includes("--force"),
});
console.log(`${kind} week ${week}: ${r}`);
process.exit(0);
