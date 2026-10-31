import type { Hex } from "viem";
import { client, db } from "@/lib/data";
import { getSession } from "@/lib/session";
import { parseSwaps, userOpCallData } from "@btb/shared/userop";
import { hasBuilderCode } from "@btb/shared/builderCode";
import { builderCodeFromConfig } from "@btb/shared/config";

/** Records a player's swap from its receipt (amounts come from the chain, not from the browser). */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return Response.json({ error: "Please sign in" }, { status: 401 });
  const { txHash } = (await req.json().catch(() => ({}))) as { txHash?: string };
  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) return Response.json({ error: "txHash required" }, { status: 400 });
  const c = client();
  const receipt = await c.waitForTransactionReceipt({ hash: txHash as Hex, timeout: 30_000 });
  const tx = await c.getTransaction({ hash: txHash as Hex });
  const callData = userOpCallData(tx.input, s.wallet) ?? tx.input;
  const code = builderCodeFromConfig();
  const attributed = !!code && hasBuilderCode(callData, code);
  const swaps = parseSwaps(receipt, s.wallet);
  const d = await db();
  for (const sw of swaps) {
    await d.query(
      `insert into trades (tx_hash, wallet, kind, side, token, amount_in, amount_out, usdc_raw, block, builder_code, status)
       values ($1, $2, 'user', $3, $4, $5, $6, $7, $8, $9, $10) on conflict do nothing`,
      [txHash, s.wallet.toLowerCase(), sw.side, sw.token, (sw.side === "buy" ? sw.usdc : sw.tokenAmount).toString(), (sw.side === "buy" ? sw.tokenAmount : sw.usdc).toString(), sw.usdc.toString(), receipt.blockNumber.toString(), attributed, receipt.status === "success" ? "confirmed" : "reverted"],
    );
  }
  return Response.json({ ok: true, swaps: swaps.length, builderCode: attributed });
}
