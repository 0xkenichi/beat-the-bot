import { db } from "@/lib/data";
import { weeklyMetrics } from "@btb/shared/metrics";

/** The numbers the grant form asks for, computed from the indexed data. */
export async function GET() {
  return Response.json(await weeklyMetrics(await db()), { headers: { "cache-control": "public, max-age=300" } });
}
