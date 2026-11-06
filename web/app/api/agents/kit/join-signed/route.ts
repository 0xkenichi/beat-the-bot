import type { Address, Hex } from "viem";
import { db } from "@/lib/data";
import { agentCardUrl, json, siteOf } from "@/lib/kit";
import { identityBelongsTo } from "@/lib/kitChecks";
import { registerTypedData, typedDataJson, validWallet } from "@btb/shared/agentKit";
import { agentRosterAbi } from "@btb/shared/abis";
import { contracts } from "@btb/shared/config";
import { makeContractsClient } from "@btb/shared/rpc";

/**
 * Step 2 for agents that can sign but cannot send transactions on the contracts chain (Bankr agents, for example).
 * GET returns the EIP-712 entry to sign; POST takes the signature, and the league's resolver submits it with
 * AgentRoster.registerFor within a few minutes. The identity is checked on its own chain here, before signing.
 */
async function prepare(req: Request, wallet: string | null, idRaw: string | null, chainRaw: string | null, deadlineRaw?: string | null) {
  const { agentRoster: roster, chainId } = contracts();
  if (!roster) return { error: json({ error: "Agent entry opens when the AgentRoster contract is live" }, 503) };
  if (!validWallet(wallet)) return { error: json({ error: "wallet must be the agent's 0x address" }, 400) };
  if (!/^\d{1,30}$/.test(idRaw ?? "")) return { error: json({ error: "erc8004Id must be the agent id number" }, 400) };
  const identityChainId = Number(chainRaw ?? 8453);
  const id = BigInt(idRaw!);
  if (!(await identityBelongsTo(identityChainId, id, wallet as Address))) {
    return { error: json({ error: `ERC-8004 agent #${id} on chain ${identityChainId} does not belong to ${wallet}` }, 400) };
  }
  const c = makeContractsClient();
  const [already, termsHash] = await Promise.all([
    c.readContract({ address: roster, abi: agentRosterAbi, functionName: "agentIdOf", args: [wallet as Address] }),
    c.readContract({ address: roster, abi: agentRosterAbi, functionName: "termsHash" }),
  ]);
  if (already !== 0n) return { error: json({ error: `This wallet is already agent #${already} in the league` }, 409) };
  const deadline = deadlineRaw ? BigInt(deadlineRaw) : BigInt(Math.floor(Date.now() / 1000) + 24 * 3600);
  const metadataURI = agentCardUrl(siteOf(req), wallet!);
  const typedData = registerTypedData({ roster, chainId, wallet: wallet as Address, metadataURI, erc8004Id: id, identityChainId, termsHash: termsHash as Hex, deadline });
  return { typedData, metadataURI, deadline, identityChainId, id, c };
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const r = await prepare(req, u.searchParams.get("wallet"), u.searchParams.get("erc8004Id"), u.searchParams.get("identityChain"));
  if ("error" in r) return r.error;
  return json({ sign: "eth_signTypedData_v4", typedData: typedDataJson(r.typedData), then: "POST the signature with the same wallet, erc8004Id, identityChain and deadline to this URL." });
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { wallet?: string; erc8004Id?: string; identityChain?: number; deadline?: string; signature?: string } | null;
  if (!b?.signature || !/^0x[0-9a-fA-F]+$/.test(b.signature)) return json({ error: "signature required" }, 400);
  const r = await prepare(req, b.wallet ?? null, b.erc8004Id ?? null, String(b.identityChain ?? 8453), b.deadline ?? null);
  if ("error" in r) return r.error;
  if (r.deadline <= BigInt(Math.floor(Date.now() / 1000))) return json({ error: "deadline has passed; get a fresh entry to sign" }, 400);
  const ok = await r.c.verifyTypedData({ address: b.wallet as Address, signature: b.signature as Hex, ...r.typedData }).catch(() => false);
  if (!ok) return json({ error: "The signature does not match this wallet and entry" }, 400);
  await (await db()).query(
    `insert into signed_registrations (wallet, erc8004_id, identity_chain, metadata_uri, deadline, signature) values ($1, $2, $3, $4, $5, $6)
     on conflict (wallet) do update set erc8004_id = excluded.erc8004_id, identity_chain = excluded.identity_chain, metadata_uri = excluded.metadata_uri,
       deadline = excluded.deadline, signature = excluded.signature, relayed_tx = null, error = null`,
    [b.wallet!.toLowerCase(), r.id.toString(), r.identityChainId, r.metadataURI, r.deadline.toString(), b.signature],
  );
  return json({ ok: true, note: "Accepted. The league submits your entry onchain within a few minutes; the agent then appears on /agents." });
}
