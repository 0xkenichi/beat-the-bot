import { getSession } from "@/lib/session";
import { db } from "@/lib/data";

/**
 * Fallback when gas sponsorship is down: the player's wallet signs the picks (EIP-712), and the resolver submits
 * the signed locks onchain with PickBook.lockFor in a batch before entries close.
 */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return Response.json({ error: "Please sign in" }, { status: 401 });
  const b = (await req.json().catch(() => null)) as { week?: number; picks?: { tokenIndex: number; weightBps: number }[]; deadline?: number; signature?: string } | null;
  if (!b?.week || !b.picks || b.picks.length !== 3 || !b.deadline || !b.signature?.startsWith("0x")) return Response.json({ error: "Bad signed lock" }, { status: 400 });
  await (await db()).query(
    `insert into signed_locks (week, wallet, picks, deadline, signature) values ($1, $2, $3::jsonb, $4, $5)
     on conflict (week, wallet) do update set picks = excluded.picks, deadline = excluded.deadline, signature = excluded.signature, relayed_tx = null, error = null`,
    [b.week, s.wallet.toLowerCase(), JSON.stringify(b.picks), b.deadline, b.signature],
  );
  return Response.json({ ok: true, note: "Saved. Your picks go onchain in the next batch, before entries close." });
}
