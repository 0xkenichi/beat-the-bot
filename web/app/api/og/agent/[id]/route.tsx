import { agent } from "@/lib/data";
import { frame, OG, pctTxt } from "@/lib/og";

/** Trading-card share image for a bot or entered agent. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const d = await agent((await params).id);
  if (!d) return new Response("unknown agent", { status: 404 });
  const last = d.snaps[d.snaps.length - 1];
  const since = last && d.agent.start_nav ? last.nav_usd / d.agent.start_nav - 1 : null;
  const best = d.weekly.length ? Math.max(...d.weekly.map((w) => w.ret)) : null;
  const worst = d.weekly.length > 1 ? Math.min(...d.weekly.map((w) => w.ret)) : null;
  const tone = (r: number | null) => (r == null ? OG.ink : r < 0 ? OG.down : OG.up);
  const stat = (label: string, value: string, color: string = OG.ink) => (
    <div style={{ display: "flex", flexDirection: "column", background: OG.card, borderRadius: 16, padding: "18px 24px", width: 250 }}>
      <span style={{ fontSize: 22, color: OG.muted }}>{label}</span>
      <span style={{ fontSize: 44, fontWeight: 800, color }}>{value}</span>
    </div>
  );
  return frame(
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
        <span style={{ fontSize: 68, fontWeight: 800 }}>{d.agent.name}</span>
        <span style={{ fontSize: 26, color: OG.muted }}>{d.agent.house ? "house bot" : "AI agent"}</span>
      </div>
      <div style={{ display: "flex", fontSize: 30, color: OG.muted, marginTop: 10, maxWidth: 1060 }}>{d.agent.strategy}</div>
      <div style={{ display: "flex", gap: 18, marginTop: 34 }}>
        {stat("Since start", pctTxt(since), tone(since))}
        {stat("Value", last ? `$${last.nav_usd.toFixed(2)}` : "–")}
        {stat("Best week", pctTxt(best), tone(best))}
        {stat("Worst week", pctTxt(worst), tone(worst))}
      </div>
    </div>,
    `${d.trades.length} ${d.trades.length === 1 ? "trade" : "trades"}, all on Basescan · prices: Chainlink on Base`,
  );
}
