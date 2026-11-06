import { table } from "@/lib/data";
import { getLang } from "@/lib/lang";
import { t } from "@/lib/copy";
import { html } from "@/lib/html";
import { page } from "@/views/layout";
import { countdown, tierTable } from "@/views/parts";
import { watDateTime, watTime, weekSchedule, nextMarketOpen } from "@btb/shared/schedule";
import { botsMode } from "@btb/shared/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const lang = await getLang();
  const tb = await table();
  const s = tb.schedule;
  const now = Math.floor(Date.now() / 1000);
  const marketOpenAt = s.entryClose > now ? s.entryClose : nextMarketOpen(now);
  const next = tb.phase === "upcoming" ? weekSchedule(1) : s;
  const status =
    tb.phase === "upcoming" ? html`<b>Week 1 opens ${watDateTime(next.entryOpen)}</b>`
    : tb.phase === "entries-open" ? html`<b>${t(lang, "closes_in")} ${countdown(s.entryClose)} · ${watDateTime(s.entryClose)}</b>`
    : tb.phase === "live" ? html`<b>${t(lang, "scored_in")} ${countdown(s.scoreAt)} · ${watDateTime(s.scoreAt)}</b>`
    : tb.phase === "scoring" ? html`<b>Scoring now. Results at ${watTime(s.resultsAt)}.</b>`
    : html`<b>Final. <a href="/week/${tb.weekId}">Results, prices and payouts</a></b>`;
  const beat = t(lang, "beat_the_bot");
  const picksBots = botsMode() === "picks";
  return page({
    lang,
    path: "/",
    image: `/api/og/week/${tb.weekId}`,
    body: html`<h1>${t(lang, "tagline")}</h1>
<p class="muted">${t(lang, picksBots ? "hero_line_picks" : "hero_line")}</p>
<div class="row wrap" style="gap:10px;margin:12px 0 4px"><a class="btn" href="/trade">${t(lang, "cta_trade")}</a><a class="btn secondary" href="/play">${t(lang, "cta_play")}</a></div>
<section class="card"><div class="row between wrap"><div><div class="small muted">${t(lang, "week_label")} ${next.weekId}</div>${status}</div>
${tb.phase !== "final" ? html`<a class="small" href="/week/${tb.weekId}">How this week is scored</a>` : ""}</div></section>
${tierTable({ title: t(lang, "tier_bot"), rows: tb.bots, beatLabel: beat, showValue: true, empty: picksBots ? t(lang, "empty_bots_picks") : t(lang, "empty_bots", { time: watTime(marketOpenAt) }) })}
${tierTable({ title: t(lang, "tier_real"), rows: tb.real, beatLabel: beat, showValue: true, empty: t(lang, "empty_real") })}
${tierTable({ title: t(lang, "tier_paper"), rows: tb.paper, beatLabel: beat, empty: t(lang, "empty_paper") })}
<p class="small muted">Returns run from the US open on Monday (${watTime(s.entryClose)}) to the US close on Friday (${watTime(s.scoreAt)}), priced by Chainlink. Deposits and withdrawals don't count as gains.</p>`,
  });
}
