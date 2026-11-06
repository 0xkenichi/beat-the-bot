import { html, raw, type Raw } from "@/lib/html";
import { t, type Lang } from "@/lib/copy";

import { CSS } from "./styles";

const NAV: [string, Parameters<typeof t>[1]][] = [["/", "nav_table"], ["/trade", "nav_trade"], ["/play", "nav_play"], ["/agents", "nav_agents"], ["/rules", "nav_rules"]];

export type PageOpts = { title?: string; description?: string; lang: Lang; path: string; body: Raw; scripts?: string[]; status?: number; image?: string };

const site = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");

export const ASSET_VERSION = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ?? "dev";

export function page(o: PageOpts): Response {
  const title = o.title ? `${o.title} · Beat the Bot` : "Beat the Bot";
  const desc = o.description ?? "A weekly stock-picking league on Base. Pick real Coinbase Tokenized Stocks and try to beat three AI bots that trade with real money.";
  const active = (href: string) => (href === "/" ? o.path === "/" : o.path.startsWith(href));
  const doc = html`<!doctype html>
<html lang="${o.lang === "pcm" ? "pcm" : "en"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#0b5cff">
<title>${title}</title>
<meta name="description" content="${desc}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
${o.image ? html`<meta property="og:image" content="${site()}${o.image}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${site()}${o.image}">` : html`<meta name="twitter:card" content="summary">`}
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<style>${raw(CSS)}</style>
</head>
<body>
<header class="top"><div class="bar">
<a href="/" class="logo">${t(o.lang, "brand")}</a>
<nav>${NAV.map(([href, key]) => html`<a href="${href}"${active(href) ? raw(' aria-current="page"') : ""}>${t(o.lang, key)}</a>`)}</nav>
<a class="lang" href="/api/lang?to=${o.lang === "pcm" ? "en" : "pcm"}">${o.lang === "pcm" ? "English" : t(o.lang, "lang_toggle")}</a>
</div></header>
<main>${o.body}</main>
<footer class="foot">
<p>${t(o.lang, "footer_non_custodial")} Stocks can lose value. Not for US persons.</p>
<p><a href="/rules">Rules</a> · <a href="/terms">Terms</a> · <a href="/fund">Add USDC</a> · <a href="/agents">Bots</a> · <a href="/contracts">Contracts</a></p>
</footer>
<script>document.querySelectorAll("[data-countdown]").forEach(function(e){var to=+e.getAttribute("data-countdown");function f(){var s=Math.max(0,to-Date.now()/1e3),d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60);e.textContent=s<=0?"now":d>0?d+"d "+h+"h":h>0?h+"h "+m+"m":m+"m "+Math.floor(s%60)+"s"}f();setInterval(f,1e3)})</script>
${(o.scripts ?? []).map((s) => html`<script type="module" src="/js/${s}?v=${ASSET_VERSION}"></script>`)}
</body>
</html>`;
  return new Response(doc.s, {
    status: o.status ?? 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-cache" },
  });
}
