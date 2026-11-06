import type { Address } from "viem";
import { client } from "@/lib/data";
import { json, requireCode } from "@/lib/kit";
import { tradeTxs, validWallet } from "@btb/shared/agentKit";
import { tokenByTicker } from "@btb/shared/universe";
import { canHold } from "@btb/shared/b20";
import { erc20Abi } from "@btb/shared/abis";
import { ADDR } from "@btb/shared/chain";

/** Step 3: exact-quoted swaps for an agent's own wallet. Buys spend USDC; sells take a fraction of the holding. */
export async function GET(req: Request) {
  const code = requireCode();
  if (code instanceof Response) return code;
  const u = new URL(req.url);
  const wallet = u.searchParams.get("wallet");
  const side = u.searchParams.get("side");
  const token = tokenByTicker(u.searchParams.get("ticker") ?? "");
  if (!validWallet(wallet)) return json({ error: "wallet must be the agent's 0x address" }, 400);
  if (side !== "buy" && side !== "sell") return json({ error: "side must be buy or sell" }, 400);
  if (!token) return json({ error: "ticker must be one of the league's stocks (see /api/agents/kit)" }, 400);
  const c = client();
  if (!(await canHold(c, token.address, wallet as Address))) return json({ error: `${token.symbol}'s transfer policy does not allow this wallet` }, 400);
  let amountIn: bigint;
  if (side === "buy") {
    const usd = Number(u.searchParams.get("usd"));
    if (!Number.isFinite(usd) || usd < 1 || usd > 10_000) return json({ error: "usd must be between 1 and 10000" }, 400);
    amountIn = BigInt(Math.round(usd * 1e6));
    const bal = await c.readContract({ address: ADDR.USDC, abi: erc20Abi, functionName: "balanceOf", args: [wallet as Address] });
    if (bal < amountIn) return json({ error: `The wallet holds $${(Number(bal) / 1e6).toFixed(2)} of USDC on Base` }, 400);
  } else {
    const fraction = Number(u.searchParams.get("fraction") ?? "1");
    if (!(fraction > 0 && fraction <= 1)) return json({ error: "fraction must be above 0 and at most 1" }, 400);
    const bal = await c.readContract({ address: token.address, abi: erc20Abi, functionName: "balanceOf", args: [wallet as Address] });
    amountIn = fraction === 1 ? bal : (bal * BigInt(Math.round(fraction * 1e6))) / 1_000_000n;
    if (amountIn === 0n) return json({ error: `The wallet holds no ${token.symbol}` }, 400);
  }
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
  return json({ wallet, ticker: token.ticker, ...(await tradeTxs(c, token, side, amountIn, wallet as Address, code, deadline)), note: "Send the transactions in order within 20 minutes." });
}
