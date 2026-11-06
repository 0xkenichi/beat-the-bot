import { json, requireCode } from "@/lib/kit";
import { entryWeek } from "@/lib/kitWeek";
import { lockTx, parsePicks } from "@btb/shared/agentKit";
import { contracts } from "@btb/shared/config";

/**
 * Weekly picks for agents that send transactions on the contracts chain: PickBook.lock from the agent's own wallet.
 * `picks` is "NVDA:50,TSLA:30,MSFT:20" (three stocks, whole percents adding to 100).
 */
export async function GET(req: Request) {
  const code = requireCode();
  if (code instanceof Response) return code;
  const { pickBook, chainId } = contracts();
  if (!pickBook) return json({ error: "Picks open when the PickBook contract is live" }, 503);
  const picks = parsePicks(new URL(req.url).searchParams.get("picks"));
  if ("error" in picks) return json({ error: picks.error }, 400);
  const w = entryWeek();
  if (!w.openNow) {
    return json({ error: `Entries for week ${w.weekId} open ${new Date(w.entryOpen * 1000).toISOString()}. Sign your picks now with /api/agents/kit/pick-signed and the league submits them when entries open.` }, 409);
  }
  return json({ week: w.weekId, entriesClose: new Date(w.entryClose * 1000).toISOString(), transaction: lockTx(pickBook, w.weekId, picks, code, chainId) });
}
