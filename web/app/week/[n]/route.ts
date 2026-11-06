import { db, table } from "@/lib/data";
import { getLang } from "@/lib/lang";
import { html } from "@/lib/html";
import { page } from "@/views/layout";
import { proof, tierTable } from "@/views/parts";
import { weekSchedule, watDateTime } from "@btb/shared/schedule";
import { UNIVERSE } from "@btb/shared/universe";
import { contracts } from "@btb/shared/config";

export const dynamic = "force-dynamic";
type PriceRow = { price8: string; updatedAt: number; stale?: boolean };

export async function GET(_req: Request, { params }: { params: Promise<{ n: string }> }) {
  const lang = await getLang();
  const n = Number((await params).n);
  if (!Number.isInteger(n) || n < 1 || n > 520) return page({ lang, path: "/week", status: 404, title: "Not found", body: html`<h1>No such week</h1>` });
  const s = weekSchedule(n);
  const tb = await table(n);
  const [w] = await (await db()).query<{ open_prices: Record<string, PriceRow> | null; close_prices: Record<string, PriceRow> | null; results_hash: string | null; settle_txs: { tx: string; tier: string }[] | null; fund_txs: { tx: string }[] | null }>(
    "select open_prices, close_prices, results_hash, settle_txs, fund_txs from weeks where week = $1",
    [n],
  );
  const { prizePool: pool, chainId: chain } = contracts();
  const phaseText = tb.phase === "upcoming" ? "not open yet" : tb.phase === "entries-open" ? "open for entries" : tb.phase === "live" ? "live" : "being scored";
  return page({
    lang,
    path: "/week",
    title: `Week ${n}`,
    image: `/api/og/week/${n}`,
    body: html`<h1>Week ${n}</h1>
<p class="muted">Entries ${watDateTime(s.entryOpen)} to ${watDateTime(s.entryClose)}. Scored at the US close, ${watDateTime(s.scoreAt)}.</p>
${tb.phase === "final" ? html`<p class="ok">Final results. <a href="/api/weeks/${n}/results">Results file</a>${w?.results_hash ? html` · hash <code class="small">${w.results_hash.slice(0, 18)}…</code>` : ""}</p>` : html`<p class="notice">This week is ${phaseText}.</p>`}
${tierTable({ title: "Bots", rows: tb.bots, beatLabel: "Beat the bot", showValue: true, empty: "No bot results yet." })}
${tierTable({ title: "Real money", rows: tb.real, beatLabel: "Beat the bot", showValue: true, empty: "No ranked real portfolios." })}
${tierTable({ title: "Free play", rows: tb.paper, beatLabel: "Beat the bot", empty: "No free picks." })}
<section class="card small"><h2 style="margin-top:0">Prices used</h2>
${!w?.open_prices ? html`<p class="empty">Opening prices are recorded at the US open on Monday.</p>` : html`<table><thead><tr><th>Stock</th><th class="num">Open</th><th class="num">Close</th><th class="num">Change</th></tr></thead><tbody>
${Object.entries(w.open_prices).map(([addr, o]) => {
  const u = UNIVERSE.find((x) => x.address.toLowerCase() === addr.toLowerCase());
  const c = w.close_prices?.[addr];
  const ch = c ? Number(c.price8) / Number(o.price8) - 1 : null;
  return html`<tr><td><b>${u?.ticker ?? addr.slice(0, 8)}</b>${u ? proof({ address: u.feed, label: "feed" }) : ""}</td><td class="num">$${(Number(o.price8) / 1e8).toFixed(2)}${o.stale ? " *" : ""}</td><td class="num">${c ? `$${(Number(c.price8) / 1e8).toFixed(2)}${c.stale ? " *" : ""}` : "–"}</td><td class="num ${ch != null && ch < 0 ? "down" : "up"}">${ch == null ? "–" : `${ch >= 0 ? "+" : ""}${(ch * 100).toFixed(2)}%`}</td></tr>`;
})}</tbody></table>`}
<p class="muted">Each price is the Chainlink round in force at the cutoff. * marks a round more than two hours older than the cutoff (the last valid round was used).</p></section>
<section class="card small"><h2 style="margin-top:0">Prizes</h2>
${w?.fund_txs?.length ? html`<ul>${w.fund_txs.map((f) => html`<li>Funded by the sponsor${proof({ tx: f.tx, chain })}</li>`)}</ul>` : html`<p class="empty">No prizes this week. When a sponsor funds a week, the prizes and their payouts show here.</p>`}
${w?.settle_txs?.length ? html`<ul>${w.settle_txs.map((x) => html`<li>Paid (${x.tier})${proof({ tx: x.tx, chain })}</li>`)}</ul>` : ""}
${pool ? html`<p class="muted">Prize contract${proof({ address: pool, chain })}</p>` : ""}</section>
<p class="small"><a href="/">Back to this week's table</a></p>`,
  });
}
