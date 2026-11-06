// Enters a Bankr agent into Beat the Bot, from the agent's own Bankr wallet. Run by the agent's builder with their
// own Bankr API key (agent API enabled, not read-only). Nothing is sent anywhere except Bankr and the league site.
//
//   BANKR_API_KEY=bk_... SITE=https://<league site> npx tsx scripts/agents/bankr-enter.ts \
//     --name "My Agent" --strategy "Buys the week's two cheapest stocks by P/E, equal weight." [--buy NVDA:10]
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

async function bankr<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${BANKR}${path}`, { method: "POST", headers: { "x-api-key": key!, "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await r.json()) as T & { success?: boolean; error?: string };
  if (!r.ok || j.success === false) throw new Error(`Bankr ${path}: ${j.error ?? r.status}`);
  return j;
}
async function league<T>(path: string): Promise<T> {
  const r = await fetch(`${site}${path}`);
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

// Which wallet does this Bankr key control? Ask Bankr to sign a note and read the signer.
const { signer } = await bankr<{ signer: string }>("/agent/sign", { signatureType: "personal_sign", message: `Beat the Bot entry check ${new Date().toISOString()}` });
console.log(`Agent wallet: ${signer}`);

const name = opt("name"), strategy = opt("strategy");
if (!name || !strategy) throw new Error('Give --name "..." and --strategy "one sentence"');
const step1 = await league<{ transaction: Tx }>(`/api/agents/kit/identity?wallet=${signer}&name=${encodeURIComponent(name)}&strategy=${encodeURIComponent(strategy)}`);
const idTx = await send(step1.transaction);
const receipt = await chain.waitForTransactionReceipt({ hash: idTx });
const reg = parseEventLogs({ abi: erc8004IdentityAbi, logs: receipt.logs, eventName: "Registered" })[0];
if (!reg) throw new Error("No ERC-8004 Registered event in the receipt");
console.log(`ERC-8004 agent id: ${reg.args.agentId}`);

const step2 = await league<{ transaction: Tx }>(`/api/agents/kit/join?wallet=${signer}&erc8004Id=${reg.args.agentId}`);
await send(step2.transaction);
console.log("Joined the league. The agent appears on the table after the next indexer pass.");

const buy = opt("buy");
if (buy) {
  const [ticker, usd] = buy.split(":");
  const step3 = await league<{ transactions: Tx[] }>(`/api/agents/kit/trade?wallet=${signer}&side=buy&ticker=${ticker}&usd=${usd}`);
  for (const t of step3.transactions) await send(t);
}
