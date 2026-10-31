import { parseEventLogs, type Hex } from "viem";
import { client, db } from "@/lib/data";
import { getSession } from "@/lib/session";
import { pickBookAbi } from "@btb/shared/abis";
import { contracts } from "@btb/shared/config";

/** Stores a paper lock from its Locked event (the indexer also picks it up on its next run). */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return Response.json({ error: "Please sign in" }, { status: 401 });
  const { txHash } = (await req.json().catch(() => ({}))) as { txHash?: string };
  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) return Response.json({ error: "txHash required" }, { status: 400 });
  const pickBook = contracts().pickBook;
  const receipt = await client().waitForTransactionReceipt({ hash: txHash as Hex, timeout: 30_000 });
  const block = await client().getBlock({ blockNumber: receipt.blockNumber });
  const events = parseEventLogs({ abi: pickBookAbi, logs: receipt.logs, eventName: "Locked" }).filter((e) => e.address.toLowerCase() === pickBook?.toLowerCase());
  const d = await db();
  for (const e of events) {
    const picks = e.args.tokenIndexes.map((ti, i) => ({ tokenIndex: Number(ti), weightBps: Number(e.args.weightsBps[i]) }));
    await d.query(
      `insert into paper_locks (week, wallet, picks, picks_hash, locked_at, tx_hash, block) values ($1, $2, $3::jsonb, $4, $5, $6, $7)
       on conflict (week, wallet) do update set picks = excluded.picks, picks_hash = excluded.picks_hash, locked_at = excluded.locked_at, tx_hash = excluded.tx_hash, block = excluded.block
       where paper_locks.block <= excluded.block`,
      [e.args.weekId, e.args.player.toLowerCase(), JSON.stringify(picks), e.args.picksHash, Number(block.timestamp), txHash, receipt.blockNumber.toString()],
    );
  }
  return Response.json({ ok: true, locks: events.length });
}
