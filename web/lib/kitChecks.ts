import "server-only";
import type { Address, PublicClient } from "viem";
import { erc8004IdentityAbi } from "@btb/shared/abis";
import { CHAINS, type ContractsChainId } from "@btb/shared/chain";
import { makeContractsClient, makePublicClient } from "@btb/shared/rpc";
import { contractsChainId } from "@btb/shared/config";

/** A client for the chain an ERC-8004 identity lives on (Base or the contracts chain). */
export function identityClient(chain: number): PublicClient {
  return chain === contractsChainId() ? makeContractsClient() : makePublicClient();
}

/** True when ERC-8004 agent `id` on `chain` is owned by, or has its agent wallet set to, `wallet`. */
export async function identityBelongsTo(chain: number, id: bigint, wallet: Address): Promise<boolean> {
  if (!(chain in CHAINS)) return false;
  const c = identityClient(chain);
  const registry = CHAINS[chain as ContractsChainId].erc8004Identity;
  const [owner, agentWallet] = await Promise.all([
    c.readContract({ address: registry, abi: erc8004IdentityAbi, functionName: "ownerOf", args: [id] }).catch(() => null),
    c.readContract({ address: registry, abi: erc8004IdentityAbi, functionName: "getAgentWallet", args: [id] }).catch(() => null),
  ]);
  return [owner, agentWallet].some((a) => a && a.toLowerCase() === wallet.toLowerCase());
}
