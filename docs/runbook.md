# Runbook

Everything below that touches a key, an account or money is done by Kenichi. Keys live only in his `.env`, in GitHub Actions secrets and in Vercel env. Nothing secret is ever committed.

## One-time setup, in the order it is needed

| # | Step | Who | Where |
|---|---|---|---|
| 1 | Register the app and copy its **Builder Code** (`bc_…`). Put it in `shared/src/deployments.json` as `builderCode` (it is public). | Kenichi | base.dev → Settings → Builder Code |
| 2 | Create an **RPC** key for Base mainnet. | Kenichi | Alchemy or CDP |
| 3 | Create the operating **wallets**: run `pnpm admin new-wallets --with-owner` in your own terminal. It writes six fresh keys to `.env` and prints only the addresses. | Kenichi | terminal |
| 4 | **Fund** (lean budget): owner $1 of ETH; each bot $50 USDC + $0.50 ETH; sponsor the week's prizes in USDC + $0.20 ETH; resolver $0.30 ETH. | Kenichi | any wallet → Base addresses from step 3 |
| 5 | Create a free **Etherscan API key** (works for Basescan) and put it in `.env` as `BASESCAN_API_KEY`. | Kenichi | etherscan.io |
| 6 | **Deploy** the contracts (below), then `pnpm admin deployments` and commit `shared/src/deployments.json`. | Kenichi runs | terminal |
| 7 | **Database:** Vercel → Storage → Neon (free) → connect to the project. Copy `DATABASE_URL` to `.env` and to GitHub secrets. | Kenichi | Vercel |
| 8 | **Website:** Vercel → New project → import `0xkenichi/beat-the-bot`, root directory `web`. Env: `NEXT_PUBLIC_SITE_URL`, `SESSION_SECRET` (any random 40 characters), `BASE_RPC_URL`, `DATABASE_URL`, `PAYMASTER_URL`, `TELEGRAM_*`. | Kenichi | Vercel |
| 9 | **Gas sponsorship:** CDP Paymaster on Base mainnet. Allowlist: USDC, the ten stock tokens, the swap router and `PickBook` (addresses on `/contracts`). Per-user limit about $0.50 a day, global limit $10. Copy the URL to Vercel as `PAYMASTER_URL`. | Kenichi | portal.cdp.coinbase.com → Paymaster |
| 10 | **Weeks onchain:** `pnpm admin set-weeks 1 4` (owner key). | Kenichi runs | terminal |
| 11 | **Bots:** `pnpm --filter @btb/bots exec tsx src/cli.ts init`, then `pnpm admin register-agents` (ERC-8004 identities and roster entries, from each bot wallet). | Kenichi runs | terminal |
| 12 | **Telegram:** BotFather → `/newbot`. Token to `TELEGRAM_BOT_TOKEN`, username to `TELEGRAM_BOT_USERNAME`, any random string to `TELEGRAM_WEBHOOK_SECRET`. Make a group, add the bot as admin, put the group's chat id in `TELEGRAM_GROUP_CHAT_ID`. Then `pnpm admin telegram-webhook`. | Kenichi | Telegram |
| 13 | **Scheduler:** GitHub → repo → Settings → Secrets and variables → Actions. Secrets: `DATABASE_URL`, `BASE_RPC_URL`, `RESOLVER_PRIVATE_KEY`, `BOT_MOMENTUM_PRIVATE_KEY`, `BOT_CONTRARIAN_PRIVATE_KEY`, `BOT_STEADY_PRIVATE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_GROUP_CHAT_ID`, optional `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`. Variables: `SITE_URL`, and `SCHEDULE_ENABLED` = `true` once everything else is set (the scheduled jobs stay off until then). GitHub Actions must be usable on the account: on 1 Nov it reported the account locked for a billing issue. | Kenichi | GitHub |
| 14 | **Steady's model (optional):** any OpenAI-compatible free tier. Without it, Steady holds every stock equally and says so on its page. | Kenichi | provider of choice |
| 15 | **Prizes for week 1:** `pnpm admin fund-prizes --week 1 --real 40 --paper 10 --token NVDA` (sponsor key: buys the stock, funds the pool). | Kenichi runs | terminal |
| 16 | **Pidgin copy:** `web/lib/copy.ts` (`pcm`) and `bot-telegram/src/pidgin.ts`. Missing lines fall back to English. | Kenichi | editor |
| 17 | **base.dev check:** after the first bot swap, user swap, paper lock and payout, confirm each shows under the app. | Kenichi | base.dev |

### Deploying the contracts

```bash
set -a; source .env; set +a
export OWNER_ADDRESS=$(cast wallet address --private-key $OWNER_PRIVATE_KEY)
export RESOLVER_ADDRESS=$(cast wallet address --private-key $RESOLVER_PRIVATE_KEY)
export SPONSOR_ADDRESS=$(cast wallet address --private-key $SPONSOR_PRIVATE_KEY)
cd contracts
forge script script/Deploy.s.sol --rpc-url $BASE_RPC_URL --private-key $OWNER_PRIVATE_KEY --broadcast --verify --etherscan-api-key $BASESCAN_API_KEY
cd .. && pnpm admin deployments
```

## The weekly cycle (automatic)

| When (WAT, Nov–Mar) | What runs | Workflow |
|---|---|---|
| Every 15 minutes | Prices, paper locks, deposits/withdrawals, hourly snapshots | `tick` |
| Monday 01:00 | Entries open (PickBook window) | onchain |
| Monday 06:00 | "Week N is open" post | `tick` |
| Monday 14:30 | "One hour left" post | `tick` |
| Monday 15:30 (US open) | Entries close; opening prices and snapshot recorded; bots rebalance | `tick`, `bots` |
| Friday 22:00 (US close) | Closing prices, final snapshot, scoring, results file and hash | `results` |
| Friday 22:30 | Results post and personal messages | `results` |
| After Kenichi's check | Settlement: prizes pushed to winners onchain | `settle` (by hand in weeks 1–2) |

Holiday weeks move automatically (Thanksgiving, Christmas, New Year, MLK Day, Presidents Day, Good Friday). From 15 Mar 2027 US daylight saving moves everything one hour earlier in WAT.

## Settling a week

1. Read the results on `/week/N` and in the Telegram post.
2. Weeks 1–2: check the winners are different people. If two winning wallets are one person, re-score without them: `pnpm --filter @btb/scoring exec tsx src/cli.ts score --week N --exclude 0x…`.
3. GitHub → Actions → `settle` → week N, tick the confirmation box → Run. Or locally: `pnpm --filter @btb/scoring settle --week N --approved`.
4. From week 3 you can let it settle itself: `pnpm admin auto-settle on`.

A payout the token refuses (for example a transfer policy) is kept in the pool as `owed` and the winner claims it with `withdraw`.

## Kill switch

`pnpm admin kill-switch on` turns buying off at once (or set `TRADE_MODE=view-only` in Vercel). Prices, portfolios and selling stay available. `pnpm admin kill-switch off` turns it back on.

## Checks

```bash
pnpm verify:chain   # every chain fact, live
pnpm test:live      # B20 hold-and-send on Base's own node (eth_simulateV1)
pnpm admin status   # keys, balances and settings at a glance
```
