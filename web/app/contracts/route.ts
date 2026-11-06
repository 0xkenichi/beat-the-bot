import { getLang } from "@/lib/lang";
import { html } from "@/lib/html";
import { page } from "@/views/layout";
import { proof } from "@/views/parts";
import { contracts, DEPLOYMENTS } from "@btb/shared/config";
import { ADDR, CHAINS } from "@btb/shared/chain";
import { UNIVERSE } from "@btb/shared/universe";

export async function GET() {
  const c = contracts();
  const rows: [string, string | null, string][] = [
    ["PickBook", c.pickBook, "Free-play picks, locked onchain. Holds no money."],
    ["PrizePool", c.prizePool, "Holds only the sponsor's weekly prizes and pays winners."],
    ["AgentRoster", c.agentRoster, "Registered AI agents with their ERC-8004 identities."],
  ];
  return page({
    lang: await getLang(),
    path: "/contracts",
    title: "Contracts",
    body: html`<h1>Contracts and sources</h1><section class="card">
<p class="small muted" style="margin-top:0">The league's contracts are on ${CHAINS[c.chainId].name}${c.chainId === 84532 ? ", a free test network, so running the league costs nothing" : ""}. Stocks, USDC, swaps and prices are on Base.</p>
${rows.map(([name, addr, what]) => html`<div style="padding:8px 0;border-bottom:1px solid var(--line)"><b>${name}</b> ${addr ? html`<span class="addr small">${addr}</span>${proof({ address: addr, chain: c.chainId })}` : html`<span class="tag">not deployed yet</span>`}<div class="small muted">${what}</div></div>`)}
<p class="small muted">Source code is public and verified. Builder Code: ${DEPLOYMENTS.builderCode ?? "pending"}.</p></section>
<section class="card small"><h2 style="margin-top:0">What the app trades through</h2>
<p>USDC${proof({ token: ADDR.USDC })} · Swap router${proof({ address: ADDR.AERO_CL_ROUTER })} · ERC-8004 identity registry${proof({ address: c.erc8004Identity, chain: c.chainId })}</p>
<table><thead><tr><th>Stock</th><th>Token</th><th>Pool</th><th>Price feed</th></tr></thead><tbody>
${UNIVERSE.map((u) => html`<tr><td><b>${u.ticker}</b></td><td>${proof({ token: u.address, label: u.symbol })}</td><td>${proof({ address: u.pool.address, label: "pool" })}</td><td>${proof({ address: u.feed, label: "Chainlink" })}</td></tr>`)}
</tbody></table></section>`,
  });
}
