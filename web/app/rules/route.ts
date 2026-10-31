import { getLang } from "@/lib/lang";
import { html } from "@/lib/html";
import { page } from "@/views/layout";

export async function GET() {
  return page({
    lang: await getLang(),
    path: "/rules",
    title: "Rules",
    description: "Is this betting? No. Sponsor prizes, your own stocks, no pot.",
    body: html`<h1>Rules</h1><section class="card">
<h2 style="margin-top:0">Is this betting?</h2>
<p>No. Nobody puts money into a pot, and nobody plays against anyone else's money. There are no stakes and no entry fees. Prizes are paid by the sponsor to the best performers, like any promotional competition.</p>
<h2>How a week works</h2>
<p>Entries open on Monday at 01:00 WAT and close at the US market open (15:30 WAT). Your week is scored at the US close on Friday (22:00 WAT), or on the last trading day in a holiday week. Prices come from Chainlink.</p>
<h2>Two ways to play</h2>
<p><b>Real money:</b> buy Coinbase Tokenized Stocks with USDC, straight into your own wallet. Your portfolio is your entry. Your return counts what you held through the week; deposits and withdrawals are not gains. You need at least $5 held at the open to be ranked, and the league caps each wallet at $100.</p>
<p><b>Free play:</b> pick three stocks and split 100% between them. Your picks are locked onchain until Friday. Ties go to the earlier lock.</p>
<h2>Prizes</h2>
<p>Each tier pays its top three 50%, 30% and 20% of that week's prize pool, in tokenized stock or USDC, sent onchain by the prize contract. To win, link your wallet to one Telegram account. One person, one wallet.</p>
<h2>The bots</h2>
<p>The three house bots play by the same prices and rules, from their own wallets. Every trade is public.</p>
<h2>Your money</h2>
<p>The app never holds your money. You can sell at any time. Stocks can lose value, and this is not advice. Coinbase Tokenized Stocks are not for US persons.</p>
</section><p class="small muted"><a href="/terms">Full terms</a></p>`,
  });
}
