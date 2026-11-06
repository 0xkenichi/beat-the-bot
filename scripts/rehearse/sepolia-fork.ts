// Dress rehearsal of the $0 setup (docs/runbook.md) on a local copy of Base Sepolia, with throwaway keys.
//
//   pnpm rehearse            (needs Foundry's anvil and forge, a web build, and internet for the two public RPCs;
//                             run it outside Monday's entry window, which it simulates for the coming week)
//
// It forks Base Sepolia with anvil and runs the runbook's own commands against the fork: the forge deploy,
// `pnpm admin deployments / set-weeks / register-agents / status` and the bots' init. Then an outside agent that
// never pays league gas joins and picks through the real web routes (the same calls a Bankr agent makes), and the
// scheduler's tick runs twice: once now (the signed entry goes onchain, the early picks wait) and then on Monday
// morning (the bots lock their picks and the agent's picks go in). Finally it checks the database, the web pages and
// the Builder Code on every transaction.
//
// Nothing here touches Kenichi's .env, keys, database, deployments.json or broadcast files: everything runs from a
// temporary folder with anvil's public development keys and a generated agent key, and nothing is sent to a real chain.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createPublicClient, http, parseEventLogs, type Address, type Hex, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const ROOT = resolve(import.meta.dirname, "../..");
const bin = (name: string) => [`${homedir()}/.foundry/bin/${name}`, `/usr/local/bin/${name}`, `/opt/homebrew/bin/${name}`].find(existsSync);
const ANVIL = bin("anvil"), FORGE = bin("forge");
if (!ANVIL || !FORGE) throw new Error("Install Foundry first (anvil and forge)");
if (!existsSync(join(ROOT, "web/.next/BUILD_ID"))) throw new Error("Build the site first: pnpm --dir web exec next build");

// anvil's well-known development keys (public; worthless anywhere but a local chain)
const DEV = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
  "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
] as const;
const KEYS = {
  OWNER_PRIVATE_KEY: DEV[0], RESOLVER_PRIVATE_KEY: DEV[1], SPONSOR_PRIVATE_KEY: DEV[2],
  BOT_MOMENTUM_PRIVATE_KEY: DEV[3], BOT_CONTRARIAN_PRIVATE_KEY: DEV[4], BOT_STEADY_PRIVATE_KEY: DEV[5],
};
const PLAYER_KEY = DEV[6];
const AGENT_KEY = generatePrivateKey(); // a fresh wallet with no gas on the league chain
const CODE = "bc_rehearsal";

const work = mkdtempSync(join(tmpdir(), "btb-rehearsal-"));
const port = 8700 + Math.floor(Math.random() * 200);
const webPort = port + 300;
const rpc = `http://127.0.0.1:${port}`;
const SEPOLIA_RPC = process.env.REHEARSAL_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";
const site = `http://127.0.0.1:${webPort}`;

// The whole environment, built from scratch so nothing from the caller's shell (keys, Telegram, databases) leaks in.
const ENV: Record<string, string> = {
  PATH: process.env.PATH ?? "", HOME: homedir(), TMPDIR: tmpdir(),
  BTB_NO_DOTENV: "1",
  CONTRACTS_CHAIN_ID: "84532",
  CONTRACTS_RPC_URL: rpc,
  BASE_RPC_URL: process.env.REHEARSAL_BASE_RPC_URL ?? "https://base-mainnet.g.alchemy.com/public",
  DATABASE_URL: `pglite:${join(work, "db")}`,
  BUILDER_CODE: CODE,
  NEXT_PUBLIC_SITE_URL: site,
  SESSION_SECRET: "rehearsal-only-not-a-secret-0123456789abcdef",
  DEPLOYMENTS_FILE: join(work, "deployments.json"),
  FOUNDRY_BROADCAST: join(work, "broadcast"),
  FOUNDRY_CACHE_PATH: join(work, "forge-cache"),
  NEXT_TELEMETRY_DISABLED: "1",
  ...KEYS,
};

let failures = 0;
const ok = (what: string) => console.log(`  ✓ ${what}`);
function check(cond: unknown, what: string, detail?: unknown) {
  if (cond) return ok(what);
  failures++;
  console.log(`  ✗ ${what}${detail === undefined ? "" : `: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
}
const step = (title: string) => console.log(`\n${title}`);

function run(cmd: string, args: string[], o: { cwd?: string; env?: Record<string, string> } = {}): string {
  const r = spawnSync(cmd, args, { cwd: o.cwd ?? ROOT, env: { ...ENV, ...o.env }, encoding: "utf8", maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed:\n${(r.stdout ?? "").slice(-2000)}\n${(r.stderr ?? "").slice(-2000)}`);
  return r.stdout;
}

const children: ChildProcess[] = [];
function startProcess(cmd: string, args: string[], cwd = ROOT): ChildProcess {
  const p = spawn(cmd, args, { cwd, env: ENV, stdio: "ignore" });
  children.push(p);
  return p;
}
async function waitFor(f: () => Promise<unknown>, what: string, tries = 150) {
  for (let i = 0; i < tries; i++) {
    try { await f(); return; } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  throw new Error(`${what} did not start`);
}
async function stop(p: ChildProcess) {
  if (p.exitCode !== null) return;
  p.kill("SIGTERM");
  await new Promise((r) => p.once("exit", r));
}
async function web<T>(path: string, body?: unknown): Promise<{ status: number; json: T }> {
  const r = await fetch(`${site}${path}`, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json()) as T };
}
const page = async (path: string) => (await fetch(`${site}${path}`)).text();

async function main() {
  // Every module below reads its settings from process.env, so it gets the same clean environment as the children.
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, ENV);
  const shared = await import("../../shared/src/index");
  const { openDb } = await import("../../shared/src/db");
  const { runTick } = await import("../../scoring/src/jobs");
  const { UNIVERSE, weekSchedule, weekIdAt, GENESIS, hasBuilderCode, pickBookAbi, erc8004IdentityAbi, makeContractsWallet, makePublicClient, weekTable } = { ...shared, weekTable: (await import("../../shared/src/league")).weekTable };

  console.log(`Rehearsal folder: ${work}`);
  // The rehearsal plays the next week whose entries are still to open (week 1 before the season starts).
  const startedAt = Math.floor(Date.now() / 1000);
  let W = Math.max(1, weekIdAt(startedAt));
  if (startedAt >= weekSchedule(W).entryOpen) W++;
  const s = weekSchedule(W);
  step("1. A local copy of Base Sepolia");
  // Generous retries: the fork fetches state from the public RPC as it goes, and mobile connections drop.
  const anvil = startProcess(ANVIL!, ["--fork-url", SEPOLIA_RPC, "--port", String(port), "--silent", "--retries", "30", "--fork-retry-backoff", "2000", "--timeout", "60000"]);
  const chain = createPublicClient({ chain: baseSepolia, transport: http(rpc) }) as PublicClient;
  await waitFor(() => chain.getChainId(), "anvil");
  check((await chain.getChainId()) === 84532, `forked Base Sepolia at block ${await chain.getBlockNumber()}`);
  const registryCode = await chain.getCode({ address: shared.CHAINS[84532].erc8004Identity });
  check(!!registryCode && registryCode.length > 2, "ERC-8004 Identity Registry is there");

  step("2. Deploy, exactly as the runbook says");
  const addr = (k: string) => privateKeyToAccount(k as Hex).address;
  run(FORGE!, ["script", "script/Deploy.s.sol", "--rpc-url", rpc, "--private-key", KEYS.OWNER_PRIVATE_KEY, "--broadcast", "--slow"], {
    cwd: join(ROOT, "contracts"),
    env: { OWNER_ADDRESS: addr(KEYS.OWNER_PRIVATE_KEY), RESOLVER_ADDRESS: addr(KEYS.RESOLVER_PRIVATE_KEY), SPONSOR_ADDRESS: addr(KEYS.SPONSOR_PRIVATE_KEY), GENESIS: String(GENESIS) },
  });
  check(existsSync(join(ENV.FOUNDRY_BROADCAST!, "Deploy.s.sol/84532/run-latest.json")), "forge script deployed the three contracts (broadcast kept in the rehearsal folder)");
  copyFileSync(join(ROOT, "shared/src/deployments.json"), ENV.DEPLOYMENTS_FILE!);
  run("pnpm", ["admin", "deployments", "--chain", "84532"]);
  const dep = JSON.parse(readFileSync(ENV.DEPLOYMENTS_FILE!, "utf8")).networks["84532"];
  check(dep.pickBook && dep.prizePool && dep.agentRoster && dep.deployedBlock, "pnpm admin deployments recorded the addresses", dep);
  Object.assign(ENV, { NEXT_PUBLIC_PICKBOOK: dep.pickBook, NEXT_PUBLIC_PRIZEPOOL: dep.prizePool, NEXT_PUBLIC_AGENTROSTER: dep.agentRoster });
  Object.assign(process.env, ENV);
  const gasUsed = await Promise.all(
    JSON.parse(readFileSync(join(ENV.FOUNDRY_BROADCAST!, "Deploy.s.sol/84532/run-latest.json"), "utf8")).receipts.map((r: { gasUsed: string; effectiveGasPrice: string }) => BigInt(r.gasUsed) * BigInt(r.effectiveGasPrice)),
  );
  const deployEth = Number(gasUsed.reduce((a: bigint, b: bigint) => a + b, 0n)) / 1e18;
  check(deployEth < 0.0002, `deploy cost ${deployEth.toFixed(7)} ETH at the fork's gas price (two faucet claims cover 0.0002)`);

  step("3. Weeks, bots and their identities");
  run("pnpm", ["admin", "set-weeks", String(W), String(W + 1)]);
  const [, , tokens] = await chain.readContract({ address: dep.pickBook, abi: pickBookAbi, functionName: "getWeek", args: [W] });
  check(tokens.length === UNIVERSE.length, `week ${W} is set with ${tokens.length} stocks`);
  run("pnpm", ["--filter", "@btb/bots", "exec", "tsx", "src/cli.ts", "init"]);
  run("pnpm", ["admin", "register-agents"]);
  const ids = JSON.parse(readFileSync(ENV.DEPLOYMENTS_FILE!, "utf8")).networks["84532"].agentIdentities;
  check(Object.keys(ids).length === 3, `three house bots registered: ${Object.entries(ids).map(([k, v]) => `${k} #${(v as { erc8004Id: string }).erc8004Id}`).join(", ")}`);
  const status = run("pnpm", ["admin", "status"]);
  check(status.includes("Base Sepolia (84532)"), "pnpm admin status shows the league chain");

  step("4. An outside agent joins and picks by signature, through the web routes");
  const webServer = startProcess("pnpm", ["--dir", "web", "exec", "next", "start", "-p", String(webPort)]);
  await waitFor(() => fetch(`${site}/api/agents/kit`).then((r) => { if (!r.ok) throw new Error(); }), "the site");
  const agent = privateKeyToAccount(AGENT_KEY);
  const kit = await web<{ chains: { league: { chainId: number } } }>("/api/agents/kit");
  check(kit.json.chains.league.chainId === 84532, "/api/agents/kit names Base Sepolia as the league chain");

  // The identity is the one transaction this agent sends (on Base it would be Bankr's /agent/submit).
  await chain.request({ method: "anvil_setBalance" as never, params: [agent.address, "0x2386F26FC10000"] as never }); // 0.01 ETH
  const idRes = await web<{ transaction: { to: Address; data: Hex; chainId: number } }>(`/api/agents/kit/identity?wallet=${agent.address}&name=Rehearsal%20Agent&strategy=${encodeURIComponent("Buys the three steadiest stocks of the week.")}`);
  check(idRes.status === 200 && idRes.json.transaction.chainId === 84532, "identity route returns a Base Sepolia transaction", idRes.json);
  check(hasBuilderCode(idRes.json.transaction.data, CODE), "it carries the Builder Code");
  const agentWallet = makeContractsWallet(AGENT_KEY);
  const idHash = await agentWallet.sendTransaction({ to: idRes.json.transaction.to, data: idRes.json.transaction.data });
  const idRc = await chain.waitForTransactionReceipt({ hash: idHash });
  const erc8004Id = parseEventLogs({ abi: erc8004IdentityAbi, logs: idRc.logs, eventName: "Registered" })[0]!.args.agentId;
  ok(`agent's ERC-8004 identity is #${erc8004Id}`);
  const nonceAfterIdentity = await chain.getTransactionCount({ address: agent.address });

  // Join by signature: sign the typed data exactly as the route returns it (JSON, as Bankr's /agent/sign receives it).
  const q = `wallet=${agent.address}&erc8004Id=${erc8004Id}&identityChain=84532`;
  const join1 = await web<{ typedData: { message: { deadline: string } } & Record<string, unknown> }>(`/api/agents/kit/join-signed?${q}`);
  check(join1.status === 200, "join-signed returns an entry to sign", join1.json);
  const joinSig = await agent.signTypedData(join1.json.typedData as never);
  const bad = await web<{ error?: string }>("/api/agents/kit/join-signed", { wallet: agent.address, erc8004Id: String(erc8004Id), identityChain: 84532, deadline: join1.json.typedData.message.deadline, signature: await privateKeyToAccount(PLAYER_KEY).signTypedData(join1.json.typedData as never) });
  check(bad.status === 400, "a signature from another wallet is refused", bad.json);
  const join2 = await web<{ ok?: boolean; error?: string }>("/api/agents/kit/join-signed", { wallet: agent.address, erc8004Id: String(erc8004Id), identityChain: 84532, deadline: join1.json.typedData.message.deadline, signature: joinSig });
  check(join2.json.ok, "the signed entry is accepted", join2.json);

  const picks = "NVDA:50,TSLA:30,MSFT:20";
  const pick1 = await web<{ week: number; typedData: Record<string, unknown> }>(`/api/agents/kit/pick-signed?wallet=${agent.address}&picks=${picks}`);
  check(pick1.status === 200 && pick1.json.week === W, `pick-signed returns week ${W}'s lock to sign`, pick1.json);
  const pick2 = await web<{ ok?: boolean; note?: string; error?: string }>("/api/agents/kit/pick-signed", { wallet: agent.address, picks, signature: await agent.signTypedData(pick1.json.typedData as never) });
  check(pick2.json.ok, `the signed picks are accepted ("${pick2.json.note ?? pick2.json.error}")`);
  await stop(webServer);

  step("5. The scheduler, now (before entries open)");
  const db = await openDb(ENV.DATABASE_URL);
  const base = makePublicClient();
  const quiet: string[] = [];
  const now = Math.floor(Date.now() / 1000);
  await runTick(base, db, { now, log: (s) => quiet.push(s) });
  const [reg] = await db.query<{ relayed_tx: string | null; error: string | null }>("select relayed_tx, error from signed_registrations where wallet = $1", [agent.address.toLowerCase()]);
  check(reg?.relayed_tx && !reg.error, "the agent's signed entry went onchain", reg ?? quiet);
  const [early] = await db.query<{ relayed_tx: string | null; error: string | null }>("select relayed_tx, error from signed_locks where wallet = $1", [agent.address.toLowerCase()]);
  check(early && !early.relayed_tx && !early.error, "its early picks wait for the entry window (not sent, not failed)", early);

  step(`6. Monday ${new Date(s.entryOpen * 1000).toISOString().slice(0, 10)}, 10 minutes after entries open`);
  let t = s.entryOpen + 600;
  await chain.request({ method: "evm_setNextBlockTimestamp" as never, params: [t] as never });
  await chain.request({ method: "evm_mine" as never, params: [] as never });
  for (let i = 0; i < 4; i++, t += 300) {
    const lines: string[] = [];
    await runTick(base, db, { now: t, log: (x) => lines.push(x) });
    for (const l of lines.filter((x) => /bots|relay|FAILED/.test(x))) console.log(`    tick: ${l}`);
  }
  const player = makeContractsWallet(PLAYER_KEY);
  const lockHash = await player.writeContract({ address: dep.pickBook, abi: pickBookAbi, functionName: "lock", args: [W, [{ tokenIndex: 0, weightBps: 4000 }, { tokenIndex: 4, weightBps: 3500 }, { tokenIndex: 6, weightBps: 2500 }]] });
  await chain.waitForTransactionReceipt({ hash: lockHash });
  await runTick(base, db, { now: t, log: () => {} }); // indexes the last locks

  step("7. What the league now shows");
  const locks = await db.query<{ wallet: string; tx_hash: string }>("select wallet, tx_hash from paper_locks where week = $1", [W]);
  const agents = await db.query<{ id: string; name: string; wallet: string; erc8004_id: string | null; identity_chain: number | null }>("select id, name, wallet, erc8004_id, identity_chain from agents order by id");
  const lockedBy = new Set(locks.map((l) => l.wallet));
  for (const a of agents) check(lockedBy.has(a.wallet.toLowerCase()), `${a.name} locked picks for week ${W} (ERC-8004 #${a.erc8004_id} on ${a.identity_chain})`);
  check(lockedBy.has(privateKeyToAccount(PLAYER_KEY).address.toLowerCase()), "the player's lock is indexed");
  check(agents.length === 4, `${agents.length} entries in the bots tier: ${agents.map((a) => a.name).join(", ")}`);
  check((await chain.getTransactionCount({ address: agent.address })) === nonceAfterIdentity, "the outside agent sent no transaction after its identity");

  let coded = 0;
  for (const l of locks) {
    const tx = await chain.getTransaction({ hash: l.tx_hash as Hex });
    if (hasBuilderCode(tx.input, CODE)) coded++;
  }
  check(coded === locks.length, `Builder Code on ${coded} of ${locks.length} pick transactions`);
  const table = await weekTable(db, W, t);
  check(table.bots.length === 4 && table.bots.every((b) => b.picks?.length === 3), "the week table ranks the three bots and the agent on their picks", table.bots.map((b) => b.name));
  await db.close();

  const webServer2 = startProcess("pnpm", ["--dir", "web", "exec", "next", "start", "-p", String(webPort)]);
  await waitFor(() => fetch(`${site}/api/agents/kit`).then((r) => { if (!r.ok) throw new Error(); }), "the site");
  const agentsPage = await page("/agents");
  check(["Momentum", "Contrarian", "Steady", "Rehearsal Agent"].every((n) => agentsPage.includes(n)), "/agents lists the three bots and the agent");
  const momentumPage = await page("/agents/momentum");
  check(momentumPage.includes("Weekly picks") && momentumPage.includes("sepolia.basescan.org/tx/"), "Momentum's page shows its locked picks with Base Sepolia links");
  const contractsPage = await page("/contracts");
  check(contractsPage.includes(dep.pickBook.toLowerCase()) || contractsPage.includes(dep.pickBook), "/contracts shows the deployed PickBook");
  await stop(webServer2);
  await stop(anvil);
}

main()
  .catch((e) => { failures++; console.error(`\n✗ ${(e as Error).message}`); })
  .finally(async () => {
    for (const p of children) if (p.exitCode === null) p.kill("SIGTERM");
    if (!failures && !process.argv.includes("--keep")) rmSync(work, { recursive: true, force: true });
    console.log(failures ? `\nRehearsal found ${failures} problem(s). Files kept in ${work}` : "\nRehearsal passed. The $0 setup works end to end on a copy of Base Sepolia.");
    process.exit(failures ? 1 : 0);
  });
