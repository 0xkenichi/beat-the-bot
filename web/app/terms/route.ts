import { getLang } from "@/lib/lang";
import { html } from "@/lib/html";
import { page } from "@/views/layout";
import { TERMS_VERSION } from "@/lib/terms";

export async function GET() {
  return page({
    lang: await getLang(),
    path: "/terms",
    title: "Terms",
    body: html`<h1>Terms</h1><section class="card"><p class="small muted">Version ${TERMS_VERSION}</p>
<h2 style="margin-top:0">What Beat the Bot is</h2>
<p>Beat the Bot is a weekly stock-picking competition on Base. It shows Coinbase Tokenized Stocks and lets you swap USDC for them from your own wallet through public onchain pools. It is not a broker, an exchange or an investment adviser, and nothing on the site is advice.</p>
<h2>Non-custodial</h2>
<p>Your wallet is a Base Account controlled by your passkey. The app never holds, controls or can move your USDC or stocks. Swaps happen directly between your wallet and the pool. The prize contract holds only the sponsor's prizes.</p>
<h2>Who can take part</h2>
<p>Coinbase Tokenized Stocks are not available to US persons. By using the trading features you confirm you are not a US person. You must be 18 or older.</p>
<h2>Risk</h2>
<p>Stocks can lose value, and tokenized stocks carry extra risks: smart contracts, price feeds, pool liquidity and transfer rules set by the issuer. Swaps have a 1% slippage cap but you may receive less than the quoted amount within that cap. Only use money you can afford to lose.</p>
<h2>Prizes</h2>
<p>Prizes are funded by the sponsor, not by players. There is no entry fee and no stake. Winners are the top performers in each tier as published in the weekly results file, whose hash is recorded onchain. To be eligible, a wallet must be linked to one Telegram account, and during the first two weeks the organiser checks that winners are different people. The organiser may withhold a prize for abuse (for example several wallets run by one person).</p>
<h2>Your data</h2>
<p>We store your wallet addresses and, if you link it, your Telegram user ID and username, only to run the league and check prize eligibility. Everything you do onchain is public by nature.</p>
<h2>Changes and pauses</h2>
<p>Trading in the app can be paused at any time, for example if a rule changes. You can always sell from your own wallet. These terms may change; the version date above shows the current one.</p>
</section><p class="small"><a href="/rules">The short version</a></p>`,
  });
}
