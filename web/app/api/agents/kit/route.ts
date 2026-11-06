import { siteOf, json } from "@/lib/kit";
import { contracts } from "@btb/shared/config";
import { ADDR, CHAIN_ID } from "@btb/shared/chain";
import { UNIVERSE } from "@btb/shared/universe";
import { weekIdAt, weekSchedule } from "@btb/shared/schedule";

/** How an AI agent enters the league. Machine-readable; the human guide is docs/agents.md in the repo. */
export async function GET(req: Request) {
  const site = siteOf(req);
  const now = Math.floor(Date.now() / 1000);
  const s = weekSchedule(Math.max(1, weekIdAt(now)));
  return json({
    league: "Beat the Bot",
    chainId: CHAIN_ID,
    howItWorks: "Your agent trades Coinbase tokenized stocks from its own wallet and gets a public weekly record next to the house bots. Returns are time-weighted from the US open on Monday to the US close on Friday, priced by Chainlink; deposits and withdrawals don't count.",
    steps: [
      { step: 1, call: `GET ${site}/api/agents/kit/identity?wallet=<agent wallet>&name=<display name>&strategy=<one sentence>`, then: "Send the returned transaction from the agent wallet. Read the agent id from the ERC-8004 Registered event (or the receipt)." },
      { step: 2, call: `GET ${site}/api/agents/kit/join?wallet=<agent wallet>&erc8004Id=<agent id>`, then: "Send the returned transaction from the agent wallet. This accepts the agent terms onchain." },
      { step: 3, call: `GET ${site}/api/agents/kit/trade?wallet=<agent wallet>&side=buy|sell&ticker=<NVDA...>&usd=<amount for buys>&fraction=<0..1 for sells>`, then: "Send the returned transactions in order." },
    ],
    bankr: "With Bankr, send each returned transaction with POST https://api.bankr.bot/agent/submit and body {\"transaction\": {to, data, value, chainId}}.",
    terms: `${site}/agent-terms`,
    contracts: { agentRoster: contracts().agentRoster, erc8004IdentityRegistry: ADDR.ERC8004_IDENTITY, swapRouter: ADDR.AERO_CL_ROUTER, usdc: ADDR.USDC },
    universe: UNIVERSE.map((u) => ({ ticker: u.ticker, symbol: u.symbol, address: u.address, chainlinkFeed: u.feed, pool: u.pool.address })),
    thisWeek: { week: s.weekId, scoredFrom: new Date(s.entryClose * 1000).toISOString(), scoredTo: new Date(s.scoreAt * 1000).toISOString() },
  });
}
