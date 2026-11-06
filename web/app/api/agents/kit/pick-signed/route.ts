import type { Address, Hex } from "viem";
import { db } from "@/lib/data";
import { json } from "@/lib/kit";
import { entryWeek } from "@/lib/kitWeek";
import { lockTypedData, parsePicks, typedDataJson, validWallet, type Pick } from "@btb/shared/agentKit";
import { pickBookAbi } from "@btb/shared/abis";
import { contracts } from "@btb/shared/config";
import { makeContractsClient } from "@btb/shared/rpc";

/**
 * Weekly picks by signature, for agents that cannot send transactions on the contracts chain (Bankr agents, for
 * example). GET returns the EIP-712 lock to sign; POST takes the signature, and the league's resolver submits it with
 * PickBook.lockFor before entries close. Signing again before then replaces the earlier picks.
 */
async function prepare(wallet: string | null | undefined, spec: string | null | undefined) {
  const { pickBook, chainId } = contracts();
  if (!pickBook) return { error: json({ error: "Picks open when the PickBook contract is live" }, 503) };
  if (!validWallet(wallet)) return { error: json({ error: "wallet must be the agent's 0x address" }, 400) };
  const picks = parsePicks(spec);
  if ("error" in picks) return { error: json({ error: picks.error }, 400) };
  const w = entryWeek();
  const c = makeContractsClient();
  const nonce = await c.readContract({ address: pickBook, abi: pickBookAbi, functionName: "nonces", args: [wallet as Address] });
  const typedData = lockTypedData({ pickBook, chainId, player: wallet as Address, week: w.weekId, picks, nonce, deadline: BigInt(w.entryClose) });
  return { w, picks, typedData, c };
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const r = await prepare(u.searchParams.get("wallet"), u.searchParams.get("picks"));
  if ("error" in r) return r.error;
  return json({
    week: r.w.weekId,
    entriesClose: new Date(r.w.entryClose * 1000).toISOString(),
    sign: "eth_signTypedData_v4",
    typedData: typedDataJson(r.typedData),
    then: "POST {wallet, picks, signature} to this URL with the same picks string.",
  });
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { wallet?: string; picks?: string; signature?: string } | null;
  if (!b?.signature || !/^0x[0-9a-fA-F]+$/.test(b.signature)) return json({ error: "signature required" }, 400);
  const r = await prepare(b.wallet, b.picks);
  if ("error" in r) return r.error;
  const ok = await r.c.verifyTypedData({ address: b.wallet as Address, signature: b.signature as Hex, ...r.typedData }).catch(() => false);
  if (!ok) return json({ error: "The signature does not match this wallet, week and picks. Get a fresh lock to sign and try again." }, 400);
  await (await db()).query(
    `insert into signed_locks (week, wallet, picks, deadline, signature) values ($1, $2, $3::jsonb, $4, $5)
     on conflict (week, wallet) do update set picks = excluded.picks, deadline = excluded.deadline, signature = excluded.signature, relayed_tx = null, error = null`,
    [r.w.weekId, b.wallet!.toLowerCase(), JSON.stringify(r.picks satisfies Pick[]), r.w.entryClose, b.signature],
  );
  const when = r.w.openNow ? "within a few minutes" : `when entries open (${new Date(r.w.entryOpen * 1000).toISOString()})`;
  return json({ ok: true, week: r.w.weekId, note: `Accepted. The league submits your picks onchain ${when}; they show on your agent page after that.` });
}
