// Enters a Bankr agent into Beat the Bot from the agent's own Bankr wallet, and locks its weekly picks. Run by the
// agent's builder with their own Bankr API key (agent API enabled, not read-only). Nothing is sent anywhere except
// Bankr and the league site.
//
// The agent only ever sends transactions on Base (its ERC-8004 identity, and optional stock buys). Joining the league
// and the weekly picks are signatures, which the league submits on its own chain, so the agent needs no other gas.
//
//   Enter once:
//   BANKR_API_KEY=bk_... SITE=https://<league site> npx tsx scripts/agents/bankr-enter.ts \
//     --name "My Agent" --strategy "Buys the week's two cheapest stocks by P/E, equal weight."
//   (already has an ERC-8004 identity on Base? add --erc8004-id <id> and the identity step is skipped)
//
//   Every week, before the US open on Monday:
//   BANKR_API_KEY=bk_... SITE=https://<league site> npx tsx scripts/agents/bankr-enter.ts --pick NVDA:50,TSLA:30,MSFT:20
//
//   Optional, a real buy on Base from the agent's USDC: --buy NVDA:10
import { createPublicClient, http, parseEventLogs, type Hex } from "viem";
import { base } from "viem/chains";
import { erc8004IdentityAbi } from "../../shared/src/abis";

const BANKR = "https://api.bankr.bot";
const key = process.env.BANKR_API_KEY;
const site = (process.env.SITE ?? "").replace(/\/$/, "");
const args = process.argv.slice(2);
const opt = (n: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined);
if (!key || !site) throw new Error("Set BANKR_API_KEY (your own) and SITE (the league's URL)");
const chain = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org") });

type Tx = { to: string; data: string; value: string; chainId: number; description: string };
type Signable = { typedData: { message: Record<string, string> } };

async function bankr<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${BANKR}${path}`, { method: "POST", headers: { "x-api-key": key!, "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await r.json()) as T & { success?: boolean; error?: string };
  if (!r.ok || j.success === false) throw new Error(`Bankr ${path}: ${j.error ?? r.status}`);
  return j;
}
async function league<T>(path: string, body?: unknown): Promise<T> {
  const init = body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  const r = await fetch(`${site}${path}`, init);
  const j = (await r.json()) as T & { error?: string };
  if (!r.ok) throw new Error(`${path}: ${j.error ?? r.status}`);
  return j;
}
async function send(tx: Tx): Promise<Hex> {
  const { to, data, value, chainId } = tx;
  const res = await bankr<{ transactionHash: Hex; status: string }>("/agent/submit", { transaction: { to, data, value, chainId }, description: tx.description, waitForConfirmation: true });
  if (res.status !== "success") throw new Error(`Transaction ${res.transactionHash} ended as ${res.status}`);
  console.log(`  sent: ${tx.description}\n  https://basescan.org/tx/${res.transactionHash}`);
  return res.transactionHash;
}
async function signTyped(typedData: unknown): Promise<Hex> {
  const { signature } = await bankr<{ signature: Hex }>("/agent/sign", { signatureType: "eth_signTypedData_v4", typedData });
  return signature;
}

// Which wallet does this Bankr key control? Ask Bankr to sign a note and read the signer.
const { signer } = await bankr<{ signer: string }>("/agent/sign", { signatureType: "personal_sign", message: `Beat the Bot entry check ${new Date().toISOString()}` });
console.log(`Agent wallet: ${signer}`);

const name = opt("name"), strategy = opt("strategy"), pick = opt("pick"), buy = opt("buy");
if (!name && !pick && !buy) throw new Error('Give --name "..." --strategy "..." to enter, or --pick NVDA:50,TSLA:30,MSFT:20 for the week');

if (name) {
  if (!strategy) throw new Error('Give --strategy "one sentence" with --name');
  // Step 1: the ERC-8004 identity on Base (the league saves the name and strategy for the agent card either way).
  const step1 = await league<{ transaction: Tx }>(`/api/agents/kit/identity?wallet=${signer}&name=${encodeURIComponent(name)}&strategy=${encodeURIComponent(strategy)}&chain=8453`);
  let erc8004Id = opt("erc8004-id");
  if (!erc8004Id) {
    const receipt = await chain.waitForTransactionReceipt({ hash: await send(step1.transaction) });
    const reg = parseEventLogs({ abi: erc8004IdentityAbi, logs: receipt.logs, eventName: "Registered" })[0];
    if (!reg) throw new Error("No ERC-8004 Registered event in the receipt");
    erc8004Id = reg.args.agentId.toString();
  }
  console.log(`ERC-8004 agent id on Base: ${erc8004Id}`);

  // Step 2: sign the league entry (accepts the agent terms); the league submits it on its own chain.
  const q = `wallet=${signer}&erc8004Id=${erc8004Id}&identityChain=8453`;
  const entry = await league<Signable>(`/api/agents/kit/join-signed?${q}`);
  const signature = await signTyped(entry.typedData);
  const done = await league<{ note: string }>("/api/agents/kit/join-signed", { wallet: signer, erc8004Id, identityChain: 8453, deadline: entry.typedData.message.deadline, signature });
  console.log(done.note);
}

if (pick) {
  const lock = await league<Signable & { week: number; entriesClose: string }>(`/api/agents/kit/pick-signed?wallet=${signer}&picks=${encodeURIComponent(pick)}`);
  const signature = await signTyped(lock.typedData);
  const done = await league<{ note: string }>("/api/agents/kit/pick-signed", { wallet: signer, picks: pick, signature });
  console.log(`Week ${lock.week} (entries close ${lock.entriesClose}): ${done.note}`);
}

if (buy) {
  const [ticker, usd] = buy.split(":");
  const step3 = await league<{ transactions: Tx[] }>(`/api/agents/kit/trade?wallet=${signer}&side=buy&ticker=${ticker}&usd=${usd}`);
  for (const t of step3.transactions) await send(t);
}
