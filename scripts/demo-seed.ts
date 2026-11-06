// Local previews only: fills a pglite database with a made-up finished week so pages and share cards can be
// checked before launch. Refuses to run against a real Postgres.
//   DATABASE_URL=pglite:./data/local/demo npx tsx scripts/demo-seed.ts
import { openDb } from "../shared/src/db";
import { HOUSE_AGENTS, weekSchedule, UNIVERSE } from "../shared/src/index";

const url = process.env.DATABASE_URL ?? "";
if (!url.startsWith("pglite:")) throw new Error("demo-seed only runs against a local pglite database");
const db = await openDb(url);
const s = weekSchedule(1);
const wallets = ["0x00000000000000000000000000000000000000a1", "0x00000000000000000000000000000000000000a2", "0x00000000000000000000000000000000000000a3"];
const rets = [0.0312, -0.0118, 0.0154];
for (const [i, a] of HOUSE_AGENTS.entries()) {
  await db.query("insert into agents (id, name, strategy, wallet, house, start_nav, started_at) values ($1, $2, $3, $4, true, 5, to_timestamp($5)) on conflict (id) do nothing", [a.id, a.name, a.strategy, wallets[i], s.entryClose]);
  for (let h = 0; h <= 96; h += 6) {
    const v = 5 * (1 + rets[i]! * (h / 96) + Math.sin(h / 9 + i) * 0.004);
    await db.query("insert into nav_snapshots (wallet, taken_at, block, nav_usd, usdc_raw, holdings) values ($1, to_timestamp($2), $3, $4, '250000', $5::jsonb) on conflict do nothing",
      [wallets[i], s.entryClose + h * 3600, 53_400_000 + h * 1800, v, JSON.stringify([{ token: UNIVERSE[i]!.address, ticker: UNIVERSE[i]!.ticker, valueUsd: v * 0.95 }])]);
  }
  await db.query("insert into trades (tx_hash, wallet, kind, side, token, amount_in, amount_out, usdc_raw, ts, builder_code, status) values ($1, $2, 'bot', 'buy', $3, '1580000', '730000', '1580000', to_timestamp($4), true, 'confirmed') on conflict do nothing",
    [`0x${(i + 1).toString(16).padStart(64, "0")}`, wallets[i], UNIVERSE[i]!.address.toLowerCase(), s.entryClose + 400]);
}
const row = (wallet: string, tier: string, name: string, ret: number, rank: number, extra: object = {}) => ({ wallet, tier, name, ret, rank, ...extra });
const bots = HOUSE_AGENTS.map((a, i) => row(wallets[i]!, "bot", a.name, rets[i]!, 0, { agentId: a.id, valueUsd: 5 * (1 + rets[i]!) })).sort((x, y) => y.ret - x.ret).map((b, i) => ({ ...b, rank: i + 1 }));
const results = {
  weekId: 1, schedule: s, phase: "final", updatedAt: s.scoreAt,
  bots,
  real: [row("0x00000000000000000000000000000000000000b1", "real", "tolu.base", 0.0461, 1, { beatTheBot: true, beats: ["Momentum", "Steady", "Contrarian"], valueUsd: 21.4, eligible: true })],
  paper: [
    row("0x00000000000000000000000000000000000000c1", "paper", "ada_lagos", 0.0337, 1, { beatTheBot: true, beats: ["Momentum", "Steady", "Contrarian"], picks: [{ ticker: "NVDA", weightBps: 5000 }, { ticker: "TSLA", weightBps: 3000 }, { ticker: "MSFT", weightBps: 2000 }] }),
    row("0x00000000000000000000000000000000000000c2", "paper", "kenji", 0.0201, 2, { beats: ["Steady", "Contrarian"], picks: [{ ticker: "AAPL", weightBps: 3400 }, { ticker: "META", weightBps: 3300 }, { ticker: "AMZN", weightBps: 3300 }] }),
  ],
  winners: [], universe: [], prices: { open: {}, close: {} },
};
await db.query(`insert into weeks (week, entry_open, entry_close, score_at, universe, results, results_hash, status) values (1, $1, $2, $3, '[]'::jsonb, $4::jsonb, '0xdemo', 'scored')
  on conflict (week) do update set results = excluded.results`, [s.entryOpen, s.entryClose, s.scoreAt, JSON.stringify(results)]);
await db.close();
console.log("demo data written (made-up numbers, local only)");
