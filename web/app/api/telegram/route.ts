import { webhookCallback } from "grammy";
import { createBot } from "@btb/telegram";
import { db } from "@/lib/data";

let handler: ((req: Request) => Promise<Response>) | null = null;

/** Telegram webhook. Set it once with: pnpm admin telegram-webhook (sends the secret token header). */
export async function POST(req: Request) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return new Response("not configured", { status: 503 });
  if (req.headers.get("x-telegram-bot-api-secret-token") !== process.env.TELEGRAM_WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
  handler ??= webhookCallback(createBot(token, await db(), process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin), "std/http");
  return handler(req);
}
