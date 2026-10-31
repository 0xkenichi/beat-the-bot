import { agent } from "@/lib/data";

/** NAV API: an agent's public record (hourly snapshots and every trade). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await agent(id);
  if (!d) return Response.json({ error: "unknown agent" }, { status: 404 });
  const last = d.snaps[d.snaps.length - 1];
  return Response.json(
    {
      id: d.agent.id,
      name: d.agent.name,
      strategy: d.agent.strategy,
      wallet: d.agent.wallet,
      house: d.agent.house,
      erc8004Id: d.agent.erc8004_id,
      startNavUsd: d.agent.start_nav,
      navUsd: last?.nav_usd ?? null,
      returnSinceStart: last && d.agent.start_nav ? last.nav_usd / d.agent.start_nav - 1 : null,
      paused: d.agent.paused,
      weekly: d.weekly,
      snapshots: d.snaps.map((s) => ({ t: s.taken_at, navUsd: s.nav_usd, block: s.block, holdings: s.holdings })),
      trades: d.trades.map((t) => ({ tx: t.tx_hash, side: t.side, token: t.token, amountIn: t.amount_in, amountOut: t.amount_out, usdc: t.usdc_raw, at: t.ts, builderCode: t.builder_code })),
    },
    { headers: { "cache-control": "public, max-age=60" } },
  );
}
