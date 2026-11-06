import type { Address, Hex } from "viem";
import { client } from "@/lib/data";
import { agentCardUrl, json, requireCode, siteOf } from "@/lib/kit";
import { joinTx, validWallet } from "@btb/shared/agentKit";
import { agentRosterAbi, erc8004IdentityAbi } from "@btb/shared/abis";
import { ADDR } from "@btb/shared/chain";
import { contracts } from "@btb/shared/config";

/** Step 2: checks the ERC-8004 identity belongs to the wallet and returns the AgentRoster entry for it to send. */
export async function GET(req: Request) {
  const code = requireCode();
  if (code instanceof Response) return code;
  const roster = contracts().agentRoster;
  if (!roster) return json({ error: "Agent entry opens when the AgentRoster contract is live" }, 503);
  const u = new URL(req.url);
  const wallet = u.searchParams.get("wallet");
  const idRaw = u.searchParams.get("erc8004Id") ?? "";
  if (!validWallet(wallet)) return json({ error: "wallet must be the agent's 0x address" }, 400);
  if (!/^\d{1,30}$/.test(idRaw)) return json({ error: "erc8004Id must be the agent id number" }, 400);
  const id = BigInt(idRaw);
  const c = client();
  const [owner, agentWallet, already, termsHash] = await Promise.all([
    c.readContract({ address: ADDR.ERC8004_IDENTITY, abi: erc8004IdentityAbi, functionName: "ownerOf", args: [id] }).catch(() => null),
    c.readContract({ address: ADDR.ERC8004_IDENTITY, abi: erc8004IdentityAbi, functionName: "getAgentWallet", args: [id] }).catch(() => null),
    c.readContract({ address: roster, abi: agentRosterAbi, functionName: "agentIdOf", args: [wallet as Address] }),
    c.readContract({ address: roster, abi: agentRosterAbi, functionName: "termsHash" }),
  ]);
  const mine = [owner, agentWallet].some((a) => a && a.toLowerCase() === wallet.toLowerCase());
  if (!mine) return json({ error: `ERC-8004 agent #${id} does not belong to ${wallet}. Register the identity from this wallet first (step 1).` }, 400);
  if (already !== 0n) return json({ error: `This wallet is already agent #${already} in the league` }, 409);
  return json({ wallet, erc8004Id: id.toString(), termsHash, transaction: joinTx(roster, wallet as Address, agentCardUrl(siteOf(req), wallet), id, termsHash as Hex, code) });
}
