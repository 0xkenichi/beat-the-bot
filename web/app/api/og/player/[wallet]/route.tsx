import { table } from "@/lib/data";
import { frame, OG, pctTxt, Badge } from "@/lib/og";
import { validWallet } from "@btb/shared/agentKit";
import { weekIdAt } from "@btb/shared/schedule";
import { listText } from "@btb/shared/text";

/** A player's week, for sharing: "I beat Momentum and Steady." */
export async function GET(req: Request, { params }: { params: Promise<{ wallet: string }> }) {
  const wallet = (await params).wallet.toLowerCase();
  if (!validWallet(wallet)) return new Response("bad wallet", { status: 400 });
  const w = Number(new URL(req.url).searchParams.get("week") ?? Math.max(1, weekIdAt(Math.floor(Date.now() / 1000))));
  const t = await table(w);
  const me = [...t.real, ...t.paper].find((r) => r.wallet.toLowerCase() === wallet);
  if (!me) return frame(<span style={{ fontSize: 56, fontWeight: 800 }}>Week {w}: pick three stocks and try to beat the bots.</span>);
  const beaten = t.bots.filter((b) => me.ret > b.ret).map((b) => b.name);
  const headline = beaten.length === t.bots.length && t.bots.length ? "I beat all the bots" : beaten.length ? `I beat ${listText(beaten)}` : "The bots won this one";
  return frame(
    <div style={{ display: "flex", flexDirection: "column" }}>
      <span style={{ fontSize: 30, color: OG.muted }}>Week {w} · {me.tier === "real" ? "real money" : "free play"}</span>
      <div style={{ display: "flex", alignItems: "center", marginTop: 12 }}>
        <span style={{ fontSize: 76, fontWeight: 800 }}>{headline}</span>
        {me.beatTheBot ? <Badge text="BEAT THE BOT" /> : null}
      </div>
      <div style={{ display: "flex", gap: 28, marginTop: 30, fontSize: 40 }}>
        <span>{me.name}</span>
        <span style={{ color: me.ret >= 0 ? OG.up : OG.down, fontWeight: 800 }}>{pctTxt(me.ret)}</span>
        {me.picks ? <span style={{ color: OG.muted, fontSize: 32 }}>{me.picks.map((p) => `${p.ticker} ${Math.round(p.weightBps / 100)}%`).join(" · ")}</span> : null}
      </div>
      <div style={{ display: "flex", gap: 14, marginTop: 30 }}>
        {t.bots.slice(0, 3).map((b) => (
          <div key={b.wallet} style={{ display: "flex", gap: 12, background: OG.card, borderRadius: 14, padding: "10px 18px", fontSize: 28 }}>
            <span>{b.name}</span><span style={{ color: b.ret >= 0 ? OG.up : OG.down }}>{pctTxt(b.ret)}</span>
          </div>
        ))}
      </div>
    </div>,
  );
}
