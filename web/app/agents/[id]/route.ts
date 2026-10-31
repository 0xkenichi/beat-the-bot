import { agent, db } from "@/lib/data";
import { getLang } from "@/lib/lang";
import { kvGet } from "@btb/shared/db";
import { html } from "@/lib/html";
import { page } from "@/views/layout";
import { proof, spark } from "@/views/parts";
import { pct, usd, shares } from "@/lib/format";
import { tokenByAddress } from "@btb/shared/universe";
import { ADDR } from "@btb/shared/chain";
import { DEPLOYMENTS } from "@btb/shared/config";
import { weekIdAt, watDateTime } from "@btb/shared/schedule";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lang = await getLang();
  const data = await agent(id);
  if (!data) return page({ lang, path: "/agents", status: 404, title: "Not found", body: html`<h1>No such bot</h1><p><a href="/agents">All bots</a></p>` });
  const { agent: a, snaps, trades, weekly } = data;
  const last = snaps[snaps.length - 1];
  const since = last && a.start_nav ? last.nav_usd / a.start_nav - 1 : null;
  const best = weekly.length ? weekly.reduce((x, y) => (y.ret > x.ret ? y : x)) : null;
  const worst = weekly.length ? weekly.reduce((x, y) => (y.ret < x.ret ? y : x)) : null;
  const note = await kvGet<{ source: string; note: string } | null>(await db(), `bot_note:${a.id}:${weekIdAt(Math.floor(Date.now() / 1000))}`, null);
  const identity = DEPLOYMENTS.agentIdentities[a.id];
  return page({
    lang,
    path: "/agents",
    title: a.name,
    description: a.strategy,
    body: html`<h1>${a.name}</h1>
<p style="font-size:1.05rem">${a.strategy}</p>
${a.paused ? html`<p class="notice">Paused: ${a.paused_reason}</p>` : ""}
<section class="card"><div class="grid2">
<div><div class="small muted">Return since start</div><div class="stat ${since != null && since < 0 ? "down" : "up"}">${pct(since)}</div>${a.start_nav != null ? html`<div class="small muted">from ${usd(a.start_nav)} on ${a.started_at ? new Date(a.started_at).toISOString().slice(0, 10) : "–"}</div>` : ""}</div>
<div><div class="small muted">Value now</div><div class="stat">${last ? usd(last.nav_usd) : "–"}</div><div class="small muted">wallet ${proof({ address: a.wallet })}</div></div>
<div><div class="small muted">Best week</div><div>${best ? html`<b class="up">${pct(best.ret, 2)}</b> (week ${best.week})` : "No scored weeks yet"}</div></div>
<div><div class="small muted">Worst week</div><div>${worst ? html`<b class="down">${pct(worst.ret, 2)}</b> (week ${worst.week})` : "No scored weeks yet"}</div></div>
</div><div style="margin-top:12px">${spark(snaps.map((s) => ({ t: new Date(s.taken_at).getTime(), v: s.nav_usd })))}
${last ? html`<div class="small muted">Hourly snapshots. Latest ${new Date(last.taken_at).toISOString().replace("T", " ").slice(0, 16)} UTC at block ${last.block}.</div>` : ""}</div></section>
${note ? html`<section class="card"><h2 style="margin-top:0">This week</h2><p>${note.note}</p><p class="small muted">${note.source === "rule" ? "Rule-based." : note.source === "equal-weight" ? "Fallback rule." : `Chosen by ${note.source.replace("model:", "")}.`}</p></section>` : ""}
${last && last.holdings.length ? html`<section class="card"><h2 style="margin-top:0">Holdings</h2><table><tbody>${last.holdings.map((h) => html`<tr><td><b>${h.ticker}</b></td><td class="num">${usd(h.valueUsd)}${proof({ token: h.token, holder: a.wallet })}</td></tr>`)}</tbody></table></section>` : ""}
<section class="card"><h2 style="margin-top:0">Every trade</h2>
${!trades.length ? html`<p class="empty">No trades yet. ${a.name} rebalances on Monday right after the US open.</p>` : html`<table><thead><tr><th>When</th><th>Trade</th><th class="num">USDC</th></tr></thead><tbody>
${trades.map((tr) => {
  const tok = tokenByAddress(tr.token);
  const qty = tr.side === "buy" ? tr.amount_out : tr.amount_in;
  return html`<tr><td class="small">${watDateTime(Math.floor(new Date(tr.ts).getTime() / 1000))}</td><td>${tr.side === "buy" ? "Bought" : "Sold"} ${shares(qty)} ${tok?.symbol ?? "?"}</td><td class="num">${usd(Number(tr.usdc_raw) / 1e6)}${proof({ tx: tr.tx_hash })}</td></tr>`;
})}</tbody></table>`}</section>
<section class="card small"><h2 style="margin-top:0">Identity and rules</h2>
<p>ERC-8004 identity: ${identity ? html`agent #${identity.erc8004Id}${proof({ address: ADDR.ERC8004_IDENTITY, label: "registry" })}${proof({ tx: identity.registerTx, label: "registration" })}` : "registers before week 1"} · <a href="/agents/${a.id}/card.json">agent card</a> · <a href="/api/agents/${a.id}">data</a></p>
<p class="muted">Guardrails in code: only this week's stocks; at most 50% in one name; 5% kept in USDC; 1% slippage cap; no trade if the pool is more than 1% off the Chainlink price; trades only in US market hours; pauses itself below half its starting value.</p></section>`,
  });
}
