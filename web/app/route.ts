import { table } from "@/lib/data";
import { getLang } from "@/lib/lang";
import { t } from "@/lib/copy";
import { html } from "@/lib/html";
import { page } from "@/views/layout";
import { countdown, tierTable } from "@/views/parts";
import { watDateTime, watTime, weekSchedule, nextMarketOpen } from "@btb/shared/schedule";
import { botsMode, leagueLive } from "@btb/shared/config";

export const dynamic = "force-dynamic";

/** The headline, with "bots" in the brand colour. */
function heroTitle(title: string) {
  const i = title.lastIndexOf("bots");
  return i < 0 ? html`${title}` : html`${title.slice(0, i)}<em>bots</em>${title.slice(i + 4)}`;
}

const feature = (tile: string, glyph: string, title: string, body: string, tag: string, href?: string) =>
  html`<div class="feature"><span class="tile ${tile}" aria-hidden="true">${glyph}</span><h3>${href ? html`<a href="${href}" style="color:inherit">${title}</a>` : title}</h3><p>${body}</p><span class="tag">${tag}</span></div>`;

export async function GET() {
  const lang = await getLang();
  const tb = await table();
  const s = tb.schedule;
  const now = Math.floor(Date.now() / 1000);
  const marketOpenAt = s.entryClose > now ? s.entryClose : nextMarketOpen(now);
  const next = tb.phase === "upcoming" ? weekSchedule(1) : s;
  const status =
    tb.phase === "upcoming" ? html`opens ${watDateTime(next.entryOpen)}`
    : tb.phase === "entries-open" ? html`${t(lang, "closes_in")} ${countdown(s.entryClose)}`
    : tb.phase === "live" ? html`${t(lang, "scored_in")} ${countdown(s.scoreAt)}`
    : tb.phase === "scoring" ? html`Scoring now · results at ${watTime(s.resultsAt)}`
    : html`Final · <a href="/week/${tb.weekId}">results and prices</a>`;
  const beat = t(lang, "beat_the_bot");
  const picksBots = botsMode() === "picks";
  const live = leagueLive();
  return page({
    lang,
    path: "/",
    image: `/api/og/week/${tb.weekId}`,
    body: html`<section class="hero">
${live ? html`<span class="pill-badge"><b>${t(lang, "week_label")} ${next.weekId}</b>${status}</span>` : html`<span class="pill-badge"><b>${t(lang, "prelaunch_status")}</b>${t(lang, "prelaunch_badge")}</span>`}
<h1>${heroTitle(t(lang, "hero_title"))}</h1>
<p class="lede">${t(lang, picksBots ? "hero_line_picks" : "hero_line")}</p>
<div class="actions"><a class="btn" href="/play">${t(lang, "cta_play")}</a><a class="btn secondary" href="/trade">${t(lang, "cta_trade")}</a></div>
${live && tb.phase !== "final" ? html`<a class="small" href="/week/${tb.weekId}">${t(lang, "how_scored")}</a>` : ""}
</section>
${!live ? html`<p class="muted" style="text-align:center">${t(lang, "prelaunch_line")}</p>
<h2 style="text-align:center;margin-top:28px">${t(lang, "how_title")}</h2>
<div class="features">
${feature("t-agent", "✓", t(lang, "how_pick_t"), t(lang, "how_pick"), t(lang, "tag_free"))}
${feature("t-steady", "$", t(lang, "how_real_t"), t(lang, "how_real"), t(lang, "tag_from1"))}
${feature("t-momentum", "↗", t(lang, "how_bots_t"), t(lang, "how_bots"), t(lang, "tag_public"), "/agents")}
${feature("t-contrarian", "⚑", t(lang, "how_score_t"), t(lang, "how_score"), t(lang, "tag_chainlink"), "/rules")}
</div>` : html`${tierTable({ title: t(lang, "tier_bot"), rows: tb.bots, beatLabel: beat, showValue: true, empty: picksBots ? t(lang, "empty_bots_picks") : t(lang, "empty_bots", { time: watTime(marketOpenAt) }) })}
${tierTable({ title: t(lang, "tier_real"), rows: tb.real, beatLabel: beat, showValue: true, empty: t(lang, "empty_real") })}
${tierTable({ title: t(lang, "tier_paper"), rows: tb.paper, beatLabel: beat, empty: t(lang, "empty_paper") })}
<p class="small muted">Returns run from the US open on Monday (${watTime(s.entryClose)}) to the US close on Friday (${watTime(s.scoreAt)}), priced by Chainlink. Deposits and withdrawals don't count as gains.</p>`}`,
  });
}
