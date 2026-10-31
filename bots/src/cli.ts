// House bots: rebalance on Monday after the US open, hourly NAV snapshots, status.
//   pnpm --filter @btb/bots rebalance [--bot momentum] [--dry-run]
//   pnpm --filter @btb/bots snapshot
//   pnpm --filter @btb/bots status
import { formatEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { HOUSE_AGENTS, UNIVERSE, isMarketOpen, makePublicClient, requireBuilderCode, valueWallet, weekIdAt, weekSchedule, type HouseAgent } from "@btb/shared";
import { getDb, kvGet, kvSet, migrate } from "@btb/shared/db";
import { loadEnv } from "@btb/shared/env";
import { momentum } from "./strategies/momentum";
import { contrarian } from "./strategies/contrarian";
import { steady } from "./strategies/steady";
import { executePlan, makeBotWallet, planRebalance } from "./executor";
import { hourStamp, snapshotWallets } from "./nav";

loadEnv();
const args = process.argv.slice(3);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const client = makePublicClient();

function botAddress(a: HouseAgent): Address | undefined {
  const key = process.env[a.keyEnv] as Hex | undefined;
  if (key) return privateKeyToAccount(key).address;
  return process.env[a.addressEnv] as Address | undefined;
}

async function init() {
  const db = await getDb();
  await migrate(db);
  for (const a of HOUSE_AGENTS) {
    const addr = botAddress(a);
    if (!addr) { console.log(`${a.name}: no ${a.keyEnv} or ${a.addressEnv} yet, skipped`); continue; }
    await db.query(
      `insert into agents (id, name, strategy, wallet, house) values ($1, $2, $3, $4, true)
       on conflict (id) do update set name = excluded.name, strategy = excluded.strategy, wallet = excluded.wallet`,
      [a.id, a.name, a.strategy, addr.toLowerCase()],
    );
    console.log(`${a.name}: ${addr}`);
  }
}

async function rebalance() {
  const db = await getDb();
  const builderCode = requireBuilderCode();
  const now = Math.floor(Date.now() / 1000);
  const week = weekIdAt(now);
  const only = opt("bot");
  const dry = flag("dry-run");
  if (!dry && (!isMarketOpen(now) || now < weekSchedule(Math.max(1, week)).entryClose)) {
    console.log("Market closed or entries still open: bots trade after the US open on the week's first trading day.");
    return;
  }
  for (const a of HOUSE_AGENTS.filter((x) => !only || x.id === only)) {
    const key = process.env[a.keyEnv] as Hex | undefined;
    const addr = botAddress(a);
    if (!addr) { console.log(`${a.name}: wallet not configured, skipped`); continue; }
    const doneKey = `rebalanced:${a.id}:${week}`;
    if (!dry && (await kvGet(db, doneKey, false))) { console.log(`${a.name}: already rebalanced in week ${week}`); continue; }
    const [row] = await db.query<{ start_nav: number | null; paused: boolean }>("select start_nav, paused from agents where id = $1", [a.id]);
    const v = await valueWallet(client, addr);
    if (row?.paused) { console.log(`${a.name}: paused, no trades`); continue; }
    if (row?.start_nav && v.navUsd < row.start_nav * 0.5) {
      await db.query("update agents set paused = true, paused_reason = $2 where id = $1", [a.id, `NAV $${v.navUsd.toFixed(2)} fell below half of the $${row.start_nav.toFixed(2)} start`]);
      console.log(`${a.name}: paused (below 50% of starting NAV)`);
      continue;
    }
    const strat = a.id === "momentum" ? momentum : a.id === "contrarian" ? contrarian : steady;
    const targets = await strat(client, UNIVERSE, now);
    const plan = planRebalance(v, targets.weights);
    console.log(`\n${a.name} (${addr}) NAV $${v.navUsd.toFixed(2)} | ${targets.source}: ${targets.note}`);
    for (const p of plan) console.log(`  plan ${p.side} ${p.token.ticker} ~$${p.usd.toFixed(2)} (${p.why})`);
    await kvSet(db, `bot_note:${a.id}:${week}`, { source: targets.source, note: targets.note, weights: targets.weights, at: now });
    if (dry || !key) { console.log(dry ? "  dry run: nothing sent" : "  no key: nothing sent"); continue; }
    const wallet = makeBotWallet(key, builderCode);
    const trades = await executePlan({ client, wallet, plan, builderCode });
    for (const t of trades) {
      await db.query(
        `insert into trades (tx_hash, wallet, kind, side, token, amount_in, amount_out, usdc_raw, builder_code, status)
         values ($1, $2, 'bot', $3, $4, $5, $6, $7, $8, 'confirmed') on conflict do nothing`,
        [t.tx, addr.toLowerCase(), t.side, t.token.address.toLowerCase(), t.amountIn.toString(), t.amountOut.toString(), t.usdc.toString(), t.builderCode],
      );
    }
    await kvSet(db, doneKey, true);
  }
}

async function snapshot() {
  const db = await getDb();
  const stamp = hourStamp();
  const agents = await db.query<{ id: string; wallet: string; start_nav: number | null }>("select id, wallet, start_nav from agents");
  const players = await db.query<{ wallet: string }>("select wallet from players where non_us_confirmed_at is not null");
  const wallets = [...new Set([...agents.map((a) => a.wallet), ...players.map((p) => p.wallet)])] as Address[];
  const values = await snapshotWallets(client, db, wallets, stamp);
  for (const a of agents) {
    const v = values.find((x) => x.wallet.toLowerCase() === a.wallet);
    if (v && a.start_nav == null && v.navUsd >= 1) {
      await db.query("update agents set start_nav = $2, started_at = now() where id = $1", [a.id, v.navUsd]);
    }
  }
  console.log(`snapshot ${stamp.toISOString()}: ${values.length} wallets`);
}

async function status() {
  for (const a of HOUSE_AGENTS) {
    const addr = botAddress(a);
    if (!addr) { console.log(`${a.name}: not configured`); continue; }
    const [v, eth] = await Promise.all([valueWallet(client, addr), client.getBalance({ address: addr })]);
    const held = v.holdings.filter((h) => h.raw !== "0").map((h) => `${h.ticker} $${h.valueUsd.toFixed(2)}`).join(", ");
    console.log(`${a.name} ${addr}: NAV $${v.navUsd.toFixed(2)} (USDC $${(Number(v.usdcRaw) / 1e6).toFixed(2)}${held ? `, ${held}` : ""}), gas ${formatEther(eth)} ETH`);
  }
}

const cmds: Record<string, () => Promise<void>> = { init, rebalance, snapshot, status };
const run = cmds[process.argv[2] ?? ""];
if (!run) { console.error(`usage: cli.ts ${Object.keys(cmds).join("|")}`); process.exit(2); }
run().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
