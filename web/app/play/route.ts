import { getLang } from "@/lib/lang";
import { t } from "@/lib/copy";
import { getSession } from "@/lib/session";
import { db, player } from "@/lib/data";
import { html, jsonData } from "@/lib/html";
import { page } from "@/views/layout";
import { proof } from "@/views/parts";
import { UNIVERSE } from "@btb/shared/universe";
import { contracts, builderCodeFromConfig } from "@btb/shared/config";
import { CHAINS } from "@btb/shared/chain";
import { builderCodeSuffix } from "@btb/shared/builderCode";
import { weekSchedule, weekIdAt, watDateTime } from "@btb/shared/schedule";

export const dynamic = "force-dynamic";

export async function GET() {
  const [lang, session] = await Promise.all([getLang(), getSession()]);
  const now = Math.floor(Date.now() / 1000);
  const wk = Math.max(1, weekIdAt(now));
  const s = weekSchedule(wk);
  const open = now >= s.entryOpen && now < s.entryClose;
  const d = await db();
  const [weekRow] = await d.query<{ universe: string[] }>("select universe from weeks where week = $1", [wk]);
  const universe = weekRow?.universe ?? UNIVERSE.map((u) => u.address);
  const stocks = universe.map((a, index) => {
    const u = UNIVERSE.find((x) => x.address.toLowerCase() === a.toLowerCase());
    return { index, ticker: u?.ticker ?? a.slice(0, 8), name: u?.name ?? "" };
  });
  const pl = session ? await player(session.wallet) : null;
  const [lockRow] = session ? await d.query<{ picks: { tokenIndex: number; weightBps: number }[]; tx_hash: string }>("select picks, tx_hash from paper_locks where week = $1 and wallet = $2", [wk, session.wallet.toLowerCase()]) : [];
  const code = builderCodeFromConfig();
  const { pickBook, chainId } = contracts();
  const when = open ? `close ${watDateTime(s.entryClose)}` : now < s.entryOpen ? `open ${watDateTime(s.entryOpen)}` : `closed ${watDateTime(s.entryClose)}; next week opens ${watDateTime(weekSchedule(wk + 1).entryOpen)}`;
  const keys = ["pick_three", "weights_must_sum", "locked", "working", "lock_picks", "sign_in", "non_us_text", "non_us_confirm", "terms_link"] as const;
  const state = !pickBook ? "not-deployed" : !open ? "closed" : "open";
  return page({
    lang,
    path: "/play",
    title: t(lang, "play_title"),
    scripts: state === "open" ? ["play.js"] : [],
    body: html`<h1>${t(lang, "play_title")}</h1>
<p>${t(lang, "play_intro")}</p>
${pickBook ? html`<p class="small muted">Week ${wk}: entries ${when}. Picks are recorded on ${CHAINS[chainId].name}${proof({ address: pickBook, chain: chainId })}</p>` : ""}
${lockRow ? html`<p class="ok">You're in for week ${wk}. ${proof({ tx: lockRow.tx_hash, label: "your lock", chain: chainId })}</p>` : ""}
${state === "not-deployed" ? html`<p class="notice">Free play opens when the picks contract is live onchain.</p>` : ""}
${state === "closed" ? html`<p class="notice">${t(lang, "picks_closed")}</p>` : ""}
${state === "open" ? html`<section class="card"><div class="row between"><h2 style="margin:0">${t(lang, "pick_three")}</h2><span class="small muted" id="count">0/3</span></div>
<div id="stocks">${stocks.map((st) => html`<div class="row between" style="padding:10px 0;border-bottom:1px solid var(--line)" data-idx="${st.index}"><button class="pick-name grow" style="background:none;border:0;text-align:left;color:inherit;font:inherit;cursor:pointer;padding:0"><b>${st.ticker}</b> <span class="small muted">${st.name}</span></button><span class="ctl"><button class="chip pick-btn">Pick</button></span></div>`)}</div>
<p class="small muted" id="total">Total 0%</p></section>
<section class="card" id="confirm" hidden><p style="margin-top:0">${t(lang, "non_us_text")} <a href="/terms">${t(lang, "terms_link")}</a></p><button class="btn block" id="confirm-btn">${t(lang, "non_us_confirm")}</button></section>
<div id="msg" role="status"></div>
<button class="btn block" id="lock-btn">${session ? t(lang, "lock_picks") : `${t(lang, "sign_in")} · ${t(lang, "lock_picks")}`}</button>
<p class="small muted">Free to play. Gas is covered. You can change your picks until entries close.</p>
${jsonData("play-data", { week: wk, session: session ? { wallet: session.wallet } : null, confirmed: !!pl?.non_us_confirmed_at, existing: lockRow?.picks ?? null, suffix: code ? builderCodeSuffix(code) : null, chainHex: CHAINS[chainId].hex, explorer: CHAINS[chainId].explorer, copy: Object.fromEntries(keys.map((k) => [k, t(lang, k)])) })}` : ""}`,
  });
}
