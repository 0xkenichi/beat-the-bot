# Changelog

A dated record of what was built and shipped, kept for the Stocks Maxxing final submission, which asks what was built during the Quest period (5 Nov – 5 Dec 2026). Dates are WAT. Commit links point to github.com/0xkenichi/beat-the-bot.

## Quest period: 5 Nov – 5 Dec 2026

### 2026-11-06
- **The season starts when the league does.** Week 1 now follows `genesis` in `shared/src/deployments.json` instead of a fixed 9 Nov. `pnpm admin season` sets it to the coming Monday (or `--start 2026-11-16`) before the deploy, and the runbook's deploy command passes the same date to the prize contract, so a launch after 9 Nov opens on week 1, not week 2. It refuses once a prize contract is deployed.
- **Dress rehearsal: `pnpm rehearse`** ([`47c1488`](https://github.com/0xkenichi/beat-the-bot/commit/47c1488)). Runs the whole $0 setup on a local fork of Base Sepolia with throwaway keys: the runbook's forge deploy and admin commands, three bot identities, an outside agent joining and picking by signature through the site's routes, and the scheduler before and after Monday's entries open. It then checks the database, the pages and the Builder Code on every transaction. First full pass on 6 Nov: deploy cost 0.0000283 ETH (under one faucet claim), all three bots and the agent locked week 1 picks, the agent sent no transaction after its identity, and the Builder Code was on 5 of 5 pick transactions. It never reads `.env` and writes only to a temporary folder.
- Fixed, found while building the rehearsal: picks signed before a week opened were submitted at once, refused by `PickBook` and marked failed for good. They now wait for their entry window. Relayed picks also now check the transaction actually succeeded.
- Agent pages show the bots' notes before the season starts, and the outside-agent text matches the $0 path (agents pick, and may trade).
- **Zero-cost league ($0 path), now the default** ([`9fedbce`](https://github.com/0xkenichi/beat-the-bot/commit/9fedbce)). The league's contracts can run on Base Sepolia while stocks, Chainlink prices and real-money swaps stay on Base mainnet; the contracts' chain is configured on its own (`contractsChain` in `shared/src/deployments.json`, or `CONTRACTS_CHAIN_ID`). Deploying costs only faucet gas and verifies on Blockscout without a key. The [runbook](docs/runbook.md) starts with this path and keeps the funded mainnet path as an optional section.
- **Agents join and pick by signature.** `AgentRoster.registerFor` accepts an agent's EIP-712 signed entry, relayed by the league's registrar, with the agent's ERC-8004 identity on Base recorded alongside. New kit routes: `/api/agents/kit/join-signed`, `/pick-signed` (both check the signature before accepting) and `/pick`; the scheduler submits signed entries and picks every 5 minutes. Bankr agents, which only transact on Base, now enter and pick with no other gas: `scripts/agents/bankr-enter.ts --pick NVDA:50,TSLA:30,MSFT:20`.
- **House bots lock weekly picks** when the contracts are on Base Sepolia: each bot runs its strategy on live Base prices and locks its top three in `PickBook` with the Builder Code, one bot per scheduler call on Monday morning. Bots and agents that compete on picks rank together in the bots tier; agents still can't win prizes.
- Indexer, scoring, admin commands, pages and the Telegram copy follow the league chain: explorer links point to the right chain, `pnpm admin status` shows balances on both chains, and the home page and Monday post say the bots pick (rather than trade) when that is what they do.
- Tests: an agent wallet that never sends a transaction joins and locks picks on a local chain, checked through the indexer; a scoring week where bots and agents compete on picks, checked by hand calculation.
- Started this changelog and the season plan ([docs/plans/stocks-maxxing.md](docs/plans/stocks-maxxing.md)): traction first, AI agents from Bankr as contestants, and a zero-cost testnet fallback.
- **Agent entry kit** ([`f0a7f34`](https://github.com/0xkenichi/beat-the-bot/commit/f0a7f34)): any AI agent can join the league from its own wallet. `/api/agents/kit` explains the steps; `/identity` prepares an ERC-8004 registration (the league hosts the agent card), `/join` checks the identity belongs to the wallet and prepares the `AgentRoster` entry, `/trade` prepares exact-quoted swaps of the week's stocks back into the agent's wallet. Every prepared transaction carries the league's Builder Code.
- **Bankr agents as contestants:** `scripts/agents/bankr-enter.ts` enters a Bankr agent end to end through Bankr's agent API (`/agent/sign` to find its wallet, `/agent/submit` to send each step), with the operator's own key. Guide: [docs/agents.md](docs/agents.md).
- The indexer now reads `AgentRoster` registrations and moderation into the league's agents, so entered agents get snapshots, a live table row, an agent page and scoring automatically. Agent pages show whether an agent is a house bot or entered by an outside builder.
- `/agent-terms` shows the agent terms, generated at build time from the same file whose hash `AgentRoster` stores (verified identical).
- **House bots work from $5** ([`d95ee94`](https://github.com/0xkenichi/beat-the-bot/commit/d95ee94)): the minimum trade is now $0.25 (Base gas is under a cent), so a $5 bot holds all ten stocks; checked live: a $0.47 slice of the priciest stock round-trips for 0.4%.
- **Share cards:** 1200x630 images for each week (`/api/og/week/[n]`), each bot or agent (`/api/og/agent/[id]`) and each player's week (`/api/og/player/[wallet]`), set as the preview image of their pages. New share page `/p/[wallet]` with a one-tap X post; the Friday personal message links to it.
- **Launch kit** ([docs/launch/kit.md](docs/launch/kit.md)): X profile, dated posts for each milestone, a two-minute demo script and draft answers for the final submission form.
- `scripts/demo-seed.ts` fills a local database with made-up data for previews; it refuses to touch a real database.
- **Indexer end-to-end test:** a local Anvil chain runs the real `PickBook` and `AgentRoster`; the test locks picks, registers and moderates an agent, and checks the indexer's database rows. It found and fixed a start-block bug on fresh chains (a negative block number).

## Before the Quest period (pre-existing code)

Everything below was built between 31 Oct and 2 Nov 2026, before the Quest opened. Baseline commit: [`7e4a313`](https://github.com/0xkenichi/beat-the-bot/commit/7e4a313).

### 2026-11-02
- CI made manual-only while GitHub Actions is unavailable on the account ([`7e4a313`](https://github.com/0xkenichi/beat-the-bot/commit/7e4a313)).

### 2026-11-01
- Scheduler moved to a protected `/api/cron/tick` route called by an external cron every 5 minutes; tick, settlement and bot logic made reusable ([`c11ea4a`](https://github.com/0xkenichi/beat-the-bot/commit/c11ea4a), [`29dccf4`](https://github.com/0xkenichi/beat-the-bot/commit/29dccf4)).

### 2026-10-31
- Contracts `PickBook`, `PrizePool` and `AgentRoster` with unit, fuzz, invariant and Base fork tests; live `eth_simulateV1` test showing a contract can hold and send B20 tokenized stocks ([`fec0e1f`](https://github.com/0xkenichi/beat-the-bot/commit/fec0e1f)).
- Shared core (calendar, Chainlink cutoff prices, scoring, Builder Code suffix, swap quotes) and the three house bots ([`ee4e6d1`](https://github.com/0xkenichi/beat-the-bot/commit/ee4e6d1)).
- Web app (passkey sign-in, sponsored swaps, free play, bot pages, results), indexer, scoring job and Telegram bot ([`a544cc0`](https://github.com/0xkenichi/beat-the-bot/commit/a544cc0)).
- Admin CLI, deploy script, live chain checks and docs ([`ddb19f8`](https://github.com/0xkenichi/beat-the-bot/commit/ddb19f8)).
