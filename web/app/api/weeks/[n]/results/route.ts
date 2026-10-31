import { db } from "@/lib/data";
import { canonicalJson } from "@btb/shared/scoring";

/** The published results file. keccak256 of exactly these bytes is the resultsHash passed to PrizePool.settle. */
export async function GET(_req: Request, { params }: { params: Promise<{ n: string }> }) {
  const n = Number((await params).n);
  const [w] = await (await db()).query<{ results: unknown; results_hash: string | null }>("select results, results_hash from weeks where week = $1", [n]);
  if (!w?.results) return Response.json({ error: "not scored yet" }, { status: 404 });
  return new Response(canonicalJson(w.results), {
    headers: { "content-type": "application/json", "x-results-hash": w.results_hash ?? "", "cache-control": "public, max-age=300" },
  });
}
