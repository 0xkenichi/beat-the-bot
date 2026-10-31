import { randomBytes } from "node:crypto";
import { db } from "@/lib/data";
import { getSession } from "@/lib/session";

/** One-time code that links this wallet to one Telegram account (prize eligibility: one each way). */
export async function POST() {
  const s = await getSession();
  if (!s) return Response.json({ error: "Please sign in" }, { status: 401 });
  const code = randomBytes(4).toString("hex").toUpperCase();
  await (await db()).query("insert into link_codes (code, wallet) values ($1, $2)", [code, s.wallet.toLowerCase()]);
  const bot = process.env.TELEGRAM_BOT_USERNAME ?? "BeatTheBotLeagueBot";
  return Response.json({ code, url: `https://t.me/${bot}?start=link-${code}` });
}
