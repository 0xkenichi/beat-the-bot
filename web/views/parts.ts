import { html, raw, type Raw } from "@/lib/html";
import { basescanToken, explorerAddress, explorerTx } from "@btb/shared/chain";
import { contractsChainId } from "@btb/shared/config";
import type { Row } from "@btb/shared/league";
import { pct, usd } from "@/lib/format";

/**
 * The small "Basescan ↗" link that sits next to every number. `chain` defaults to Base (stocks, wallets, trades);
 * pass the contracts chain for picks, agents and prizes.
 */
export function proof(o: { address?: string | null; tx?: string | null; token?: string | null; holder?: string; label?: string; chain?: number }): Raw {
  const chain = o.chain ?? 8453;
  const href = o.tx ? explorerTx(chain, o.tx) : o.token ? basescanToken(o.token, o.holder) : o.address ? explorerAddress(chain, o.address) : null;
  if (!href) return raw("");
  return html`<a class="proof" href="${href}" target="_blank" rel="noopener noreferrer">${o.label ?? "Basescan"}</a>`;
}

export function tierTable(o: { title: string; rows: Row[]; empty: string; showValue?: boolean; beatLabel: string }): Raw {
  if (!o.rows.length) return html`<section class="card"><h2 style="margin-top:0">${o.title}</h2><p class="empty">${o.empty}</p></section>`;
  // Bots and agents that play with picks hold no money, so the value column only shows when someone has a value.
  const showValue = o.showValue && o.rows.some((r) => r.valueUsd != null);
  return html`<section class="card"><h2 style="margin-top:0">${o.title}</h2>
<table><thead><tr><th class="rank">#</th><th>Player</th>${showValue ? html`<th class="num">Value</th>` : ""}<th class="num">Week</th></tr></thead><tbody>
${o.rows.map(
  (r) => html`<tr><td class="rank">${r.rank}</td><td>${r.agentId ? html`<a href="/agents/${r.agentId}"><b>${r.name}</b></a>` : html`<span>${r.name}</span>`}${r.beatTheBot ? html` <span class="badge">${o.beatLabel}</span>` : ""}
${r.picks ? html`<div class="small muted">${r.picks.map((p) => `${p.ticker} ${Math.round(p.weightBps / 100)}%`).join(" · ")}${proof({ tx: r.lockedTx, label: "lock", chain: contractsChainId() })}</div>` : ""}
${!r.beatTheBot && r.beats?.length ? html`<div class="small muted">Beat ${r.beats.join(" and ")}</div>` : ""}</td>
${showValue ? html`<td class="num">${r.valueUsd != null ? usd(r.valueUsd) : "–"}${proof({ address: r.wallet })}</td>` : ""}
<td class="num ${r.ret >= 0 ? "up" : "down"}">${pct(r.ret, 2)}</td></tr>`,
)}
</tbody></table></section>`;
}

/** Server-rendered line chart, no library. */
export function spark(points: { t: number; v: number }[]): Raw {
  if (points.length < 2) return html`<p class="empty small">The chart starts after the first two hourly snapshots.</p>`;
  const w = 600, h = 80, pad = 4;
  const ts = points.map((p) => p.t), vs = points.map((p) => p.v);
  const t0 = Math.min(...ts), t1 = Math.max(...ts), v0 = Math.min(...vs), v1 = Math.max(...vs);
  const x = (t: number) => pad + ((t - t0) / Math.max(1, t1 - t0)) * (w - 2 * pad);
  const y = (v: number) => h - pad - ((v - v0) / Math.max(1e-9, v1 - v0)) * (h - 2 * pad);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const up = vs[vs.length - 1]! >= vs[0]!;
  return html`<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Value over time"><path d="${d}" fill="none" stroke="${up ? "var(--up)" : "var(--down)"}" stroke-width="2.5" vector-effect="non-scaling-stroke"/></svg>`;
}

export const countdown = (to: number) => html`<span data-countdown="${to * 1000 / 1000}">…</span>`;
