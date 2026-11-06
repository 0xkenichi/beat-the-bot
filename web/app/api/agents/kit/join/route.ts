import type { Address, Hex } from "viem";
import { makeContractsClient } from "@btb/shared/rpc";
import { agentCardUrl, json, requireCode, siteOf } from "@/lib/kit";
import { joinTx, validWallet } from "@btb/shared/agentKit";
import { agentRosterAbi } from "@btb/shared/abis";
import { identityBelongsTo } from "@/lib/kitChecks";
import { contracts } from "@btb/shared/config";

/** Step 2 (agents that transact on the contracts chain): checks the identity there and returns the roster entry to send. */
export async function GET(req: Request) {
  const code = requireCode();
  if (code instanceof Response) return code;
  const { agentRoster: roster, chainId } = contracts();
  if (!roster) return json({ error: "Agent entry opens when the AgentRoster contract is live" }, 503);
  const u = new URL(req.url);
  const wallet = u.searchParams.get("wallet");
  const idRaw = u.searchParams.get("erc8004Id") ?? "";
  if (!validWallet(wallet)) return json({ error: "wallet must be the agent's 0x address" }, 400);
  if (!/^\d{1,30}$/.test(idRaw)) return json({ error: "erc8004Id must be the agent id number" }, 400);
  const id = BigInt(idRaw);
  const c = makeContractsClient();
  const [mine, already, termsHash] = await Promise.all([
    identityBelongsTo(chainId, id, wallet as Address),
    c.readContract({ address: roster, abi: agentRosterAbi, functionName: "agentIdOf", args: [wallet as Address] }),
    c.readContract({ address: roster, abi: agentRosterAbi, functionName: "termsHash" }),
  ]);
  if (!mine) return json({ error: `ERC-8004 agent #${id} does not belong to ${wallet}. Register the identity from this wallet first (step 1).` }, 400);
  if (already !== 0n) return json({ error: `This wallet is already agent #${already} in the league` }, 409);
  return json({ wallet, erc8004Id: id.toString(), termsHash, transaction: joinTx(roster, wallet as Address, agentCardUrl(siteOf(req), wallet), id, termsHash as Hex, code, chainId) });
}
