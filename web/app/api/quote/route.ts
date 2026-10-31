import { isAddress, type Address } from "viem";
import { client, tradeMode } from "@/lib/data";
import { getSession } from "@/lib/session";
import { tokenByAddress } from "@btb/shared/universe";
import { buildSwapCalls, quote, SOFT_CAP_USDC } from "@btb/shared/swap";
import { canHold } from "@btb/shared/b20";
import { valueWallet } from "@btb/shared/wallet";
import { erc20Abi } from "@btb/shared/abis";

const fmt = (raw: bigint, dec: number, dp = 6) => (Number(raw) / 10 ** dec).toFixed(dp).replace(/\.?0+$/, "");

/**
 * Quotes a buy (USDC split across up to three stocks) or a sell (half or all of one holding) and returns the
 * exact calls for the player's own wallet: approve, then swap with a 1% minimum-output floor.
 */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return Response.json({ error: "Please sign in" }, { status: 401 });
  const url = new URL(req.url);
  const side = url.searchParams.get("side");
  const c = client();
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);

  if (side === "buy") {
    if ((await tradeMode()) !== "live") return Response.json({ error: "Buying is paused. Selling still works." }, { status: 403 });
    const amount = Number(url.searchParams.get("amount"));
    const tokens = (url.searchParams.get("tokens") ?? "").split(",").filter(Boolean);
    if (!Number.isFinite(amount) || amount < 1) return Response.json({ error: "The smallest buy is $1" }, { status: 400 });
    if (tokens.length < 1 || tokens.length > 3 || new Set(tokens).size !== tokens.length) return Response.json({ error: "Pick one to three different stocks" }, { status: 400 });
    const list = tokens.map((a) => (isAddress(a) ? tokenByAddress(a) : undefined));
    if (list.some((t) => !t)) return Response.json({ error: "Unknown stock" }, { status: 400 });

    const total = BigInt(Math.round(amount * 1e6));
    const v = await valueWallet(c, s.wallet);
    if (v.usdcRaw < total) return Response.json({ error: `You have $${(Number(v.usdcRaw) / 1e6).toFixed(2)} of USDC. Add USDC first.` }, { status: 400 });
    const stocksNow = BigInt(Math.round(v.holdings.reduce((a, h) => a + h.valueUsd, 0) * 1e6));
    if (stocksNow + total > SOFT_CAP_USDC) return Response.json({ error: "The league is for small, fun positions: up to $100 of stocks per wallet." }, { status: 400 });

    const each = total / BigInt(list.length);
    const lines = [];
    const calls = [];
    for (const [i, t] of list.entries()) {
      if (!(await canHold(c, t!.address, s.wallet))) return Response.json({ error: `${t!.ticker} can't be held by this wallet right now` }, { status: 400 });
      const amt = i === list.length - 1 ? total - each * BigInt(list.length - 1) : each;
      const q = await quote(c, t!, "buy", amt);
      lines.push({ ticker: t!.ticker, symbol: t!.symbol, youGet: fmt(q.amountOut, 8), minOut: fmt(q.minAmountOut, 8), usd: Number(amt) / 1e6 });
      calls.push(...buildSwapCalls(q, s.wallet, deadline));
    }
    return Response.json({ side: "buy", usd: amount, lines, calls: calls.map((x) => ({ to: x.to, data: x.data, value: "0x0" })) });
  }

  if (side === "sell") {
    // Selling is never blocked by the kill switch: people must always be able to get out.
    const token = url.searchParams.get("token") ?? "";
    const fraction = Number(url.searchParams.get("fraction"));
    const t = isAddress(token) ? tokenByAddress(token) : undefined;
    if (!t) return Response.json({ error: "Unknown stock" }, { status: 400 });
    if (fraction !== 0.5 && fraction !== 1) return Response.json({ error: "Sell half or all" }, { status: 400 });
    const bal = await c.readContract({ address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [s.wallet as Address] });
    const amt = fraction === 1 ? bal : bal / 2n;
    if (amt === 0n) return Response.json({ error: `You hold no ${t.ticker}` }, { status: 400 });
    const q = await quote(c, t, "sell", amt);
    return Response.json({
      side: "sell",
      usd: Number(q.amountOut) / 1e6,
      lines: [{ ticker: t.ticker, symbol: t.symbol, youGet: fmt(q.amountOut, 6, 2), minOut: `$${fmt(q.minAmountOut, 6, 2)}`, usd: Number(q.amountOut) / 1e6 }],
      calls: buildSwapCalls(q, s.wallet, deadline).map((x) => ({ to: x.to, data: x.data, value: "0x0" })),
    });
  }
  return Response.json({ error: "side must be buy or sell" }, { status: 400 });
}
