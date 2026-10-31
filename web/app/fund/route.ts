import QRCode from "qrcode";
import { getSession } from "@/lib/session";
import { getLang } from "@/lib/lang";
import { t } from "@/lib/copy";
import { html, raw } from "@/lib/html";
import { page } from "@/views/layout";
import { proof } from "@/views/parts";
import { ADDR } from "@btb/shared/chain";

export const dynamic = "force-dynamic";

export async function GET() {
  const [session, lang] = await Promise.all([getSession(), getLang()]);
  const qr = session ? await QRCode.toString(session.wallet, { type: "svg", margin: 0, errorCorrectionLevel: "M" }) : null;
  return page({
    lang,
    path: "/fund",
    title: t(lang, "fund_title"),
    scripts: session ? ["fund.js"] : [],
    body: html`<h1>${t(lang, "fund_title")}</h1>
<p>You need USDC on the <b>Base</b> network. $5 to $20 is plenty. You don't need ETH: gas is covered.</p>
${session ? html`<section class="card"><div class="small muted">${t(lang, "your_wallet")}</div>
<p class="addr" style="font-size:1rem">${session.wallet}${proof({ address: session.wallet })}</p>
<div class="qr">${raw(qr!)}</div>
<div style="margin-top:12px"><button class="btn block" id="copy-btn" data-copy="${session.wallet}">Copy address</button></div>
<p class="small muted">${t(lang, "your_wallet_note")}</p></section>` : html`<p class="notice"><a href="/trade">Sign in</a> first and your wallet address appears here, with a QR code.</p>`}
<section class="card"><h2 style="margin-top:0">Send USDC from an app you already use</h2><ol class="steps">
<li>Open the app or exchange where you have USDC (or buy some there).</li>
<li>Tap <b>Withdraw</b> or <b>Send</b>, then choose <b>USDC</b>.</li>
<li>For the network, choose <b>Base</b>. <b>If Base is not in the list, stop:</b> that app can't send to Base yet. Choosing any other network means the money does not arrive.</li>
<li>Paste your league wallet address (or scan the QR code above).</li>
<li>Send <b>$1 first</b>. When it shows up here (usually within a minute), send the rest.</li>
</ol><p class="small muted">The token you receive must be USDC on Base, contract <span class="addr">${ADDR.USDC}</span>${proof({ token: ADDR.USDC })}.</p></section>
<section class="card"><h2 style="margin-top:0">Other ways</h2><ul>
<li><b>From a friend</b> who already has USDC on Base: give them your address or QR code.</li>
<li><b>From the Coinbase or Base app:</b> send USDC and pick Base as the network.</li>
</ul><p class="small muted">The app never holds your money and never asks for your seed phrase, password or card. Nobody from Beat the Bot will ever DM you to ask for money.</p></section>
<a class="btn block" href="/trade">Back to trading</a>`,
  });
}
