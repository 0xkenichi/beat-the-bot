// Long-polling runner (Railway or local). On Vercel the webhook route /api/telegram is used instead.
import { getDb, migrate } from "@btb/shared/db";
import { loadEnv, need } from "@btb/shared/env";
import { createBot } from "./bot";

loadEnv();
const db = await getDb();
await migrate(db);
const bot = createBot(need("TELEGRAM_BOT_TOKEN"), db, process.env.NEXT_PUBLIC_SITE_URL ?? "https://beatthebot.example");
await bot.api.deleteWebhook();
console.log("Telegram bot polling");
await bot.start();
