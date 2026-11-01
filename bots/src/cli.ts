// House bots: rebalance on Monday after the US open, hourly NAV snapshots, status.
//   pnpm --filter @btb/bots rebalance [--bot momentum] [--dry-run]
//   pnpm --filter @btb/bots snapshot
//   pnpm --filter @btb/bots status
import { formatEther, type Address } from "viem";
import { HOUSE_AGENTS, makePublicClient, requireBuilderCode, valueWallet } from "@btb/shared";
import { getDb, migrate } from "@btb/shared/db";
import { loadEnv } from "@btb/shared/env";
import { botAddress, botsDue, initAgents, rebalanceBot } from "./run";
import { hourStamp, snapshotWallets } from "./nav";

loadEnv();
const args = process.argv.slice(3);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const client = makePublicClient();

async function init() {
  const db = await getDb();
  await migrate(db);
  await initAgents(db);
}

async function rebalance() {
  const db = await getDb();
  const builderCode = requireBuilderCode();
  const dry = flag("dry-run");
  if (!dry && !botsDue()) {
    console.log("Market closed or entries still open: bots trade after the US open on the week's first trading day.");
    return;
  }
  for (const a of HOUSE_AGENTS.filter((x) => !opt("bot") || x.id === opt("bot"))) {
    console.log(`${a.name}: ${await rebalanceBot(a, { client, db, builderCode, dry })}`);
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
