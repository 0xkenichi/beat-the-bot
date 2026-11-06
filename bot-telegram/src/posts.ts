import { Bot } from "grammy";
import type { Db } from "@btb/shared/db";
import { weekTable } from "@btb/shared/league";
import { EN, personalMessage, resultsMessage } from "@btb/shared/messages";
import { pct } from "@btb/shared/scoring";
import { weekSchedule } from "@btb/shared/schedule";
import { botsMode, contractsChainId } from "@btb/shared/config";
import { PCM } from "./pidgin";

export type PostKind = "entries-open" | "one-hour-left" | "results";

/** When each post goes out, for a given week. */
export function postTime(kind: PostKind, week: number) {
  const s = weekSchedule(week);
  return kind === "entries-open" ? s.entriesOpenPostAt : kind === "one-hour-left" ? s.reminderAt : s.resultsAt;
}

/** Sends one scheduled post (once per week), waiting until its exact minute if it is close. */
export async function sendPost(db: Db, kind: PostKind, week: number, opts: { site: string; token: string; group: string; waitMaxMs?: number; maxLateMs?: number; force?: boolean }) {
  const key = `broadcast:${kind}:${week}`;
  const [done] = await db.query("select 1 from kv where key = $1", [key]);
  if (done && !opts.force) return "already sent";
  const at = postTime(kind, week);
  const ms = at * 1000 - Date.now();
  if (ms > (opts.waitMaxMs ?? 20 * 60_000)) return `not due (${Math.round(ms / 60_000)} min)`;
  if (!opts.force && -ms > (opts.maxLateMs ?? 3 * 3600_000)) return "too late, skipped";
  if (kind === "results") {
    const t = await weekTable(db, week);
    if (t.phase !== "final") return "results not published yet";
  }
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  const bot = new Bot(opts.token);
  if (kind === "entries-open") {
    const last = week > 1 ? await weekTable(db, week - 1).catch(() => null) : null;
    const botsLine = last?.bots.length ? `Last week: ${last.bots.map((b) => `${b.name} ${pct(b.ret, 1)}`).join(", ")}.` : botsMode() === "picks" ? "Three AI bots pick real stocks every week, in public." : "Three AI bots are trading real stocks on Base.";
    await bot.api.sendMessage(opts.group, PCM.entriesOpen ?? `${EN.entriesOpen(week, weekSchedule(week).entryClose, botsLine)}\n\n${opts.site}`);
  } else if (kind === "one-hour-left") {
    await bot.api.sendMessage(opts.group, PCM.oneHourLeft ?? `${EN.oneHourLeft(week)}\n\n${opts.site}/play`);
  } else {
    const t = await weekTable(db, week);
    await bot.api.sendMessage(opts.group, resultsMessage(t, opts.site), { link_preview_options: { is_disabled: true } });
    const players = await db.query<{ wallet: string; telegram_id: string }>("select wallet, telegram_id from players where telegram_id is not null and dm_opt_in");
    const [w] = await db.query<{ results: { winners?: { wallet: string; prizeText: string }[] } | null; settle_txs: { tx: string }[] | null }>("select results, settle_txs from weeks where week = $1", [week]);
    for (const p of players) {
      const me = [...t.real, ...t.paper].find((r) => r.wallet.toLowerCase() === p.wallet);
      if (!me) continue;
      const win = w?.results?.winners?.find((x) => x.wallet.toLowerCase() === p.wallet);
      await bot.api
        .sendMessage(Number(p.telegram_id), personalMessage(t, me, win ? { text: win.prizeText, tx: w?.settle_txs?.[0]?.tx, chainId: contractsChainId() } : undefined, opts.site))
        .catch((e) => console.log(`DM failed: ${(e as Error).message}`));
    }
  }
  await db.query("insert into kv (key, value) values ($1, 'true'::jsonb) on conflict (key) do update set value = excluded.value, updated_at = now()", [key]);
  return "sent";
}
