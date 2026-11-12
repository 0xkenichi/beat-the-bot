// Local previews only: fills a pglite database with this week's league as it would look a few days in, so pages, share
// cards and the demo video can be captured before launch. The stock prices are real (Coinbase's Chainlink feeds on
// Base, including this week's opening prices) and the bots' picks are what their strategies choose from those prices;
// every player and the outside agent are made up. Refuses to run against a real Postgres.
//
//   DATABASE_URL=pglite:./data/local/demo npx tsx scripts/demo-seed.ts
import { keccak256, toHex } from "viem";
import { openDb } from "../shared/src/db";
import { HOUSE_AGENTS, UNIVERSE, makePublicClient, priceAtCutoff, weekIdAt, weekSchedule } from "../shared/src/index";
import { picksHash, type Pick } from "../shared/src/agentKit";
import { cachePrices } from "../indexer/src/index";
import { momentum } from "../bots/src/strategies/momentum";
import { contrarian } from "../bots/src/strategies/contrarian";
import { steady } from "../bots/src/strategies/steady";
import { fiveDayReturns } from "../bots/src/strategies/common";
import { weightsToPicks } from "../bots/src/run";

const url = process.env.DATABASE_URL ?? "";
if (!url.startsWith("pglite:")) throw new Error("demo-seed only runs against a local pglite database");
const db = await openDb(url);
const client = makePublicClient();
const now = Math.floor(Date.now() / 1000);
const s = weekSchedule(Math.max(1, weekIdAt(now)));
const fakeTx = (label: string) => keccak256(toHex(`demo:${label}`));
const idx = (ticker: string) => UNIVERSE.findIndex((u) => u.ticker === ticker);
const picks = (spec: [string, number][]): Pick[] => spec.map(([t, w]) => ({ tokenIndex: idx(t), weightBps: w * 100 }));

// Real prices: the latest, and this week's opening prices at the US open (once it has passed).
await cachePrices(client, db);
let open: Record<string, unknown> | null = null;
if (now >= s.entryClose) {
  open = {};
  for (const u of UNIVERSE) {
    const p = await priceAtCutoff(client, u.feed, s.entryClose);
    open[u.address.toLowerCase()] = { price8: p.answer.toString(), updatedAt: p.updatedAt, roundId: p.roundId.toString(), stale: p.stale, feed: u.feed };
  }
}
await db.query(
  `insert into weeks (week, entry_open, entry_close, score_at, universe, open_prices, status) values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)
   on conflict (week) do update set open_prices = excluded.open_prices, status = excluded.status, results = null`,
  [s.weekId, s.entryOpen, s.entryClose, s.scoreAt, JSON.stringify(UNIVERSE.map((u) => u.address)), open ? JSON.stringify(open) : null, open ? "live" : "open"],
);

const lock = async (wallet: string, p: Pick[], at: number, label: string) =>
  db.query(
    `insert into paper_locks (week, wallet, picks, picks_hash, locked_at, tx_hash, block) values ($1, $2, $3::jsonb, $4, $5, $6, 1)
     on conflict (week, wallet) do update set picks = excluded.picks, picks_hash = excluded.picks_hash, locked_at = excluded.locked_at, tx_hash = excluded.tx_hash`,
    [s.weekId, wallet, JSON.stringify(p), picksHash(p), at, fakeTx(label)],
  );

// The house bots, with the picks their strategies make from real prices on Monday morning.
const botWallets = ["0x00000000000000000000000000000000000000a1", "0x00000000000000000000000000000000000000a2", "0x00000000000000000000000000000000000000a3"];
const at = s.entryOpen + 600;
const moves = new Map((await fiveDayReturns(client, UNIVERSE, at)).returns.map((r) => [r.token.address, Math.abs(r.ret)]));
for (const [i, a] of HOUSE_AGENTS.entries()) {
  const wallet = botWallets[i]!;
  await db.query(
    `insert into agents (id, name, strategy, wallet, house, erc8004_id, identity_chain) values ($1, $2, $3, $4, true, $5, 84532)
     on conflict (id) do update set wallet = excluded.wallet, erc8004_id = excluded.erc8004_id, identity_chain = excluded.identity_chain`,
    [a.id, a.name, a.strategy, wallet, String(10602 + i)],
  );
  const strat = a.id === "momentum" ? momentum : a.id === "contrarian" ? contrarian : steady;
  const targets = await strat(client, UNIVERSE, at, {});
  const p = weightsToPicks(targets.weights, UNIVERSE, (t) => moves.get(t.address) ?? 1);
  const label = p.map((x) => `${UNIVERSE[x.tokenIndex]!.ticker} ${(x.weightBps / 100).toFixed(0)}%`).join(", ");
  await lock(wallet, p, at + i * 300, a.id);
  const why = targets.source === "equal-weight" ? "No model answer this week, so it took the three stocks that moved least over the last five trading days." : targets.note;
  await db.query("insert into kv (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value", [
    `bot_note:${a.id}:${s.weekId}`, JSON.stringify({ source: targets.source, note: `Locked ${label}. ${why}`, weights: targets.weights, picks: p, tx: fakeTx(a.id), at }),
  ]);
  console.log(`${a.name}: ${label}`);
}

// One outside agent (made up), entered by signature with its identity on Base.
const agentWallet = "0x00000000000000000000000000000000000000e1";
await db.query("insert into agent_profiles (wallet, name, strategy) values ($1, 'Atlas', 'Buys the two strongest chip stocks and one steady name, every week.') on conflict (wallet) do nothing", [agentWallet]);
await db.query(
  "insert into agents (id, name, strategy, wallet, house, erc8004_id, roster_id, identity_chain) values ('agent-1', 'Atlas', 'Buys the two strongest chip stocks and one steady name, every week.', $1, false, '2214', 1, 8453) on conflict (id) do nothing",
  [agentWallet],
);
await lock(agentWallet, picks([["NVDA", 40], ["SNDK", 35], ["MSFT", 25]]), s.entryOpen + 3600, "atlas");

// Made-up players: four free-play entries and one real-money portfolio.
const players: [string, string, [string, number][]][] = [
  ["0x0000000000000000000000000000000000000c01", "ada_lagos", [["NVDA", 50], ["TSLA", 30], ["MSFT", 20]]],
  ["0x0000000000000000000000000000000000000c02", "kenji", [["AAPL", 34], ["META", 33], ["AMZN", 33]]],
  ["0x0000000000000000000000000000000000000c03", "chioma.eth", [["GOOGL", 60], ["AMZN", 20], ["META", 20]]],
  ["0x0000000000000000000000000000000000000c04", "seun", [["MSTR", 50], ["TSLA", 25], ["SPCX", 25]]],
];
for (const [i, [wallet, name, spec]] of players.entries()) {
  await db.query("insert into players (wallet, display_name, non_us_confirmed_at, telegram_id) values ($1, $2, now(), $3) on conflict (wallet) do nothing", [wallet, name, String(7000 + i)]);
  await lock(wallet, picks(spec), s.entryOpen + 7200 + i * 900, name);
}
const realWallet = "0x0000000000000000000000000000000000000b01";
await db.query("insert into players (wallet, display_name, non_us_confirmed_at, telegram_id) values ($1, 'tolu.base', now(), '7100') on conflict (wallet) do nothing", [realWallet]);
if (open) {
  const hour = Math.floor(now / 3600) * 3600;
  for (const [t, v] of [[s.entryClose, 20], [hour, 20.84]] as const) {
    await db.query("insert into nav_snapshots (wallet, taken_at, block, nav_usd, usdc_raw, holdings) values ($1, to_timestamp($2), 1, $3, '1000000', '[]'::jsonb) on conflict do nothing", [realWallet, t, v]);
  }
}

await db.close();
console.log(`Week ${s.weekId} demo written: real prices, the bots' real picks, made-up players and agent (local only).`);
