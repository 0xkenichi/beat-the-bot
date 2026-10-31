# Launch checklist

Status as of 31 Oct 2026. "Built" means the code is in this repo and tested locally; "verified live" means checked against Base mainnet or a deployed site.

## The ten details

| # | Detail | Status | Evidence / what is left |
|---|---|---|---|
| 1 | First screen to first trade in under two minutes on a throttled connection | Built; timed test pending | `/trade` first load is 8.5 KB gzipped (budget 150 KB); the wallet library (236 KB) loads in idle time before the tap. The timed run needs a fresh passkey account holding USDC on the deployed site. |
| 2 | Every number has a Basescan link next to it | Built | Prices link to their Chainlink feed, values to the wallet, trades to the transaction, picks to the lock, prizes to the fund and settle transactions, results to the published file and its onchain hash. |
| 3 | Bot pages read like a trading card | Built | Strategy in one sentence, return since start, best and worst week, NAV chart, this week's reasoning, holdings, every trade, ERC-8004 identity and agent card. |
| 4 | Weekly results message, English and Pidgin, same minute every Friday | English built; Pidgin pending | `results` workflow starts 45 minutes early and posts at close + 30 minutes (22:30 WAT through March). Pidgin lines go in `bot-telegram/src/pidgin.ts`. |
| 5 | "Beat the bot" shows the moment a human beats one | Built | The live table marks the badge from hourly snapshots and latest prices; the final table from the results file. |
| 6 | Good empty states | Built | e.g. "No bots have traded yet this week; the market opens at 15:30 WAT." |
| 7 | Funding instructions a first-timer in Lagos can follow | Built; one check left | Generic "choose Base as the network or stop" steps with QR and copy button. Named local exchanges are left out until someone confirms they list USDC on Base. |
| 8 | Selling is as easy as buying | Built | "Sell half" and "Sell all" on every holding, one confirm. The kill switch never blocks selling. |
| 9 | One rules page under 300 words that answers "is this betting?" | Built | `/rules` is about 225 words and opens with that question. |
| 10 | Zero wallet pop-ups after the passkey | Built; live check pending | Sign-in creates an app sub-account in the same passkey prompt; its browser key signs every trade (`funding: 'manual'` so no spend-permission prompt); gas via the paymaster proxy. Verified by reading the SDK source; confirm with the first real account. |

## Done-when criteria

| Criterion | Status |
|---|---|
| Contract tests green | 37 Foundry tests (unit, fuzz, invariant) plus 3 fork tests pass |
| B20 hold-and-send result known | Passed on Base mainnet via `eth_simulateV1`: a contract can hold and send tokenized stocks. Week 1 prizes can be stock. |
| Chain facts verified | `pnpm verify:chain`: 67/67 live checks (the Coinbase listing check needs api.coinbase.com reachable) |
| Scoring dry run matches a hand calculation | `scoring/test/score.test.ts`, 7 tests |
| Public repo, contracts verified on Basescan | Waiting on the GitHub repo and Kenichi's deploy |
| Bots trading on mainnet, visible under the app on base.dev | Waiting on Builder Code, funding and keys |
| Fresh passkey account buys $1 with no ETH in under two minutes | Waiting on the deployed site and paymaster |
| Paper lock from a fresh account | Waiting on the PickBook deploy |
| Telegram bot posting the table | Waiting on the bot token and group |
| Week 1 universe set, prizes funded, ten friends with $1–5 and Telegram links | Waiting on the steps above |

## Performance (gzipped first load, local production build)

| Page | Size |
|---|---|
| `/` | 2.8 KB |
| `/play` | 2.6 KB (about 6 KB when entries are open and the picker script loads) |
| `/trade` | 8.5 KB |
| Wallet library, loaded after the page | 236 KB |
