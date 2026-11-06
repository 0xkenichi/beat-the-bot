// Admin commands for Kenichi. Keys are read from the repo-root .env (never committed, never printed).
//   pnpm admin new-wallets            create resolver, sponsor and 3 bot keys in .env; prints addresses only
//   pnpm admin status                 what is configured, deployed and funded (league chain and Base)
//   pnpm admin deployments [--chain 84532]   copy addresses from the last forge deploy into shared/src/deployments.json
//   pnpm admin set-weeks 1 4          owner: write week schedules and the universe to PickBook
//   pnpm admin fund-prizes --week 1 --real 40 --paper 10 [--token NVDA]   sponsor: buy the prize stock, fund the pool
//                                     (funded path only: needs the contracts on Base, see docs/runbook.md)
//   pnpm admin register-agents        each bot: ERC-8004 identity + AgentRoster entry, on the league chain
//   pnpm admin kill-switch on|off     on = /trade view-only for buying (sells stay open)
//   pnpm admin auto-settle on|off     from week 3, settle automatically after scoring
//   pnpm admin telegram-webhook       point the Telegram bot at the site
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createWalletClient, http, keccak256, parseEventLogs, toBytes, formatEther, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import {
  ADDR, CHAIN_ID, CHAINS, HOUSE_AGENTS, UNIVERSE, contracts, contractsChainId, makePublicClient, makeContractsClient, makeContractsWallet,
  weekSchedule, quote, buildSwapCalls, builderCodeFromConfig, builderCodeSuffix, requireBuilderCode, pickBookAbi, prizePoolAbi,
  agentRosterAbi, erc20Abi, erc8004IdentityAbi, valueWallet, explorerTx,
} from "../shared/src/index";
import { getDb, kvSet, migrate } from "../shared/src/db";
import { loadEnv, need } from "../shared/src/env";

loadEnv();
const client = makePublicClient(); // Base: stocks, USDC, prices
const league = makeContractsClient(); // the chain PickBook, PrizePool and AgentRoster live on
const leagueChain = contractsChainId();
const [cmd, ...args] = process.argv.slice(2);
const opt = (n: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined);
const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";
// Overridable so a rehearsal (scripts/rehearse) never touches the real files.
const DEPLOYMENTS_FILE = process.env.DEPLOYMENTS_FILE ?? "shared/src/deployments.json";
const BROADCAST_DIR = process.env.FOUNDRY_BROADCAST ?? "contracts/broadcast";

/** A key's wallet on the league chain (Base Sepolia on the $0 path), with the Builder Code on every transaction. */
const leagueWallet = (envName: string) => makeContractsWallet(need(envName) as Hex);
/** A key's wallet on Base, for stock purchases. */
const baseWallet = (envName: string) =>
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
  const name = CHAINS[c.chainId].name;
  console.log("Builder Code   ", builderCodeFromConfig() ?? "MISSING (base.dev)");
  console.log("League chain   ", `${name} (${c.chainId})${c.chainId === CHAIN_ID ? "" : ", trading on Base"}`);
  console.log("PickBook       ", c.pickBook ?? "not deployed");
  console.log("PrizePool      ", c.prizePool ?? "not deployed");
  console.log("AgentRoster    ", c.agentRoster ?? "not deployed");
  const testnet = c.chainId !== CHAIN_ID;
  for (const n of ["OWNER_PRIVATE_KEY", "RESOLVER_PRIVATE_KEY", "SPONSOR_PRIVATE_KEY", ...HOUSE_AGENTS.map((a) => a.keyEnv)]) {
    const k = process.env[n] as Hex | undefined;
    if (!k) { console.log(`${n.padEnd(26)} not set`); continue; }
    const a = privateKeyToAccount(k).address;
    const [eth, leagueEth, v] = await Promise.all([client.getBalance({ address: a }), testnet ? league.getBalance({ address: a }) : null, valueWallet(client, a)]);
    const gas = leagueEth === null ? "" : `${name} ETH ${Number(formatEther(leagueEth)).toFixed(5)}  `;
    console.log(`${n.padEnd(26)} ${a}  ${gas}Base ETH ${Number(formatEther(eth)).toFixed(5)}  USDC $${(Number(v.usdcRaw) / 1e6).toFixed(2)}  stocks $${(v.navUsd - Number(v.usdcRaw) / 1e6).toFixed(2)}`);
  }
  for (const n of ["DATABASE_URL", "BASE_RPC_URL", "CONTRACTS_RPC_URL", "PAYMASTER_URL", "PAYMASTER_URL_SEPOLIA", "SESSION_SECRET", "TELEGRAM_BOT_TOKEN", "TELEGRAM_GROUP_CHAT_ID", "LLM_API_KEY", "NEXT_PUBLIC_SITE_URL"]) {
    console.log(`${n.padEnd(26)} ${process.env[n] ? "set" : "not set"}`);
  }
}

async function deployments() {
  const chain = Number(opt("chain") ?? leagueChain);
  if (!(chain in CHAINS)) throw new Error(`--chain must be one of ${Object.keys(CHAINS).join(", ")}`);
  const f = `${BROADCAST_DIR}/Deploy.s.sol/${chain}/run-latest.json`;
  const j = JSON.parse(readFileSync(f, "utf8")) as { transactions: { contractName: string; contractAddress: Address; hash: Hex }[]; receipts: { blockNumber: string }[] };
  const byName = Object.fromEntries(j.transactions.map((t) => [t.contractName, t.contractAddress]));
  const d = JSON.parse(readFileSync(DEPLOYMENTS_FILE, "utf8"));
  const n = d.networks[chain];
  n.pickBook = byName.PickBook; n.prizePool = byName.PrizePool; n.agentRoster = byName.AgentRoster;
  n.deployedBlock = Math.min(...j.receipts.map((r) => Number(r.blockNumber)));
  d.contractsChain = chain;
  writeFileSync(DEPLOYMENTS_FILE, JSON.stringify(d, null, 2) + "\n");
  console.log(`${CHAINS[chain as keyof typeof CHAINS].name}:`, n);
}

async function setWeeks() {
  const from = Number(args[0]), to = Number(args[1] ?? args[0]);
  const pickBook = contracts().pickBook;
  if (!pickBook) throw new Error("Deploy PickBook first");
  const w = leagueWallet("OWNER_PRIVATE_KEY");
  const db = await getDb(); await migrate(db);
  for (let week = from; week <= to; week++) {
    const s = weekSchedule(week);
    const tokens = UNIVERSE.map((u) => u.address);
    const hash = await w.writeContract({ address: pickBook, abi: pickBookAbi, functionName: "setWeek", args: [week, BigInt(s.entryOpen), BigInt(s.entryClose), tokens] });
    await league.waitForTransactionReceipt({ hash });
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
  if (leagueChain !== CHAIN_ID) {
    throw new Error("Real prizes need the PrizePool on Base: the contracts are on the test network now. See \"Funded path\" in docs/runbook.md.");
  }
  const w = baseWallet("SPONSOR_PRIVATE_KEY");
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
  const { agentRoster: roster, erc8004Identity, chainId } = contracts();
  if (!roster || !site) throw new Error("Deploy AgentRoster and set NEXT_PUBLIC_SITE_URL first");
  const termsHash = keccak256(toBytes(readFileSync("docs/legal/agent-terms.md", "utf8")));
  const d = JSON.parse(readFileSync(DEPLOYMENTS_FILE, "utf8"));
  const n = d.networks[chainId];
  const db = await getDb(); await migrate(db);
  for (const a of HOUSE_AGENTS) {
    if (n.agentIdentities?.[a.id]) { console.log(`${a.name} already registered`); continue; }
    const w = leagueWallet(a.keyEnv);
    const uri = `${site}/agents/${a.id}/card.json`;
    const regTx = await w.writeContract({ address: erc8004Identity, abi: erc8004IdentityAbi, functionName: "register", args: [uri] });
    const rc = await league.waitForTransactionReceipt({ hash: regTx });
    const ev = parseEventLogs({ abi: erc8004IdentityAbi, logs: rc.logs, eventName: "Registered" })[0];
    if (!ev) throw new Error(`No Registered event in ${regTx}`);
    const agentId = ev.args.agentId;
    const rTx = await w.writeContract({ address: roster, abi: agentRosterAbi, functionName: "register", args: [w.account.address, uri, agentId, termsHash] });
    await league.waitForTransactionReceipt({ hash: rTx });
    n.agentIdentities = { ...(n.agentIdentities ?? {}), [a.id]: { erc8004Id: agentId.toString(), registerTx: regTx, rosterTx: rTx } };
    await db.query("update agents set erc8004_id = $2, identity_chain = $3 where id = $1", [a.id, agentId.toString(), chainId]);
    console.log(`${a.name}: ERC-8004 agent #${agentId} ${explorerTx(chainId, regTx)}, roster ${explorerTx(chainId, rTx)}`);
  }
  writeFileSync(DEPLOYMENTS_FILE, JSON.stringify(d, null, 2) + "\n");
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
