// Admin commands for Kenichi. Keys are read from the repo-root .env (never committed, never printed).
//   pnpm admin new-wallets            create resolver, sponsor and 3 bot keys in .env; prints addresses only
//   pnpm admin status                 what is configured, deployed and funded
//   pnpm admin deployments            copy addresses from the last forge deploy into shared/src/deployments.json
//   pnpm admin set-weeks 1 4          owner: write week schedules and the universe to PickBook
//   pnpm admin fund-prizes --week 1 --real 40 --paper 10 [--token NVDA]   sponsor: buy the prize stock, fund the pool
//   pnpm admin register-agents        each bot: ERC-8004 identity + AgentRoster entry
//   pnpm admin kill-switch on|off     on = /trade view-only for buying (sells stay open)
//   pnpm admin auto-settle on|off     from week 3, settle automatically after scoring
//   pnpm admin telegram-webhook       point the Telegram bot at the site
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createWalletClient, http, keccak256, parseEventLogs, toBytes, formatEther, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import {
  ADDR, CHAIN_ID, HOUSE_AGENTS, UNIVERSE, DEPLOYMENTS, contracts, makePublicClient, weekSchedule, quote, buildSwapCalls,
  builderCodeSuffix, requireBuilderCode, pickBookAbi, prizePoolAbi, agentRosterAbi, erc20Abi, erc8004IdentityAbi, valueWallet,
} from "../shared/src/index";
import { getDb, kvSet, migrate } from "../shared/src/db";
import { loadEnv, need } from "../shared/src/env";

loadEnv();
const client = makePublicClient();
const [cmd, ...args] = process.argv.slice(2);
const opt = (n: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined);
const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";

const wallet = (envName: string) =>
  createWalletClient({
    account: privateKeyToAccount(need(envName) as Hex),
    chain: base,
    transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org"),
    dataSuffix: builderCodeSuffix(requireBuilderCode()),
  });

async function newWallets() {
  const path = ".env";
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  const names = ["RESOLVER_PRIVATE_KEY", "SPONSOR_PRIVATE_KEY", ...HOUSE_AGENTS.map((a) => a.keyEnv)];
  if (args.includes("--with-owner")) names.unshift("OWNER_PRIVATE_KEY");
  let added = "";
  for (const n of names) {
    if (new RegExp(`^${n}=`, "m").test(current)) { console.log(`${n} already set, kept`); continue; }
    const key = generatePrivateKey();
    added += `${n}=${key}\n`;
    console.log(`${n.replace("_PRIVATE_KEY", "").padEnd(16)} ${privateKeyToAccount(key).address}`);
  }
  if (added) appendFileSync(path, (current && !current.endsWith("\n") ? "\n" : "") + added, { mode: 0o600 });
  console.log("\nKeys were written to .env (never committed). Only the addresses above were printed.");
}

async function status() {
  const c = contracts();
  console.log("Builder Code   ", DEPLOYMENTS.builderCode ?? process.env.BUILDER_CODE ?? "MISSING (base.dev)");
  console.log("PickBook       ", c.pickBook ?? "not deployed");
  console.log("PrizePool      ", c.prizePool ?? "not deployed");
  console.log("AgentRoster    ", c.agentRoster ?? "not deployed");
  for (const n of ["OWNER_PRIVATE_KEY", "RESOLVER_PRIVATE_KEY", "SPONSOR_PRIVATE_KEY", ...HOUSE_AGENTS.map((a) => a.keyEnv)]) {
    const k = process.env[n] as Hex | undefined;
    if (!k) { console.log(`${n.padEnd(26)} not set`); continue; }
    const a = privateKeyToAccount(k).address;
    const [eth, v] = await Promise.all([client.getBalance({ address: a }), valueWallet(client, a)]);
    console.log(`${n.padEnd(26)} ${a}  ETH ${Number(formatEther(eth)).toFixed(5)}  USDC $${(Number(v.usdcRaw) / 1e6).toFixed(2)}  stocks $${(v.navUsd - Number(v.usdcRaw) / 1e6).toFixed(2)}`);
  }
  for (const n of ["DATABASE_URL", "BASE_RPC_URL", "PAYMASTER_URL", "SESSION_SECRET", "TELEGRAM_BOT_TOKEN", "TELEGRAM_GROUP_CHAT_ID", "LLM_API_KEY", "NEXT_PUBLIC_SITE_URL"]) {
    console.log(`${n.padEnd(26)} ${process.env[n] ? "set" : "not set"}`);
  }
}

async function deployments() {
  const f = "contracts/broadcast/Deploy.s.sol/8453/run-latest.json";
  const j = JSON.parse(readFileSync(f, "utf8")) as { transactions: { contractName: string; contractAddress: Address; hash: Hex }[]; receipts: { blockNumber: string }[] };
  const byName = Object.fromEntries(j.transactions.map((t) => [t.contractName, t.contractAddress]));
  const d = JSON.parse(readFileSync("shared/src/deployments.json", "utf8"));
  d.pickBook = byName.PickBook; d.prizePool = byName.PrizePool; d.agentRoster = byName.AgentRoster;
  d.deployedBlock = Math.min(...j.receipts.map((r) => Number(r.blockNumber)));
  writeFileSync("shared/src/deployments.json", JSON.stringify(d, null, 2) + "\n");
  console.log(d);
}

async function setWeeks() {
  const from = Number(args[0]), to = Number(args[1] ?? args[0]);
  const pickBook = contracts().pickBook;
  if (!pickBook) throw new Error("Deploy PickBook first");
  const w = wallet("OWNER_PRIVATE_KEY");
  const db = await getDb(); await migrate(db);
  for (let week = from; week <= to; week++) {
    const s = weekSchedule(week);
    const tokens = UNIVERSE.map((u) => u.address);
    const hash = await w.writeContract({ address: pickBook, abi: pickBookAbi, functionName: "setWeek", args: [week, BigInt(s.entryOpen), BigInt(s.entryClose), tokens] });
    await client.waitForTransactionReceipt({ hash });
    await db.query(
      `insert into weeks (week, entry_open, entry_close, score_at, universe) values ($1, $2, $3, $4, $5::jsonb) on conflict (week) do update set universe = excluded.universe`,
      [week, s.entryOpen, s.entryClose, s.scoreAt, JSON.stringify(tokens)],
    );
    console.log(`week ${week}: ${hash}`);
  }
}

async function fundPrizes() {
  const week = Number(opt("week")), real = Number(opt("real") ?? 40), paper = Number(opt("paper") ?? 10);
  const ticker = opt("token") ?? "USDC";
  const pool = contracts().prizePool;
  if (!pool) throw new Error("Deploy PrizePool first");
  const w = wallet("SPONSOR_PRIVATE_KEY");
  const me = w.account.address;
  const totalUsdc = BigInt(Math.round((real + paper) * 1e6));
  let token: Address = ADDR.USDC;
  let amount = totalUsdc;
  if (ticker !== "USDC") {
    const t = UNIVERSE.find((u) => u.ticker === ticker);
    if (!t) throw new Error(`Unknown stock ${ticker}`);
    const q = await quote(client, t, "buy", totalUsdc);
    const [approve, swap] = buildSwapCalls(q, me, BigInt(Math.floor(Date.now() / 1000) + 600));
    await client.waitForTransactionReceipt({ hash: await w.sendTransaction({ to: approve!.to, data: approve!.data }) });
    const before = await client.readContract({ address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [me] });
    const swapTx = await w.sendTransaction({ to: swap!.to, data: swap!.data });
    await client.waitForTransactionReceipt({ hash: swapTx });
    amount = (await client.readContract({ address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [me] })) - before;
    token = t.address;
    console.log(`bought ${Number(amount) / 1e8} ${t.symbol}: ${swapTx}`);
  }
  await client.waitForTransactionReceipt({ hash: await w.writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [pool, amount] }) });
  const fundTx = await w.writeContract({ address: pool, abi: prizePoolAbi, functionName: "fund", args: [week, token, amount] });
  await client.waitForTransactionReceipt({ hash: fundTx });
  const realRaw = (amount * BigInt(Math.round(real * 100))) / BigInt(Math.round((real + paper) * 100));
  const db = await getDb(); await migrate(db);
  const s = weekSchedule(week);
  await db.query(
    `insert into weeks (week, entry_open, entry_close, score_at, universe, prize_token, real_pot_raw, paper_pot_raw, fund_txs)
     values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::jsonb)
     on conflict (week) do update set prize_token = excluded.prize_token, real_pot_raw = excluded.real_pot_raw, paper_pot_raw = excluded.paper_pot_raw,
       fund_txs = coalesce(weeks.fund_txs, '[]'::jsonb) || excluded.fund_txs`,
    [week, s.entryOpen, s.entryClose, s.scoreAt, JSON.stringify(UNIVERSE.map((u) => u.address)), token, realRaw.toString(), (amount - realRaw).toString(), JSON.stringify([{ token, tx: fundTx, amount: amount.toString() }])],
  );
  console.log(`funded week ${week} with ${amount} of ${token}: ${fundTx}`);
}

async function registerAgents() {
  const roster = contracts().agentRoster;
  if (!roster || !site) throw new Error("Deploy AgentRoster and set NEXT_PUBLIC_SITE_URL first");
  const termsHash = keccak256(toBytes(readFileSync("docs/legal/agent-terms.md", "utf8")));
  const d = JSON.parse(readFileSync("shared/src/deployments.json", "utf8"));
  const db = await getDb(); await migrate(db);
  for (const a of HOUSE_AGENTS) {
    if (d.agentIdentities?.[a.id]) { console.log(`${a.name} already registered`); continue; }
    const w = wallet(a.keyEnv);
    const uri = `${site}/agents/${a.id}/card.json`;
    const regTx = await w.writeContract({ address: ADDR.ERC8004_IDENTITY, abi: erc8004IdentityAbi, functionName: "register", args: [uri] });
    const rc = await client.waitForTransactionReceipt({ hash: regTx });
    const ev = parseEventLogs({ abi: erc8004IdentityAbi, logs: rc.logs, eventName: "Registered" })[0];
    if (!ev) throw new Error(`No Registered event in ${regTx}`);
    const agentId = ev.args.agentId;
    const rTx = await w.writeContract({ address: roster, abi: agentRosterAbi, functionName: "register", args: [w.account.address, uri, agentId, termsHash] });
    await client.waitForTransactionReceipt({ hash: rTx });
    d.agentIdentities = { ...(d.agentIdentities ?? {}), [a.id]: { erc8004Id: agentId.toString(), registerTx: regTx, rosterTx: rTx } };
    await db.query("update agents set erc8004_id = $2 where id = $1", [a.id, agentId.toString()]);
    console.log(`${a.name}: ERC-8004 agent #${agentId} (${regTx}), roster ${rTx}`);
  }
  writeFileSync("shared/src/deployments.json", JSON.stringify(d, null, 2) + "\n");
}

async function flagCmd(key: string, on: string, off: string) {
  const v = args[0];
  if (v !== "on" && v !== "off") throw new Error("on or off");
  const db = await getDb(); await migrate(db);
  await kvSet(db, key, v === "on" ? on : off);
  console.log(`${key} = ${v === "on" ? on : off}`);
}

async function telegramWebhook() {
  const token = need("TELEGRAM_BOT_TOKEN"), secret = need("TELEGRAM_WEBHOOK_SECRET");
  const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: `${need("NEXT_PUBLIC_SITE_URL")}/api/telegram`, secret_token: secret, allowed_updates: ["message"] }),
  });
  console.log(await r.json());
}

const cmds: Record<string, () => Promise<void>> = {
  "new-wallets": newWallets, status, deployments, "set-weeks": setWeeks, "fund-prizes": fundPrizes, "register-agents": registerAgents,
  "kill-switch": () => flagCmd("trade_mode", "view-only", "live"), "auto-settle": () => flagCmd("auto_settle", true as never, false as never),
  "telegram-webhook": telegramWebhook,
};
const run = cmds[cmd ?? ""];
if (!run) { console.error(`usage: pnpm admin ${Object.keys(cmds).join("|")}`); process.exit(2); }
run().then(() => process.exit(0), (e) => { console.error((e as Error).message); process.exit(1); });
void CHAIN_ID;
