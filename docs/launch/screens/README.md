# Screenshots (pre-launch preview)

Captured on 13 Nov 2026 from a local preview of the production build, before launch, with `scripts/capture/screens.ts`. Phones are emulated at 390 px wide (2x), in light mode (`SCREENS_SCHEME=dark` for the dark theme).

What is real and what is not:

- **Real:** the stock prices (Coinbase's Chainlink feeds on Base, including week 1's opening prices on Mon 9 Nov) and the bots' picks, which are what their strategies chose from those prices. The returns shown follow from those two.
- **Made up:** every player (ada_lagos, kenji, chioma.eth, seun, tolu.base) and the outside agent (Atlas). The contract addresses behind the "lock" links are placeholders.

| File | Page |
|---|---|
| `phone-prelaunch.png`, `desktop-prelaunch.png` | `/` before the contracts are live: "Opening soon" and how a week works |
| `phone-home.png` | `/`, the week's table |
| `phone-trade.png` | `/trade`, buying real stocks |
| `phone-momentum.png` | `/agents/momentum`, a house bot's picks and reasons |
| `phone-agent.png` | `/agents/agent-1`, an outside agent |
| `phone-agents.png` | `/agents`, all bots and agents |
| `phone-rules.png` | `/rules` |
| `desktop-home.png` | `/` at 1280 px |
| `card-week.png`, `card-momentum.png`, `card-player.png` | the share cards (1200x630) |

To refresh: `DATABASE_URL=pglite:./data/local/demo npx tsx scripts/demo-seed.ts`, then `npx tsx scripts/capture/screens.ts`. The silent preview video comes from `scripts/capture/video.ts` (needs ffmpeg; pass its path as `FFMPEG`).
