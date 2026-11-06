# Launch checklist

Status as of 6 Nov 2026. "Built" means the code is in this repo and tested locally; "verified live" means checked against Base mainnet or a deployed site. The league runs on the $0 path by default (contracts on Base Sepolia, see the [runbook](runbook.md)); rows that only apply to the funded path say so.

## The ten details

| # | Detail | Status | Evidence / what is left |
|---|---|---|---|
| 1 | First screen to first trade in under two minutes on a throttled connection | Built; timed test pending | `/trade` first load is 8.5 KB gzipped (budget 150 KB); the wallet library (236 KB) loads in idle time before the tap. The timed run needs a fresh passkey account holding USDC on the deployed site. |
| 2 | Every number has an explorer link next to it | Built | Prices link to their Chainlink feed, values to the wallet, trades to the transaction (Basescan), picks and agent entries to their lock or entry on the league chain's explorer, prizes to the fund and settle transactions, results to the published file and its hash. |
| 3 | Bot pages read like a trading card | Built | Strategy in one sentence, return since start, best and worst week, this week's picks and reasoning, ERC-8004 identity and agent card; funded bots also show the NAV chart, holdings and every trade. |
| 4 | Weekly results message, English and Pidgin, same minute every Friday | English built; Pidgin pending | The 5-minute scheduler scores at close + 5 minutes and posts at close + 30 minutes (22:30 WAT through March), always on a 5-minute mark. Pidgin lines go in `bot-telegram/src/pidgin.ts`. |
| 5 | "Beat the bot" shows the moment a human beats one | Built | The live table marks the badge from hourly snapshots and latest prices; the final table from the results file. |
| 6 | Good empty states | Built | e.g. "No bots have traded yet this week; the market opens at 15:30 WAT." |
| 7 | Funding instructions a first-timer in Lagos can follow | Built; one check left | Generic "choose Base as the network or stop" steps with QR and copy button. Named local exchanges are left out until someone confirms they list USDC on Base. |
| 8 | Selling is as easy as buying | Built | "Sell half" and "Sell all" on every holding, one confirm. The kill switch never blocks selling. |
| 9 | One rules page under 300 words that answers "is this betting?" | Built | `/rules` is about 225 words and opens with that question. |
| 10 | Zero wallet pop-ups after the passkey | Built; live check pending | Sign-in creates an app sub-account in the same passkey prompt; its browser key signs every trade (`funding: 'manual'` so no spend-permission prompt); gas via the paymaster proxy. Verified by reading the SDK source; confirm with the first real account. |

## Done-when criteria

| Criterion | Status |
|---|---|
| Contract tests green | 40 Foundry tests (unit, fuzz, invariant, signed entries and picks) plus 3 Base fork tests pass |
| B20 hold-and-send result known | Passed on Base mainnet via `eth_simulateV1`: a contract can hold and send tokenized stocks. Week 1 prizes can be stock. |
| Chain facts verified | `pnpm verify:chain`: 67/67 live checks (the Coinbase listing check needs api.coinbase.com reachable) |
| Scoring dry run matches a hand calculation | `scoring/test/score.test.ts`, 11 tests, including a week where bots and agents compete on picks |
| Gasless agent entry and picks | `indexer/test/anvil.test.ts`: an agent wallet that never sends a transaction joins and locks picks by signature; the indexer records both |
| Public repo | Done: github.com/0xkenichi/beat-the-bot |
| Contracts deployed and verified | Waiting on Kenichi's Base Sepolia deploy (faucet gas, Blockscout verification, no key needed) |
| Bots locking weekly picks with the Builder Code | Waiting on Builder Code, faucet gas and keys (funded path: trading on mainnet) |
| Fresh passkey account buys $1 with no ETH in under two minutes | Waiting on the deployed site and paymaster |
| Paper lock from a fresh account | Waiting on the PickBook deploy |
| Telegram bot posting the table | Waiting on the bot token and group |
| Week 1 universe set, ten friends with Telegram links playing (free, or $1–5) | Waiting on the steps above. Prizes: funded path only |

## Performance (gzipped first load, local production build)

| Page | Size |
|---|---|
| `/` | 2.8 KB |
| `/play` | 2.6 KB (about 6 KB when entries are open and the picker script loads) |
| `/trade` | 8.5 KB |
| Wallet library, loaded after the page | 236 KB |
