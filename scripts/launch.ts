// Launch day in one command: checks everything first, then deploys and sets up the league on its chain.
//
//   pnpm launch                 Base Sepolia by default (the $0 path); the chain comes from deployments.json
//   pnpm launch --check         only the checks, nothing is sent
//
// Before it: `pnpm admin new-wallets --with-owner`, faucet gas for the addresses it printed, the Builder Code in
// shared/src/deployments.json, and NEXT_PUBLIC_SITE_URL and DATABASE_URL in .env (docs/runbook.md). Every step is
// skipped when it is already done, so running it again after a dropped connection carries on where it stopped.
// Keys stay in .env: this script reads them from the environment, prints only addresses, and passes the owner key
// to forge the same way the runbook's deploy command does.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { formatEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadEnv } from "../shared/src/env";

loadEnv();
const { CHAINS, GENESIS, HOUSE_AGENTS, builderCodeFromConfig, builderCodeSuffix, contractsChainId, makeContractsClient, weekIdAt, weekSchedule, pickBookAbi } = await import("../shared/src/index");

const ROOT = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const DEPLOYMENTS_FILE = process.env.DEPLOYMENTS_FILE ?? resolve(ROOT, "shared/src/deployments.json");
const forge = [`${homedir()}/.foundry/bin/forge`, "/usr/local/bin/forge", "/opt/homebrew/bin/forge"].find(existsSync);

// Rough gas needs at Base Sepolia prices, with room to spare (the rehearsal measured the deploy at 0.0000283 ETH).
const NEED = { OWNER_PRIVATE_KEY: 0.00006, RESOLVER_PRIVATE_KEY: 0.00002, BOT: 0.00002 };
const FAUCET = "portal.cdp.coinbase.com → Faucets → Base Sepolia → ETH (0.0001 ETH a claim)";

const chainId = contractsChainId();
const chain = CHAINS[chainId];
const client = makeContractsClient();
const problems: string[] = [];
const line = (ok: boolean, what: string) => console.log(`  ${ok ? "✓" : "✗"} ${what}`);
const deployments = () => JSON.parse(readFileSync(DEPLOYMENTS_FILE, "utf8")) as { genesis: number; networks: Record<string, { pickBook: string | null; prizePool: string | null; agentRoster: string | null; agentIdentities: Record<string, unknown> }> };

function run(cmd: string, a: string[], extraEnv: Record<string, string> = {}, cwd = ROOT) {
  console.log(`\n$ ${cmd} ${a.map((x) => (x.startsWith("0x") && x.length === 66 ? "<owner key from .env>" : x)).join(" ")}`);
  const r = spawnSync(cmd, a, { cwd, env: { ...process.env, ...extraEnv }, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`That step failed. Fix what it says and run pnpm launch again; finished steps are skipped.`);
}

async function checks() {
  console.log(`League chain: ${chain.name} (${chainId})\n\nChecks`);
  const code = builderCodeFromConfig();
  let codeOk = false;
  try { if (code) { builderCodeSuffix(code); codeOk = true; } } catch { /* invalid */ }
  line(codeOk, codeOk ? `Builder Code ${code}` : "Builder Code: put the code from base.dev in shared/src/deployments.json (builderCode)");
  if (!codeOk) problems.push("Builder Code");

  const site = process.env.NEXT_PUBLIC_SITE_URL;
  line(!!site, site ? `site ${site} (agent cards are registered onchain at this address)` : "NEXT_PUBLIC_SITE_URL: the site's URL, from Vercel");
  if (!site) problems.push("site URL");
  line(!!process.env.DATABASE_URL, process.env.DATABASE_URL ? "database configured" : "DATABASE_URL: from Neon (Vercel → Storage)");
  if (!process.env.DATABASE_URL) problems.push("database");
  line(!!forge, forge ? "Foundry's forge is installed" : "Foundry: install forge (getfoundry.sh)");
  if (!forge) problems.push("forge");

  const keyNames = ["OWNER_PRIVATE_KEY", "RESOLVER_PRIVATE_KEY", ...HOUSE_AGENTS.map((a) => a.keyEnv)];
  const short: string[] = [];
  for (const n of keyNames) {
    const k = process.env[n] as Hex | undefined;
    if (!k) { line(false, `${n}: run pnpm admin new-wallets --with-owner`); problems.push(n); continue; }
    const address = privateKeyToAccount(k).address;
    const eth = Number(formatEther(await client.getBalance({ address })));
    const need = n in NEED ? NEED[n as keyof typeof NEED] : NEED.BOT;
    const label = n.replace("_PRIVATE_KEY", "").replace("BOT_", "").toLowerCase();
    line(eth >= need, `${label.padEnd(10)} ${address}  ${eth.toFixed(6)} ETH${eth >= need ? "" : `  needs ${need} ETH`}`);
    if (eth < need) short.push(address);
  }
  if (short.length) {
    problems.push("gas");
    console.log(`    Gas for those addresses: ${chainId === 84532 ? FAUCET : "send ETH on Base"}`);
  }

  const d = deployments().networks[chainId];
  const s1 = weekSchedule(1);
  const now = Math.floor(Date.now() / 1000);
  if (!d?.prizePool && now >= s1.entryClose && !flag("keep-season")) {
    line(false, `season: week 1 (${new Date(GENESIS * 1000).toUTCString().slice(0, 16)}) has passed. Run pnpm admin season to start on the coming Monday (or add --keep-season)`);
    problems.push("season");
  } else {
    line(true, `season: week 1 starts ${new Date(GENESIS * 1000).toUTCString().slice(0, 16)}`);
  }
}

async function launch() {
  const verify = chainId === 84532
    ? ["--verify", "--verifier", "blockscout", "--verifier-url", "https://base-sepolia.blockscout.com/api/"]
    : process.env.BASESCAN_API_KEY ? ["--verify", "--etherscan-api-key", process.env.BASESCAN_API_KEY] : [];
  const rpc = chainId === 84532 ? (process.env.CONTRACTS_RPC_URL ?? chain.rpc) : (process.env.BASE_RPC_URL ?? chain.rpc);

  console.log("\n1. Contracts");
  if (deployments().networks[chainId]?.pickBook) console.log("  already deployed, skipped");
  else {
    const addr = (n: string) => privateKeyToAccount(process.env[n] as Hex).address;
    const started = Date.now();
    const broadcast = resolve(ROOT, "contracts", process.env.FOUNDRY_BROADCAST ?? "broadcast", `Deploy.s.sol/${chainId}/run-latest.json`);
    // If only verification fails after the contracts are deployed, record them anyway rather than deploying twice.
    const deployedNow = () => {
      if (!existsSync(broadcast) || statSync(broadcast).mtimeMs < started) return false;
      const j = JSON.parse(readFileSync(broadcast, "utf8")) as { transactions: { contractName: string }[]; receipts: { status: string }[] };
      return ["PickBook", "PrizePool", "AgentRoster"].every((c) => j.transactions.some((t) => t.contractName === c)) && j.receipts.every((r) => r.status === "0x1");
    };
    try {
      run(forge!, ["script", "script/Deploy.s.sol", "--rpc-url", rpc, "--private-key", process.env.OWNER_PRIVATE_KEY!, "--broadcast", "--slow", ...(flag("no-verify") ? [] : verify)], {
      OWNER_ADDRESS: addr("OWNER_PRIVATE_KEY"), RESOLVER_ADDRESS: addr("RESOLVER_PRIVATE_KEY"),
      SPONSOR_ADDRESS: process.env.SPONSOR_PRIVATE_KEY ? addr("SPONSOR_PRIVATE_KEY") : addr("OWNER_PRIVATE_KEY"),
      GENESIS: String(deployments().genesis),
    }, resolve(ROOT, "contracts"));
    } catch (e) {
      if (!deployedNow()) throw e;
      console.log("\n  The contracts are deployed; only source verification failed. Verify later from the explorer, or re-run forge with --resume --verify.");
    }
    run("pnpm", ["admin", "deployments", "--chain", String(chainId)]);
  }
  // Later steps run as new processes; hand them the addresses directly in case they read an older copy of the file.
  const n = deployments().networks[chainId]!;
  const env = { NEXT_PUBLIC_PICKBOOK: n.pickBook!, NEXT_PUBLIC_PRIZEPOOL: n.prizePool!, NEXT_PUBLIC_AGENTROSTER: n.agentRoster! };

  console.log("\n2. Weeks");
  const now = Math.floor(Date.now() / 1000);
  let first = Math.max(1, weekIdAt(now));
  if (now >= weekSchedule(first).entryClose) first++;
  const missing: number[] = [];
  for (let w = first; w < first + 4; w++) {
    const [, , tokens] = await client.readContract({ address: n.pickBook as Hex, abi: pickBookAbi, functionName: "getWeek", args: [w] });
    if (!tokens.length) missing.push(w);
  }
  if (!missing.length) console.log(`  weeks ${first}–${first + 3} already set, skipped`);
  else run("pnpm", ["admin", "set-weeks", String(missing[0]), String(missing[missing.length - 1])], env);

  console.log("\n3. House bots");
  run("pnpm", ["--filter", "@btb/bots", "exec", "tsx", "src/cli.ts", "init"], env);
  if (Object.keys(deployments().networks[chainId]!.agentIdentities ?? {}).length >= HOUSE_AGENTS.length) console.log("  identities already registered, skipped");
  else run("pnpm", ["admin", "register-agents"], env);

  console.log("\n4. Telegram");
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_WEBHOOK_SECRET) run("pnpm", ["admin", "telegram-webhook"], env);
  else console.log("  no bot token yet, skipped (BotFather, then pnpm admin telegram-webhook)");

  const d = deployments().networks[chainId]!;
  console.log(`\nThe league is set up on ${chain.name}.`);
  console.log(`  PickBook     ${chain.explorer}/address/${d.pickBook}`);
  console.log(`  AgentRoster  ${chain.explorer}/address/${d.agentRoster}`);
  console.log(`  PrizePool    ${chain.explorer}/address/${d.prizePool}`);
  console.log(`\nNext: commit shared/src/deployments.json and push, so the site and the jobs pick up the addresses. The bots lock their picks on their own once entries open (${new Date(weekSchedule(first).entryOpen * 1000).toUTCString().slice(0, 22)} UTC).`);
}

await checks();
if (problems.length) {
  console.log(`\nNot ready: ${problems.join(", ")}. Nothing was sent.`);
  process.exit(1);
}
if (flag("check")) { console.log("\nReady. Run pnpm launch to deploy."); process.exit(0); }
await launch().catch((e) => { console.error(`\n${(e as Error).message}`); process.exit(1); });
process.exit(0);
