import { table } from "@/lib/data";
import { frame, OG, pctTxt, Badge } from "@/lib/og";
import { weekIdAt } from "@btb/shared/schedule";
import { botsMode } from "@btb/shared/config";

/** Share card for a week: the bots, and the humans who beat them. /api/og/week/current works too. */
export async function GET(_req: Request, { params }: { params: Promise<{ n: string }> }) {
  const raw = (await params).n;
  const n = raw === "current" ? Math.max(1, weekIdAt(Math.floor(Date.now() / 1000))) : Number(raw);
  if (!Number.isInteger(n) || n < 1) return new Response("bad week", { status: 400 });
  const t = await table(n);
  const humans = [...t.real, ...t.paper].sort((a, b) => b.ret - a.ret).slice(0, 3);
  const beat = [...t.real, ...t.paper].filter((r) => r.beatTheBot).length;
  const status = t.phase === "final" ? "Final" : t.phase === "upcoming" ? "Opens Monday" : t.phase === "entries-open" ? "Entries open" : "Live";
  return frame(
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 20 }}>
        <span style={{ fontSize: 64, fontWeight: 800 }}>Week {n}</span>
        <span style={{ fontSize: 30, color: OG.muted }}>{status}</span>
      </div>
      <div style={{ display: "flex", gap: 40, marginTop: 28 }}>
        <div style={{ display: "flex", flexDirection: "column", width: 500, gap: 12 }}>
          <span style={{ fontSize: 26, color: OG.muted }}>The bots</span>
          {t.bots.length ? t.bots.slice(0, 3).map((b) => (
            <div key={b.wallet} style={{ display: "flex", justifyContent: "space-between", background: OG.card, border: "1px solid #e6e6ea", borderRadius: 14, padding: "12px 20px" }}>
              <span>{b.name}</span><span style={{ color: b.ret >= 0 ? OG.up : OG.down }}>{pctTxt(b.ret)}</span>
            </div>
          )) : <span style={{ color: OG.muted }}>{botsMode() === "picks" ? "Three AI bots pick every Monday." : "Three AI bots, real money, real trades."}</span>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", width: 520, gap: 12 }}>
          <span style={{ fontSize: 26, color: OG.muted }}>{beat ? `${beat} ${beat === 1 ? "human" : "humans"} beat the bots` : "The humans"}</span>
          {humans.length ? humans.map((h) => (
            <div key={h.wallet} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: OG.card, border: "1px solid #e6e6ea", borderRadius: 14, padding: "12px 20px" }}>
              <span style={{ display: "flex", alignItems: "center" }}>{h.name}{h.beatTheBot ? <Badge text="BEAT THE BOT" /> : null}</span>
              <span style={{ color: h.ret >= 0 ? OG.up : OG.down }}>{pctTxt(h.ret)}</span>
            </div>
          )) : <span style={{ color: OG.muted }}>Pick three stocks. Try to beat them.</span>}
        </div>
      </div>
    </div>,
  );
}
