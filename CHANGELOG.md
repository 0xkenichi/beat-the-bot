# Changelog

A dated record of what was built and shipped, kept for the Stocks Maxxing final submission, which asks what was built during the Quest period (5 Nov – 5 Dec 2026). Dates are WAT. Commit links point to github.com/0xkenichi/beat-the-bot.

## Quest period: 5 Nov – 5 Dec 2026

### 2026-11-06
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
