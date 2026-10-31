import { Bot, type Context } from "grammy";
import type { Db } from "@btb/shared/db";
import { weekTable } from "@btb/shared/league";
import { pct } from "@btb/shared/scoring";
import { weekIdAt, weekSchedule, watDateTime } from "@btb/shared/schedule";
import { PCM } from "./pidgin";

const EN: Record<string, string> = {
  start:
    "Welcome to Beat the Bot: pick real stocks on Base and try to beat three AI bots, every week.\n\n" +
    "/trade buy stocks with USDC (from $1)\n/pick free play, no money needed\n/table this week's table\n/bots how the bots are doing\n/week this week's times\n/link connect your wallet (needed for prizes)",
  link_usage: "Open the site, tap Link Telegram, and the bot links you in one tap. Or send /link followed by your code.",
  link_bad: "That code didn't work. Codes are single-use and last 24 hours: get a fresh one on the site.",
  link_wallet_taken: "That wallet is already linked to another Telegram account. One wallet, one account.",
  link_tg_taken: "Your Telegram account is already linked to another wallet. One account, one wallet.",
  linked: "Linked. Your wallet {wallet} is now eligible for prizes.",
  lang_pcm: "Okay, Pidgin from now on.",
  lang_en: "Okay, English from now on.",
};

async function langOf(db: Db, telegramId: number): Promise<"en" | "pcm"> {
  const [p] = await db.query<{ lang: string }>("select lang from players where telegram_id = $1", [telegramId]);
  return p?.lang === "pcm" ? "pcm" : "en";
}
const say = (lang: "en" | "pcm", key: string, vars: Record<string, string> = {}) =>
  ((lang === "pcm" ? PCM[key] : undefined) ?? EN[key] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");

/** Links a Telegram account to a wallet with a one-time code. Enforces one each way. */
export async function linkWallet(db: Db, code: string, telegramId: number, username?: string): Promise<{ ok: true; wallet: string } | { ok: false; reason: "bad" | "wallet_taken" | "tg_taken" }> {
  const [c] = await db.query<{ wallet: string }>(
    "select wallet from link_codes where code = $1 and used_at is null and created_at > now() - interval '24 hours'",
    [code.trim().toUpperCase()],
  );
  if (!c) return { ok: false, reason: "bad" };
  const [byWallet] = await db.query<{ telegram_id: string | null }>("select telegram_id from players where wallet = $1", [c.wallet]);
  if (byWallet?.telegram_id && Number(byWallet.telegram_id) !== telegramId) return { ok: false, reason: "wallet_taken" };
  const [byTg] = await db.query<{ wallet: string }>("select wallet from players where telegram_id = $1", [telegramId]);
  if (byTg && byTg.wallet !== c.wallet) return { ok: false, reason: "tg_taken" };
  await db.query("update players set telegram_id = $2, telegram_username = $3 where wallet = $1", [c.wallet, telegramId, username ?? null]);
  await db.query("update link_codes set used_at = now() where code = $1", [code.trim().toUpperCase()]);
  return { ok: true, wallet: c.wallet };
}

export function createBot(token: string, db: Db, site: string) {
  const bot = new Bot(token);

  const doLink = async (ctx: Context, code: string) => {
    const from = ctx.from;
    if (!from) return;
    const lang = await langOf(db, from.id);
    if (!code) return ctx.reply(say(lang, "link_usage"));
    const r = await linkWallet(db, code, from.id, from.username);
    if (r.ok) return ctx.reply(say(lang, "linked", { wallet: `${r.wallet.slice(0, 6)}…${r.wallet.slice(-4)}` }));
    return ctx.reply(say(lang, r.reason === "bad" ? "link_bad" : r.reason === "wallet_taken" ? "link_wallet_taken" : "link_tg_taken"));
  };

  bot.command("start", async (ctx) => {
    const payload = ctx.match?.trim() ?? "";
    if (payload.startsWith("link-")) return doLink(ctx, payload.slice(5));
    return ctx.reply(say(await langOf(db, ctx.from!.id), "start"), { link_preview_options: { is_disabled: true } });
  });
  bot.command("link", (ctx) => doLink(ctx, ctx.match?.trim() ?? ""));
  bot.command("trade", (ctx) => ctx.reply(`Buy stocks from $1, straight into your own wallet: ${site}/trade`));
  bot.command("pick", (ctx) => ctx.reply(`Free play: pick three stocks, locked onchain, no money needed: ${site}/play`));
  bot.command("week", async (ctx) => {
    const s = weekSchedule(Math.max(1, weekIdAt(Math.floor(Date.now() / 1000))));
    return ctx.reply(`Week ${s.weekId}\nEntries close: ${watDateTime(s.entryClose)}\nScored: ${watDateTime(s.scoreAt)}\nResults here: ${watDateTime(s.resultsAt)}`);
  });
  bot.command("bots", async (ctx) => {
    const t = await weekTable(db);
    if (!t.bots.length) return ctx.reply(`No bot trades yet this week. Every trade is public: ${site}/agents`);
    return ctx.reply(`This week:\n${t.bots.map((b) => `${b.name} ${pct(b.ret, 2)}`).join("\n")}\n\n${site}/agents`);
  });
  bot.command("table", async (ctx) => {
    const t = await weekTable(db);
    const block = (title: string, rows: typeof t.real) => rows.length ? `${title}\n${rows.slice(0, 5).map((r) => `${r.rank}. ${r.name} ${pct(r.ret, 2)}${r.beatTheBot ? " (beat the bot)" : ""}`).join("\n")}` : "";
    const text = [`Week ${t.weekId}`, block("Bots", t.bots), block("Real money", t.real), block("Free play", t.paper)].filter(Boolean).join("\n\n");
    return ctx.reply(`${text}\n\n${site}`, { link_preview_options: { is_disabled: true } });
  });
  bot.command("pidgin", async (ctx) => {
    await db.query("update players set lang = 'pcm' where telegram_id = $1", [ctx.from!.id]);
    return ctx.reply(say("pcm", "lang_pcm"));
  });
  bot.command("english", async (ctx) => {
    await db.query("update players set lang = 'en' where telegram_id = $1", [ctx.from!.id]);
    return ctx.reply(say("en", "lang_en"));
  });
  bot.catch((err) => console.error("telegram error", err.error));
  return bot;
}
