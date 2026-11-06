# Stocks Maxxing season plan (6 Nov – 5 Dec 2026)

Track: Agentic Stock Finance. Final submission by Sat 5 Dec, 11:59 pm EST (05:59 WAT Sun 6 Dec). Judging, as briefed: 50% onchain traction, 25% product, 25% build in public. Everything built from 5 Nov goes in [CHANGELOG.md](../../CHANGELOG.md) with its date.

## 1. Priority: get it live and used

Traction is half the score, so deploying and getting real players beats new features. The order:

1. Deploy (Kenichi's accounts and keys, [runbook](../runbook.md)): Builder Code, contracts, the two Vercel projects, database, paymaster, the cron, Telegram.
2. House bots locking their weekly picks with the Builder Code, so the league has activity from day one (trading on mainnet once funded).
3. Open agent entry (section 2) and invite Bankr builders in the partner group.
4. Weekly cycle running every week to 5 Dec, with dated posts from the project's own X account.

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

- The project gets its own X account (Kenichi's signup); @0xKenichi stays on its own lane.
- A dated post each time something ships, with a Basescan link: deploy, first bot trade, first human trade, first agent entry, each Friday's results.
- The December demo video and post tag @buildonbase, and the submission form lists the Quest-period entries from the changelog.

## 5. Dates

| When | What |
|---|---|
| 6–13 Nov | Brainstorm week: join the Bankr and Base Stonk groups, post the intro; build the agent kit |
| 13 Nov | Build-and-launch window opens: deploy, bots live, first public post |
| Weekly from the first live Monday | League week runs; Friday results post; changelog and X update |
| By 5 Dec | Demo video, X post tagging @buildonbase, final Submission Form |
