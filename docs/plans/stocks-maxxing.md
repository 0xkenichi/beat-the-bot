# Stocks Maxxing season plan (6 Nov – 5 Dec 2026)

Track: Agentic Stock Finance. **Submissions close Sat 5 Dec, 11:59 pm UTC (00:59 WAT Sun 6 Dec).** Judging, per Base's announcement: 50% traction verified onchain, 25% product, 25% build in public. Everything built from 5 Nov goes in [CHANGELOG.md](../../CHANGELOG.md) with its date.

## 0. What the rules require (checked 13 Nov)

Sources: [base.org/stocksmaxxing](https://www.base.org/stocksmaxxing) with its FAQ and the Agentic Stock Finance track section, the [Official Rules](https://www.base.org/stocksmaxxing/rules), Base Build's article "Stocks Maxxing: Ideas to Build" (x.com/buildonbase/status/2120841565950062839, 12 Nov), [Bankr's partner page](https://melodic-spandex-01b.notion.site/Bankr-Stocks-Maxxing-40ef95a255db8027866ad73cffdd8506) and Bankr's 13 Nov post listing Beat the Bot (x.com/bankrbot/status/2121323533972504600).

**To enter (all three, during the Quest Period):**
1. A public X post with a video demo (Loom or a screen recording) explaining how it works, tagging **@buildonbase**.
2. The Submission Form linked on the Quest Page: the X post link, the track, and a clear description of what was built during the Quest Period (5 Nov – 5 Dec). Registering earlier is not required; the 6 Nov application doesn't count as a submission. The form isn't linked yet; watch the Quest Page.
3. Anything the track section adds. Agentic Stock Finance adds no hard requirements, only example ideas.

**The submission must:**
- be built on or meaningfully integrate with Base, and fit the track. Ours: Coinbase tokenized stocks, Chainlink prices and swaps on Base; picks and the agent roster on Base Sepolia. **Testnet is allowed and "will not be judged less favorably".**
- clearly separate pre-existing work (31 Oct – 4 Nov, baseline `7e4a313`) from work done in the Quest Period (the dated changelog);
- comply with securities, gaming and other law, and **not enable trading for US users**. We block US persons at sign-in.
- not misrepresent any relationship with Base, a partner, the stock issuers or the companies, and not claim shareholder rights such as voting;
- come from one identity throughout. Submissions "through multiple accounts, or identities other than the Entrant's own" are void.

**Disqualification risks to avoid:** "manipulating engagement or traction metrics". The demo data (made-up players, the agent "Atlas") must never appear as traction; only real wallets count.

**Prizes:**
- Agentic Stock Finance Base pool: **$20,000** (Base-track prizes total $50,000).
- Bankr: a **$3,000** pool across its three tracks, $100 in LLM credits for top projects, office hours, marketing ("Agent Hour" features) and intros. No token launch is required.
- BaseStonk: creator fees from launching a token on BaseStonk. Beat the Bot has no token by design, so it's a community partner only.
- **Build-in-public award: $6,000, community-voted.** Share the journey on X through the season and tag @buildonbase.
- Partner winners are judged on the same criteria, and a project can win a Base prize and a partner prize.
- Winners must verify identity (18+, not in an OFAC-sanctioned country; Nigeria is fine) and respond within 7 days.

**What the ideas article asks agent projects to show** (each idea comes with a "Show us" flow):
- 2.1 agents that earn their stock treasury, via x402;
- 2.2 research-to-portfolio agents: a sourced proposal, an approval, and a constraint the agent refuses to break;
- 2.3 stock-backed working capital.

The track card also lists "agent-managed rebalancing". Our demo should show our own version of that pattern: each bot's weekly decision with its reasons and the rules it won't break (only the week's stocks, at most 50% in one name), an outside agent joining and picking by signature, and Friday's Chainlink close settling it.

## 1. Priority: get it live and used

Traction is half the score, so deploying and getting real players beats new features. The order:

1. Deploy (Kenichi's accounts and keys, [runbook](../runbook.md)): Builder Code, contracts, the two Vercel projects, database, paymaster, the cron, Telegram.
2. House bots locking their weekly picks with the Builder Code, so the league has activity from day one (trading on mainnet once funded).
3. Open agent entry (section 2) and invite Bankr builders in the partner group.
4. Weekly cycle running every week to 5 Dec, with dated posts from @0xKenichi tagging @buildonbase (section 4).

## 2. Season feature: AI agents enter as contestants (Bankr first)

Any AI agent can enter the league from its own wallet and get a public weekly record next to the house bots. Bankr agents can do it with no code on Bankr's side, because Bankr's agent API sends raw transactions from the agent's wallet (`POST https://api.bankr.bot/agent/submit` with `{to, data, value, chainId: 8453}`, per BankrBot/claude-plugins).

**How an agent enters**

| Step | Our API returns | The agent sends |
|---|---|---|
| 1. Identity | `GET /api/agents/kit/identity?wallet=&name=&strategy=` → an ERC-8004 `register(agentURI)` transaction; the agent card is hosted at `/agents/w/<wallet>/card.json` | via Bankr `/agent/submit` (or any wallet) |
| 2. Join | `GET /api/agents/kit/join-signed?wallet=&erc8004Id=&identityChain=8453` → EIP-712 entry, after checking the identity belongs to the wallet; the resolver submits `AgentRoster.registerFor` | a signature via Bankr `/agent/sign` |
| 3. Pick, weekly | `GET /api/agents/kit/pick-signed?wallet=&picks=NVDA:50,TSLA:30,MSFT:20` → EIP-712 lock; the resolver submits `PickBook.lockFor` | a signature |
| Trade (optional) | `GET /api/agents/kit/trade?wallet=&side=&token=&usd=` → exact-quoted approve + swap, 1% floor, output to the agent's own wallet | each transaction on Base, in order |

Agents that send transactions on the league chain use `/join` and `/pick` instead (same steps, sent from their own wallet).

Every transaction the kit returns already carries the app's Builder Code, so agent registrations and trades count on base.dev. Agents can also trade any other way; scoring reads their wallet (time-weighted, deposits excluded), so only trades through the kit carry the Builder Code.

**On our side:** the indexer reads `AgentRoster` registrations into the agents table; snapshots, the live table, agent pages and scoring then include the agent automatically. A guide (`docs/agents.md`) and a ready script for Bankr operators (`scripts/agents/bankr-enter.ts`, their own Bankr API key) make it a five-minute job.

**Rules for agents** are in [agent-terms.md](../legal/agent-terms.md), accepted onchain at registration: the operator is not a US person, own wallet and own money, no manipulation, agents compete for the record, prizes go to people.

## 3. Zero-cost fallback

If the mainnet deploy can't be funded, the Quest rules allow a testnet without penalty. Checked on 6 Nov:

| On Base Sepolia (84532) | Status |
|---|---|
| ERC-8004 identity registry `0x8004A818…BD9e` | present ("AgentIdentity") |
| B20 policy registry precompile | present |
| Coinbase tokenized stocks and their Chainlink feeds | not present (mainnet only) |
| USDC `0x036C…CF7e` | present |

So the fallback is: `PickBook`, `AgentRoster` and `PrizePool` on Base Sepolia (faucet gas), free play and agent entry there, scored with mainnet Chainlink prices (reading them costs nothing), and real-money trading staying on mainnet with the players' own USDC and paymaster-sponsored gas. House bots lock weekly picks on Sepolia instead of trading real money.

**Built 6 Nov and now the default** (mainnet funding is ruled out for now). The contracts' chain is configured separately from the trading chain; Bankr agents, which only transact on Base, join and pick by signature and the resolver submits for them. The [runbook](../runbook.md) starts with this path; the funded path is an optional section.

## 4. Build in public

- **Which account (decision, 13 Nov):** post the submission and the build-in-public updates from **@0xKenichi**. The rules require one identity throughout, and Bankr already lists the project as "Beat the Bot by @0xKenichi". The $6K award and the 25% build-in-public score both depend on tagging @buildonbase, so these posts are an exception to the lane's no-tags rule. A project account can repost them; it should not be the entrant.
- A dated post each time something ships, with an explorer link: site live, contracts live, first bot picks, first human pick, first real-money buy, first outside agent, each Friday's results.
- The December demo video and post tag @buildonbase, and the submission form lists the Quest-period entries from the changelog.

## 5. Dated launch plan (from 13 Nov)

Week 1 is the first Monday after `pnpm launch` runs. If Kenichi's sign-ins land by **Sun 15 Nov**, the season has three scored weeks before the deadline. If they slip to the following week, it has two (week 1 then starts Mon 23 Nov).

| Date (WAT) | What | Who |
|---|---|---|
| **Fri 13 Nov** | Build window opens. New look shipped. Site deploy on his own Vercel scope, waiting on his 2FA | Kenichi: Vercel 2FA |
| Fri 13 – Sat 14 Nov | Neon database and site URL on Vercel. Base Dashboard (Builder Code). CDP login: seven faucet claims, both paymasters. `pnpm admin new-wallets --with-owner`. `SESSION_SECRET` typed into Vercel | Kenichi: logins and two commands; Claude: Vercel env and Neon in Chrome |
| **Sun 15 Nov** | `pnpm admin season` (sets Mon 16 Nov), then `pnpm launch --check` and `pnpm launch`. Commit deployments.json. cron-job.org every 5 min. Telegram bot via BotFather. First post: site and contracts live | Kenichi runs launch, cron-job.org and BotFather; Claude: everything after |
| Sun 15 Nov | Invite agents: post in the Bankr and BaseStonk groups. Message the agent teams on Bankr's list (portfolio agents like MetraxiaHQ and MAXXAGENT, loopersdao's swarms) to enter their agents as contestants: a public weekly benchmark for their agent | Claude drafts and sends from Kenichi's accounts |
| **Mon 16 Nov 01:00** | Week 1 opens. Bots lock their picks by about 01:20 | automatic |
| Mon 16 Nov 06:00 | "Week 1 is open" posts in the league group and on X (tag @buildonbase) | automatic / Claude |
| Mon 16 Nov 15:30 | Entries close at the US open | automatic |
| Fri 20 Nov 22:00 | Week 1 scored; results posted at 22:30 with share cards | automatic; Claude posts on X |
| Mon 23 Nov | Week 2 opens (US Thanksgiving week). Entries close 15:30 | automatic |
| **Fri 27 Nov 19:00** | Week 2 scored early: Thursday closed, Friday early close. Results posted 19:30 | automatic |
| Mon 30 Nov | Week 3 opens; entries close 15:30 | automatic |
| Thu 3 Dec | Record the demo on the live site (about 2 min, following [the launch kit's demo script](../launch/kit.md)). Voice: Kenichi's own, or ElevenLabs Victor Hopo if credits allow. Draft the X post and the form answers, with traction figures from `/api/metrics` and the explorers | Claude records and drafts; Kenichi approves |
| Fri 4 Dec 22:00 | Week 3 scored, results posted 22:30. Final numbers go into the form | automatic |
| **Sat 5 Dec, midday** | Publish the demo post from @0xKenichi tagging @buildonbase, then submit the form with the post link, the track and the changelog's Quest-period entries. Leaves more than 12 hours of buffer | Kenichi approves; Claude submits |
| Sun 6 Dec 00:59 | Hard deadline (5 Dec 23:59 UTC) | |

**Traction targets** (real wallets only; testnet picks count as onchain activity):

| Metric | Target by 4 Dec |
|---|---|
| Players with at least one onchain pick | 30 |
| Real-money buys on Base with the Builder Code (if the mainnet paymaster is on) | 10 |
| Outside agents entered | 3, at least 1 a Bankr agent |
| Weeks scored, with results posted | 3 (2 if launch slips) |
| Build-in-public posts tagging @buildonbase | 2 a week |

**Where players come from:** Kenichi's Lagos network and Telegram, the two partner groups, the league's own Telegram group, X posts on each Friday's results, and the agent teams in Bankr's list. They get a public weekly record for their agent next to ours.

**Product work in the window, in priority order** (only after launch is done):
1. Fix anything real players hit in week 1.
2. Steady's weekly note separates the price facts it used from the model's opinion: the research-to-portfolio "show us" in miniature.
3. A one-page "agent leaderboard" view for agent teams to link to.
4. Stretch, only if traction is on track: house bots sell their weekly picks to other agents over x402, the article's idea 2.1. It brings in money flows, so it needs Kenichi's call first.
