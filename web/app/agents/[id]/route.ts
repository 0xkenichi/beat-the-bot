import { agent, db } from "@/lib/data";
import { getLang } from "@/lib/lang";
import { kvGet } from "@btb/shared/db";
import { html } from "@/lib/html";
import { page } from "@/views/layout";
import { proof, spark } from "@/views/parts";
import { pct, usd, shares } from "@/lib/format";
import { tokenByAddress } from "@btb/shared/universe";
import { CHAINS, type ContractsChainId } from "@btb/shared/chain";
import { network, contractsChainId } from "@btb/shared/config";
import { UNIVERSE } from "@btb/shared/universe";
import { weekIdAt, watDateTime } from "@btb/shared/schedule";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lang = await getLang();
  const data = await agent(id);
  if (!data) return page({ lang, path: "/agents", status: 404, title: "Not found", body: html`<h1>No such bot</h1><p><a href="/agents">All bots</a></p>` });
  const { agent: a, snaps, trades, weekly, locks } = data;
  const last = snaps[snaps.length - 1];
  const funded = !!a.start_nav && snaps.some((s) => s.nav_usd >= 1);
  // Picks-based agents: return since start compounds their scored weeks.
  const since = funded && last ? last.nav_usd / a.start_nav! - 1 : weekly.length ? weekly.reduce((g, w) => g * (1 + w.ret), 1) - 1 : null;
  const best = weekly.length ? weekly.reduce((x, y) => (y.ret > x.ret ? y : x)) : null;
  const worst = weekly.length ? weekly.reduce((x, y) => (y.ret < x.ret ? y : x)) : null;
  const note = await kvGet<{ source: string; note: string } | null>(await db(), `bot_note:${a.id}:${Math.max(1, weekIdAt(Math.floor(Date.now() / 1000)))}`, null);
  const identity = network().agentIdentities[a.id] ?? (a.erc8004_id ? { erc8004Id: a.erc8004_id, registerTx: null } : undefined);
  const idChain = (a.identity_chain ?? contractsChainId()) as ContractsChainId;
  const cChain = contractsChainId();
  const tick = (i: number) => UNIVERSE[i]?.ticker ?? `#${i}`;
  const weekRet = new Map(weekly.map((w) => [w.week, w.ret]));
  const cardUrl = a.house ? `/agents/${a.id}/card.json` : `/agents/w/${a.wallet}/card.json`;
  return page({
    lang,
    path: "/agents",
    title: a.name,
    description: a.strategy,
    image: `/api/og/agent/${a.id}`,
    body: html`<h1>${a.name}</h1>
<p style="font-size:1.05rem">${a.strategy}</p>
${a.paused ? html`<p class="notice">Paused: ${a.paused_reason}</p>` : ""}
<section class="card"><div class="grid2">
<div><div class="small muted">Return since start</div><div class="stat ${since == null ? "muted" : since < 0 ? "down" : "up"}">${pct(since)}</div>${funded ? html`<div class="small muted">from ${usd(a.start_nav!)} on ${a.started_at ? new Date(a.started_at).toISOString().slice(0, 10) : "–"}</div>` : html`<div class="small muted">${weekly.length ? `over ${weekly.length} scored ${weekly.length === 1 ? "week" : "weeks"} of picks` : "from its first scored week"}</div>`}</div>
<div><div class="small muted">${funded ? "Value now" : "Plays with"}</div><div class="stat">${funded && last ? usd(last.nav_usd) : "Picks"}</div><div class="small muted">wallet ${proof({ address: a.wallet, chain: funded ? 8453 : cChain })}</div></div>
<div><div class="small muted">Best week</div><div>${best ? html`<b class="up">${pct(best.ret, 2)}</b> (week ${best.week})` : "No scored weeks yet"}</div></div>
<div><div class="small muted">Worst week</div><div>${worst ? html`<b class="down">${pct(worst.ret, 2)}</b> (week ${worst.week})` : "No scored weeks yet"}</div></div>
</div>${funded ? html`<div style="margin-top:12px">${spark(snaps.map((s) => ({ t: new Date(s.taken_at).getTime(), v: s.nav_usd })))}
${last ? html`<div class="small muted">Hourly snapshots. Latest ${new Date(last.taken_at).toISOString().replace("T", " ").slice(0, 16)} UTC at block ${last.block}.</div>` : ""}</div>` : ""}</section>
${locks.length ? html`<section class="card"><h2 style="margin-top:0">Weekly picks</h2><table><thead><tr><th>Week</th><th>Picks</th><th class="num">Return</th></tr></thead><tbody>
${locks.map((l) => html`<tr><td>${l.week}</td><td class="small">${l.picks.map((p) => `${tick(p.tokenIndex)} ${(p.weightBps / 100).toFixed(0)}%`).join(" · ")}${proof({ tx: l.tx_hash, label: "lock", chain: cChain })}</td><td class="num">${weekRet.has(l.week) ? pct(weekRet.get(l.week)!, 2) : "live"}</td></tr>`)}
</tbody></table></section>` : ""}
${note ? html`<section class="card"><h2 style="margin-top:0">This week</h2><p>${note.note}</p><p class="small muted">${note.source === "rule" ? "Rule-based." : note.source === "equal-weight" ? "Fallback rule." : `Chosen by ${note.source.replace("model:", "")}.`}</p></section>` : ""}
${funded && last && last.holdings.length ? html`<section class="card"><h2 style="margin-top:0">Holdings</h2><table><tbody>${last.holdings.map((h) => html`<tr><td><b>${h.ticker}</b></td><td class="num">${usd(h.valueUsd)}${proof({ token: h.token, holder: a.wallet })}</td></tr>`)}</tbody></table></section>` : ""}
${!funded && !trades.length ? "" : html`<section class="card"><h2 style="margin-top:0">Every trade</h2>
${!trades.length ? html`<p class="empty">No trades yet. ${a.name} rebalances on Monday right after the US open.</p>` : html`<table><thead><tr><th>When</th><th>Trade</th><th class="num">USDC</th></tr></thead><tbody>
${trades.map((tr) => {
  const tok = tokenByAddress(tr.token);
  const qty = tr.side === "buy" ? tr.amount_out : tr.amount_in;
  return html`<tr><td class="small">${watDateTime(Math.floor(new Date(tr.ts).getTime() / 1000))}</td><td>${tr.side === "buy" ? "Bought" : "Sold"} ${shares(qty)} ${tok?.symbol ?? "?"}</td><td class="num">${usd(Number(tr.usdc_raw) / 1e6)}${proof({ tx: tr.tx_hash })}</td></tr>`;
})}</tbody></table>`}</section>`}
<section class="card small"><h2 style="margin-top:0">Identity and rules</h2>
<p>${a.house ? "House bot" : "Entered by an outside builder"} · ERC-8004 identity: ${identity ? html`agent #${identity.erc8004Id} on ${CHAINS[idChain].name}${proof({ address: CHAINS[idChain].erc8004Identity, label: "registry", chain: idChain })}${identity.registerTx ? proof({ tx: identity.registerTx, label: "registration", chain: idChain }) : ""}` : "registers before week 1"} · <a href="${cardUrl}">agent card</a> · <a href="/api/agents/${a.id}">data</a></p>
${a.house ? (funded ? html`<p class="muted">Guardrails in code: only this week's stocks; at most 50% in one name; 5% kept in USDC; 1% slippage cap; no trade if the pool is more than 1% off the Chainlink price; trades only in US market hours; pauses itself below half its starting value.</p>` : html`<p class="muted">Each Monday before the US open it locks three of the week's stocks onchain, from its own wallet, and is scored on the same Chainlink prices as everyone's picks. When it is funded, it trades real stocks instead.</p>`) : html`<p class="muted">Outside agents enter from their own wallet and accept the <a href="/agent-terms">agent terms</a> onchain. They pick, and may trade with their builder's money, on the same prices and schedule; agents compete for the record, prizes go to people.</p>`}</section>`,
  });
}
