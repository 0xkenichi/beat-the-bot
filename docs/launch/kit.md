# Launch kit (Stocks Maxxing season)

Everything here is a draft for the project's own X account. Post each one only when what it says is true. Blanks in [brackets] get filled from the live site or the block explorer at the time.

The drafts follow the $0 path, the default: the league's contracts on Base Sepolia, the house bots locking three picks a week, real stocks traded on Base with players' own USDC, no prizes until a sponsor funds a week. Lines marked *funded* are only for when that path is running ([runbook](../runbook.md)).

## The account

- **Name:** Beat the Bot
- **Handle:** @BeatTheBotXYZ (or the closest free one)
- **Bio:** Pick real stocks on Base. Beat the AI bots. Every week. Every pick onchain.
- **Link:** the live site
- **Header image:** the week card (`/api/og/week/current`)

## Posts, in the order they become true

**1. Building (true now)**
> I'm building a stock-picking league on Base where people play against AI bots.
>
> Three bots, each with its own wallet, pick real Coinbase tokenized stocks every week, in public: one chases last week's winners, one buys the losers, one asks a model. You pick three stocks and try to finish above them. Every pick is locked onchain.
>
> Open source from day one: github.com/0xkenichi/beat-the-bot

**2. The bots can trade with five dollars (*funded*: post once the bots are funded)**
> Gas on Base is so cheap that a bot with $5 can hold all ten stocks in the league. A $0.47 slice of Sandisk, at $1,153 a share, buys and sells straight back for 0.4%.
>
> So the bots in Beat the Bot trade real money from the start, just not much of it.

**3. Agents can enter (true now in code; post when the roster contract is live)**
> Any AI agent can enter Beat the Bot from its own wallet: an ERC-8004 identity on Base, a signed entry, then three signed picks a week. No gas needed for the league; it gets a public weekly record next to the house bots.
>
> Bankr agents can do the whole thing through Bankr's agent API. Guide: [link to docs/agents.md]

**4. Contracts live**
> Beat the Bot's contracts are live on Base Sepolia, where the free picks and the agent roster are recorded. The stocks, the prices and real-money trades are on Base.
> PickBook (free picks, locked onchain): [explorer link]
> AgentRoster (bots and agents, ERC-8004): [explorer link]
> PrizePool (holds only sponsor prizes): [explorer link]
> Verified source on each one.

**5. First bot picks**
> [Momentum] just locked the league's first picks: [AMZN 40%, GOOGL 35%, MSFT 25%]. [explorer link]
>
> The other two lock theirs within minutes. Their reasons and whole record are public: [site]/agents

*Funded variant:* "[Momentum] just made the first trade in the league: [bought $X of NVDAc]. [basescan link]"

**6. Week opens (every Monday)**
> Week [N] is open until the US open, 15:30 WAT.
> Pick three stocks for free, or buy from $1 into your own wallet. [site]

**7. Results (every Friday, 22:30 WAT)**
Attach the week card (`/api/og/week/[N]`).
> Week [N]: [Momentum +x%, Steady +y%, Contrarian −z%].
> [K] humans beat the bots. [Name] led with [+w%].
> Full table, the Chainlink prices used and the results file: [site]/week/[N]

**8. Final demo (by 5 Dec, tags @buildonbase)**
> Beat the Bot: a weekly league on Base where people and AI agents pick Coinbase tokenized stocks, and every pick and trade is onchain.
>
> [N] players, [M] agents, [L] picks and [T] trades with our Builder Code, [W] weeks scored.
> Built for Stocks Maxxing, Agentic Stock Finance track. @buildonbase
> [video] [site] [repo]

## Demo video (about two minutes)

| Time | Show | Say |
|---|---|---|
| 0:00 | The home table on a phone | "Every week, three AI bots pick real stocks on Base. You try to beat them." |
| 0:15 | A bot page and its picks on the explorer | "Each bot has its own wallet and its own reasons. Here are Momentum's picks, locked onchain with the app's Builder Code." |
| 0:35 | /trade: passkey sign-in, buy $1 of a stock | "Sign in with a passkey. No seed phrase, no gas. One tap and the stock is in your own wallet." |
| 1:00 | /play: pick three, lock | "No money? Pick three for free. Your picks are locked onchain until Friday." |
| 1:15 | An agent entering through the kit | "Any AI agent can join from its own wallet with a signature. Bankr agents included." |
| 1:35 | Friday results and the Telegram post | "Friday at the close, Chainlink prices settle it, and everyone gets their result." (*Funded:* "Winners are paid by the prize contract.") |
| 1:50 | The repo and the changelog | "Open source, and everything built this season is in the changelog." |

## Final submission form (draft answers)

- **Project:** Beat the Bot
- **Track:** Agentic Stock Finance
- **One line:** A weekly league on Base where people and AI agents pick Coinbase tokenized stocks, and trade them from their own wallets, scored on Chainlink prices, with every pick and trade onchain.
- **What was built during the Quest period (5 Nov – 5 Dec):** copy the dated entries from [CHANGELOG.md](../../CHANGELOG.md), "Quest period" section, with commit links.
- **What existed before:** the core league (contracts, house bots, scoring, web app) from 31 Oct – 2 Nov, baseline commit `7e4a313`.
- **Traction:** from `/api/metrics` and base.dev on the day: players, verified players, swaps and volume with the Builder Code, free-play locks, agents registered, weeks scored.
- **Links:** the X post with the video, the site, the repo, the contracts on Basescan.
