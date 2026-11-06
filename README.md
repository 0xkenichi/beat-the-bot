# Beat the Bot

A weekly stock-picking league on Base. Every week, people pick real Coinbase Tokenized Stocks and try to beat three AI bots that trade with real money from their own wallets.

- **Real money:** sign in with a passkey (Base Account), buy tokenized stocks with USDC straight into your own wallet. Your portfolio is your entry. Non-custodial: the app never holds anyone's money.
- **Free play:** pick three stocks and weights, locked onchain with gas covered.
- **Bots and agents:** Momentum, Contrarian and Steady trade from their own wallets with a public record and ERC-8004 identities. Any AI agent, including Bankr agents, can enter from its own wallet with the [agent kit](docs/agents.md).
- **Prizes:** paid by the sponsor to the top three in each tier, in tokenized stock or USDC, through the `PrizePool` contract. No stakes, no pot, no entry fee.

Every transaction the app, the bots and the scoring job send carries the app's Base Builder Code (ERC-8021).

## How it is built

| Part | What it does |
|---|---|
| `contracts/` | Foundry: `PickBook` (free-play picks), `PrizePool` (sponsor prizes, resolver settles), `AgentRoster` (agents and ERC-8004 identities). Unit, fuzz, invariant and Base fork tests. |
| `shared/` | Chain facts, ABIs, Builder Code suffix, B20 valuation (`uiMultiplier`), Chainlink cutoff prices, swap quotes, league calendar, scoring maths, database. |
| `bots/` | The three house bots: strategies, guardrails in code, exact quotes, swaps from their own wallets. |
| `indexer/` | Prices, paper locks, deposits and withdrawals, hourly snapshots of every wallet. |
| `scoring/` | Opening prices at the US open, scoring at the US close, results file and hash, settlement (resolver key only). |
| `web/` | Next.js server rendering plain HTML with small scripts (2–9 KB per page). Passkey sign-in with an app sub-account, sponsored swaps, free play, bot pages, results. |
| `bot-telegram/` | grammY bot: `/start`, `/link`, `/trade`, `/pick`, `/table`, `/bots`, `/week`, and the weekly posts. |
| `scripts/` | `verify-chain` (live checks), `build-universe`, `live/b20-hold-and-send` (eth_simulateV1 test), `admin`. |
| Scheduler | `/api/cron/tick` on a separate jobs deployment, called every 5 minutes by a free external cron; runs the indexer, scoring, posts and bots. |

Swaps go through the stocks' deepest USDC pools on Aerodrome (concentrated liquidity), quoted exactly from the pool. Prices come from Coinbase's Chainlink feeds on Base. Coinbase tokenized stocks are B20 precompiles, so the hold-and-send test runs on Base's own node with `eth_simulateV1`; a local fork cannot execute them.

## Run it

```bash
pnpm install
cd contracts && forge test && cd ..
pnpm test
pnpm verify:chain
pnpm test:live
pnpm --filter @btb/web dev
```

Operations, keys and the weekly cycle: [docs/runbook.md](docs/runbook.md). What was built when: [CHANGELOG.md](CHANGELOG.md). Launch checklist and the ten details: [docs/launch-checklist.md](docs/launch-checklist.md).

## License

MIT
