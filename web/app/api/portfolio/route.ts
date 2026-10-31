import { client } from "@/lib/data";
import { getSession } from "@/lib/session";
import { valueWallet } from "@btb/shared/wallet";

export async function GET() {
  const s = await getSession();
  if (!s) return Response.json({ error: "Please sign in" }, { status: 401 });
  const v = await valueWallet(client(), s.wallet);
  return Response.json(
    {
      wallet: s.wallet,
      usdc: Number(v.usdcRaw) / 1e6,
      navUsd: v.navUsd,
      block: v.block.toString(),
      holdings: v.holdings.filter((h) => h.raw !== "0").map((h) => ({ token: h.token, ticker: h.ticker, raw: h.raw, valueUsd: h.valueUsd })),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
