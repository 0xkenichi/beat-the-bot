import { getLang } from "@/lib/lang";
import { t } from "@/lib/copy";
import { getSession } from "@/lib/session";
import { player, prices, tradeMode, tradingReady } from "@/lib/data";
import { html, jsonData } from "@/lib/html";
import { page } from "@/views/layout";
import { proof } from "@/views/parts";
import { UNIVERSE } from "@btb/shared/universe";
import { builderCodeFromConfig } from "@btb/shared/config";
import { builderCodeSuffix } from "@btb/shared/builderCode";
import { weekSchedule, weekIdAt, watTime } from "@btb/shared/schedule";

export const dynamic = "force-dynamic";

const KEYS = ["sign_in", "signing_in", "non_us_title", "non_us_text", "non_us_confirm", "terms_link", "buy", "sell_half", "sell_all", "you_get", "confirm_buy", "confirm_sell", "working", "done_buy", "done_sell", "view_only", "portfolio", "add_usdc", "your_wallet", "your_wallet_note", "usdc_balance", "empty_portfolio", "link_telegram", "link_telegram_note", "open_telegram", "link_code_text"] as const;

export async function GET() {
  const [lang, session, p, mode] = await Promise.all([getLang(), getSession(), prices(), tradeMode()]);
  const pl = session ? await player(session.wallet) : null;
  const code = builderCodeFromConfig();
  const now = Math.floor(Date.now() / 1000);
  const s = weekSchedule(Math.max(1, weekIdAt(now)));
  const stocks = UNIVERSE.map((u) => ({ ticker: u.ticker, symbol: u.symbol, name: u.name, address: u.address, feed: u.feed, price: Number(p[u.address.toLowerCase()]?.price8 ?? 0) / 1e8 }));
  const data = {
    mode,
    session: session ? { wallet: session.wallet } : null,
    confirmed: !!pl?.non_us_confirmed_at,
    linked: !!pl?.telegram_id,
    suffix: code ? builderCodeSuffix(code) : null,
    countsFrom: t(lang, "counts_from", { time: watTime(s.entryClose) }),
    copy: Object.fromEntries(KEYS.map((k) => [k, t(lang, k)])),
  };
  return page({
    lang,
    path: "/trade",
    title: t(lang, "nav_trade"),
    scripts: ["trade.js"],
    body: html`<h1>${t(lang, "nav_trade")}</h1>
<p class="muted">Buy real Coinbase Tokenized Stocks with USDC, straight into your own wallet. Your portfolio is your entry.</p>
${mode === "view-only" ? html`<p class="notice">${t(lang, tradingReady() ? "view_only" : "prelaunch_trade")}</p>` : ""}
<section class="card" id="signin"${session || !tradingReady() ? " hidden" : ""}><p style="margin-top:0">${t(lang, "signin_note")}</p><button class="btn block" id="signin-btn">${t(lang, "sign_in")}</button></section>
<section class="card" id="confirm" hidden><h2 style="margin-top:0">${t(lang, "non_us_title")}</h2><p>${t(lang, "non_us_text")} <a href="/terms">${t(lang, "terms_link")}</a></p><button class="btn block" id="confirm-btn">${t(lang, "non_us_confirm")}</button></section>
<div id="msg" role="status"></div>
<section class="card"><div class="row between"><h2 style="margin:0">${t(lang, "buy")}</h2><span class="small muted">${t(lang, "pick_up_to")}</span></div>
<div id="stocks">${stocks.map((st) => html`<button class="stock pick" data-addr="${st.address}" data-ticker="${st.ticker}" aria-pressed="false"><span><span class="ticker">${st.ticker}</span> <span class="small muted">${st.name}</span></span><span class="num">$${st.price.toFixed(2)}</span></button>`)}</div>
<p class="small muted" style="margin-bottom:0">${t(lang, "prices_note")}</p></section>
<section class="card" id="order" hidden><div class="small muted">${t(lang, "amount")}</div>
<div class="chips" style="margin:8px 0 12px">${[1, 5, 10, 20].map((a) => html`<button class="chip amt" data-amt="${a}" aria-pressed="${String(a === 5)}">$${a}</button>`)}</div>
<button class="btn block" id="buy-btn" ${mode !== "live" ? "disabled" : ""}>${t(lang, "buy")}</button><div id="quote"></div>
<p class="small muted" style="margin-bottom:0">${t(lang, "slippage_note")} ${t(lang, "soft_cap")}</p></section>
<section class="card" id="portfolio"${session ? "" : " hidden"}><div class="row between"><h2 style="margin:0">${t(lang, "portfolio")}</h2><a class="small" href="/fund">${t(lang, "add_usdc")}</a></div>
<p class="small muted" style="margin-top:4px">${t(lang, "your_wallet")}: <span class="addr" id="wallet-addr">${session?.wallet ?? ""}</span> <a class="proof" id="wallet-proof" href="https://basescan.org/address/${session?.wallet ?? ""}" target="_blank" rel="noopener noreferrer">Basescan</a></p>
<div id="holdings"><p class="empty">…</p></div><div id="sell-quote"></div><div class="small muted" style="margin-top:8px">${t(lang, "your_wallet_note")}</div></section>
<section class="card" id="link" hidden><h2 style="margin-top:0">${t(lang, "link_telegram")}</h2><p class="small">${t(lang, "link_telegram_note")}</p><div id="link-body"><button class="btn secondary block" id="link-btn">${t(lang, "link_telegram")}</button></div></section>
<section class="card small"><h2 style="margin-top:0">Where the prices come from</h2><table><tbody>
${stocks.map((st) => html`<tr><td><b>${st.ticker}</b> <span class="muted">${st.symbol}</span>${proof({ token: st.address, label: "token" })}</td><td class="num">$${st.price.toFixed(2)}${proof({ address: st.feed, label: "Chainlink" })}</td></tr>`)}
</tbody></table><p class="muted" style="margin-bottom:0">Tokens are identified by address. Each one is checked for a deep USDC pool before it is listed.</p></section>
${jsonData("trade-data", data)}`,
  });
}
