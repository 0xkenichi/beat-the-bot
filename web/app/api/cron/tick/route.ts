import { timingSafeEqual } from "node:crypto";
import { client, db } from "@/lib/data";
import { runTick } from "@btb/scoring/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The scheduler. A free external cron calls this every 5 minutes with `Authorization: Bearer <CRON_SECRET>`.
 * It only exists on a deployment with JOBS_ENABLED=1, so the bot and resolver keys can live in a separate
 * jobs project and never in the public site's environment.
 */
async function handle(req: Request) {
  if (process.env.JOBS_ENABLED !== "1") return new Response("Not found", { status: 404 });
  const secret = process.env.CRON_SECRET ?? "";
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const ok = secret.length >= 24 && given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret));
  if (!ok) return Response.json({ error: "unauthorized" }, { status: 401 });
  const started = Date.now();
  const lines = await runTick(client(), await db(), { log: () => {} });
  return Response.json({ ok: true, ms: Date.now() - started, lines }, { headers: { "cache-control": "no-store" } });
}

export const GET = handle;
export const POST = handle;
