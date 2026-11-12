import { table } from "@/lib/data";
import { getLang } from "@/lib/lang";
import { html } from "@/lib/html";
import { page } from "@/views/layout";
import { proof } from "@/views/parts";
import { pct } from "@/lib/format";
import { validWallet } from "@btb/shared/agentKit";
import { weekIdAt } from "@btb/shared/schedule";
import { listText } from "@btb/shared/text";
import { contractsChainId } from "@btb/shared/config";

/** A player's week, made to be shared: the page's preview image is their result card. */
export async function GET(req: Request, { params }: { params: Promise<{ wallet: string }> }) {
  const lang = await getLang();
  const wallet = (await params).wallet.toLowerCase();
  if (!validWallet(wallet)) return page({ lang, path: "/", status: 404, title: "Not found", body: html`<h1>Not found</h1>` });
  const week = Number(new URL(req.url).searchParams.get("week") ?? Math.max(1, weekIdAt(Math.floor(Date.now() / 1000))));
  const t = await table(week);
  const me = [...t.real, ...t.paper].find((r) => r.wallet.toLowerCase() === wallet);
  const beaten = me ? t.bots.filter((b) => me.ret > b.ret).map((b) => b.name) : [];
  const line = !me ? `Week ${week} on Beat the Bot` : beaten.length === t.bots.length && t.bots.length ? `I beat all the bots in week ${week}` : beaten.length ? `I beat ${listText(beaten)} in week ${week}` : `The bots won week ${week}`;
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin).replace(/\/$/, "");
  const shareUrl = `${site}/p/${wallet}?week=${week}`;
  const tweet = `${line}${me ? ` (${pct(me.ret, 2)})` : ""}. Pick three stocks on Base and try to beat the bots:`;
  return page({
    lang,
    path: "/",
    title: line,
    description: "A weekly stock-picking league on Base where people try to beat three AI bots.",
    image: `/api/og/player/${wallet}?week=${week}`,
    body: html`<h1>${line}</h1>
${me ? html`<p class="stat ${me.ret >= 0 ? "up" : "down"}">${pct(me.ret, 2)}</p>
<p class="muted">${me.tier === "real" ? "Real money" : "Free play"}${me.picks ? ` · ${me.picks.map((p) => `${p.ticker} ${Math.round(p.weightBps / 100)}%`).join(" · ")}` : ""}${proof(me.tier === "real" ? { address: wallet } : { tx: me.lockedTx, chain: contractsChainId() })}</p>` : html`<p class="muted">No entry from this wallet this week.</p>`}
<div class="row wrap" style="gap:10px;margin:16px 0">
<a class="btn" href="https://x.com/intent/post?text=${encodeURIComponent(tweet)}&url=${encodeURIComponent(shareUrl)}" target="_blank" rel="noopener noreferrer">Share on X</a>
<a class="btn secondary" href="/play">Play free</a></div>
<p class="small muted"><a href="/week/${week}">Week ${week}: full table, prices and payouts</a></p>`,
  });
}
