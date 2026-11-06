# Runbook

Everything below that touches a key or an account is done by Kenichi. Keys live only in his `.env` and in the jobs project's Vercel env. Nothing secret is ever committed.

## Two ways to run the league

| | **$0 path (default)** | **Funded path (optional)** |
|---|---|---|
| League contracts (PickBook, AgentRoster, PrizePool) | Base Sepolia, gas from the free CDP faucet | Base mainnet, gas paid in ETH |
| Stocks, prices, swaps | Base mainnet (Coinbase tokenized stocks, Chainlink feeds) | Same |
| People playing for free | Three picks a week, gas sponsored on Base Sepolia | Same, on Base |
| People trading real stocks | Their own USDC on Base, from `/trade` | Same |
| House bots | Lock three picks a week, like a free player | Can also trade real money (`BOTS_MODE=trade`) |
| Outside AI agents | Join and pick by signature, or by transaction on Base Sepolia | Join and trade on Base |
| Prizes | None until a sponsor funds a week | Paid onchain by PrizePool |
| Money Kenichi spends | Nothing | Bot and prize funding, gas |

The two paths share all the code. The league chain comes from `contractsChain` in `shared/src/deployments.json` (or `CONTRACTS_CHAIN_ID`); `pnpm admin deployments` sets it to the chain you deployed on.

## One-time setup ($0 path), in the order it is needed

| # | Step | Who | Where |
|---|---|---|---|
| 1 | Register the app and copy its **Builder Code** (`bc_…`). Put it in `shared/src/deployments.json` as `builderCode` (it is public). | Kenichi | base.dev → Settings → Builder Code |
| 2 | **CDP account** (free). One login covers the testnet faucet and gas sponsorship. | Kenichi | portal.cdp.coinbase.com |
| 3 | **RPC (optional):** a free Alchemy app with Base Mainnet and Base Sepolia. Put the URLs in `.env` as `BASE_RPC_URL` and `CONTRACTS_RPC_URL`. Without them the public endpoints are used, which are slower and rate-limited. | Kenichi | alchemy.com |
| 4 | Create the operating **wallets**: run `pnpm admin new-wallets --with-owner` in your own terminal. It writes fresh keys to `.env` and prints only the addresses. | Kenichi | terminal |
| 5 | **Testnet gas:** CDP Portal → Faucets → network *Base Sepolia*, token *ETH* → paste an address → Claim. Each claim is 0.0001 ETH (the limit is 1,000 claims a day). Claim twice for the owner, twice for the resolver and once for each bot: seven claims. At today's Base Sepolia gas price one claim covers the deploy, or about 140 weekly pick locks. `pnpm admin status` shows each balance. | Kenichi | CDP Portal |
| 6 | **Deploy** the contracts to Base Sepolia (below). Verification goes to Blockscout and needs no API key. Then commit `shared/src/deployments.json`. | Kenichi runs | terminal |
| 7 | **Database:** Vercel → Storage → Neon (free) → connect to the project. Copy `DATABASE_URL` to `.env`. | Kenichi | Vercel, on his own account (not the sideQuest one) |
| 8 | **Website:** Vercel → New project → import `0xkenichi/beat-the-bot`, root directory `web`. Env: `NEXT_PUBLIC_SITE_URL`, `SESSION_SECRET` (any random 40 characters), `BASE_RPC_URL`, `CONTRACTS_RPC_URL`, `DATABASE_URL`, `PAYMASTER_URL_SEPOLIA`, `PAYMASTER_URL`, `TELEGRAM_*`. | Kenichi | Vercel, own account |
| 9 | **Gas sponsorship on Base Sepolia** (free play): CDP Portal → Paymaster → network Base Sepolia → allowlist `PickBook` (address on `/contracts`) → copy the URL to Vercel as `PAYMASTER_URL_SEPOLIA`. If sponsorship is ever down, players sign their picks instead and the resolver submits them. | Kenichi | CDP Portal → Paymaster |
| 10 | **Gas sponsorship on Base** (real-money trades): same page, network Base. Allowlist USDC, the ten stock tokens and the swap router. Per-user limit about $0.50 a day, global limit $10. Copy the URL to Vercel as `PAYMASTER_URL`. CDP bills mainnet sponsorship against the account's gas credits; if the portal asks for a payment method first, skip this step and run `pnpm admin kill-switch on`: `/trade` then shows prices and portfolios but does not buy, and everything else runs as normal. | Kenichi | CDP Portal → Paymaster |
| 11 | **Weeks onchain:** `pnpm admin set-weeks 1 4` (owner key, Base Sepolia). | Kenichi runs | terminal |
| 12 | **Bots:** `pnpm --filter @btb/bots exec tsx src/cli.ts init`, then `pnpm admin register-agents` (ERC-8004 identities and roster entries on Base Sepolia, from each bot wallet). From then on the scheduler locks each bot's picks every Monday. | Kenichi runs | terminal |
| 13 | **Telegram:** BotFather → `/newbot`. Token to `TELEGRAM_BOT_TOKEN`, username to `TELEGRAM_BOT_USERNAME`, any random string to `TELEGRAM_WEBHOOK_SECRET`. Make a group, add the bot as admin, put the group's chat id in `TELEGRAM_GROUP_CHAT_ID`. Then `pnpm admin telegram-webhook`. | Kenichi | Telegram |
| 14 | **Scheduler** (free): see *The scheduler* below. | Kenichi | Vercel + cron-job.org |
| 15 | **Steady's model (optional):** any OpenAI-compatible free tier. Without it, Steady picks the steadiest stocks and says so on its page. | Kenichi | provider of choice |
| 16 | **Pidgin copy:** `web/lib/copy.ts` (`pcm`) and `bot-telegram/src/pidgin.ts`. Missing lines fall back to English. | Kenichi | editor |
| 17 | **base.dev check:** after the first user swap on Base, confirm it shows under the app. Picks on Base Sepolia carry the Builder Code too; base.dev may list only Base mainnet activity. | Kenichi | base.dev |

### Deploying the contracts (Base Sepolia)

```bash
set -a; source .env; set +a
export OWNER_ADDRESS=$(cast wallet address --private-key $OWNER_PRIVATE_KEY)
export RESOLVER_ADDRESS=$(cast wallet address --private-key $RESOLVER_PRIVATE_KEY)
export SPONSOR_ADDRESS=$(cast wallet address --private-key $SPONSOR_PRIVATE_KEY)
cd contracts
forge script script/Deploy.s.sol --rpc-url ${CONTRACTS_RPC_URL:-https://sepolia.base.org} --private-key $OWNER_PRIVATE_KEY --broadcast \
  --verify --verifier blockscout --verifier-url https://base-sepolia.blockscout.com/api/
cd .. && pnpm admin deployments --chain 84532
```

The deploy script picks the ERC-8004 Identity Registry for the chain it runs on and makes the resolver the AgentRoster registrar, so it can submit agents' signed entries.

## Funded path (optional)

Use this when there is money for real prizes or for bots that trade real stocks. Nothing on the $0 path has to be undone; the funded path adds to it.

1. **Fund on Base** (lean budget): owner $1 of ETH; resolver $0.30 of ETH; sponsor the week's prizes in USDC plus $0.20 of ETH; for bots that trade, each bot $5–50 of USDC plus $0.50 of ETH.
2. **Etherscan API key** (free, works for Basescan): `.env` → `BASESCAN_API_KEY`.
3. **Deploy on Base:**
   ```bash
   cd contracts
   forge script script/Deploy.s.sol --rpc-url $BASE_RPC_URL --private-key $OWNER_PRIVATE_KEY --broadcast --verify --etherscan-api-key $BASESCAN_API_KEY
   cd .. && pnpm admin deployments --chain 8453
   ```
   This switches `contractsChain` to 8453. Commit `shared/src/deployments.json`, run `pnpm admin set-weeks` and `pnpm admin register-agents` again (they act on Base now), and add `PickBook` to the Base paymaster allowlist.
4. **Bots that trade:** this is the default once the contracts are on Base (or set `BOTS_MODE=trade` in the jobs project). Each bot then rebalances its wallet after the US open on Monday and is scored on its wallet's time-weighted return.
5. **Prizes:** `pnpm admin fund-prizes --week 1 --real 40 --paper 10 --token NVDA` (sponsor key: buys the stock, funds the pool). Settling is below.

## The scheduler

One protected route, `/api/cron/tick`, does everything that is due each time it is called: posts, prices, picks and agent entries from the league chain, deposits and withdrawals, hourly snapshots, opening prices, scoring, submitting signed picks and signed agent entries, settlement (from week 3, if turned on) and one house bot per call. A free external cron calls it every 5 minutes. Every post time is on a 5-minute mark, so posts go out on their exact minute.

1. **Two Vercel projects from the same repo** (both root directory `web`):
   - `beat-the-bot`: the public site. No private keys. Env: `NEXT_PUBLIC_SITE_URL`, `SESSION_SECRET`, `BASE_RPC_URL`, `CONTRACTS_RPC_URL`, `DATABASE_URL`, `PAYMASTER_URL_SEPOLIA`, `PAYMASTER_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`.
   - `beat-the-bot-jobs`: runs the schedule. Env: `JOBS_ENABLED=1`, `CRON_SECRET` (random, 32+ characters), `NEXT_PUBLIC_SITE_URL` (the public site's URL), `BASE_RPC_URL`, `CONTRACTS_RPC_URL`, `DATABASE_URL`, `RESOLVER_PRIVATE_KEY`, `BOT_MOMENTUM_PRIVATE_KEY`, `BOT_CONTRARIAN_PRIVATE_KEY`, `BOT_STEADY_PRIVATE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_GROUP_CHAT_ID`, optional `BOTS_MODE` (`picks` by default on the $0 path, `trade` on the funded path), `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`.
   The route answers 404 anywhere `JOBS_ENABLED` is not `1`, so the public site never runs jobs or holds those keys. (One project with everything also works, at the cost of that separation.)
2. **cron-job.org** (free account): Create cronjob → URL `https://<jobs project>.vercel.app/api/cron/tick` → every 5 minutes → Advanced → Headers → `Authorization: Bearer <CRON_SECRET>` → Save. The response body lists what each call did.
3. To run a pass by hand: `pnpm --filter @btb/scoring tick` (uses your `.env`).

## The weekly cycle (automatic)

| When (WAT, Nov–Mar) | What happens |
|---|---|
| Every 5 minutes | Prices, picks, agent entries, deposits/withdrawals; signed picks and entries submitted; a snapshot of every wallet each hour |
| Monday 01:00 | Entries open (PickBook window) |
| Monday from 01:05 | The three house bots lock their picks, one per call |
| Monday 06:00 | "Week N is open" post |
| Monday 14:30 | "One hour left" post |
| Monday 15:30 (US open) | Entries close; opening prices and snapshot recorded (funded path with `BOTS_MODE=trade`: the bots rebalance over the next three calls) |
| Friday 22:05 (US close + 5 min) | Closing prices, final snapshot, scoring, results file and hash |
| Friday 22:30 | Results post and personal messages |
| After Kenichi's check | Funded weeks only: prizes pushed to winners onchain (by hand in weeks 1–2) |

Holiday weeks move automatically (Thanksgiving, Christmas, New Year, MLK Day, Presidents Day, Good Friday). From 15 Mar 2027 US daylight saving moves everything one hour earlier in WAT.

## Settling a week

Only weeks a sponsor funded have anything to settle; the PrizePool has to be on Base for real prizes (funded path).

1. Read the results on `/week/N` and in the Telegram post.
2. Weeks 1–2: check the winners are different people. If two winning wallets are one person, re-score without them: `pnpm --filter @btb/scoring exec tsx src/cli.ts score --week N --exclude 0x…`.
3. Run `pnpm --filter @btb/scoring settle --week N --approved` (resolver key from your `.env`).
4. From week 3 you can let it settle itself: `pnpm admin auto-settle on`.

A payout the token refuses (for example a transfer policy) is kept in the pool as `owed` and the winner claims it with `withdraw`.

## Kill switch

`pnpm admin kill-switch on` turns buying off at once (or set `TRADE_MODE=view-only` in Vercel). Prices, portfolios and selling stay available. `pnpm admin kill-switch off` turns it back on.

## Checks

```bash
pnpm verify:chain   # every chain fact, live
pnpm test:live      # B20 hold-and-send on Base's own node (eth_simulateV1)
pnpm admin status   # league chain, keys, balances on both chains, settings
```
