import type { Address, PublicClient } from "viem";
import { ADDR, B20_DECIMALS, FEED_DECIMALS, POLICY_SCOPE, WAD } from "./chain";
import { b20Abi, erc20Abi, policyRegistryAbi } from "./abis";

/** Position value in USD (float) from a raw B20 balance, its UI multiplier (WAD) and an 8-decimal price. */
export function valueUsd(rawBalance: bigint, uiMultiplier: bigint, price8: bigint): number {
  const uiBalance = (rawBalance * uiMultiplier) / WAD; // shares, 8 decimals
  return Number((uiBalance * price8) / 10n ** BigInt(FEED_DECIMALS)) / 10 ** B20_DECIMALS;
}

export type B20Position = { token: Address; raw: bigint; ui: bigint; multiplier: bigint };

/** Reads raw balance, UI balance and multiplier for each token in one multicall. */
export async function readPositions(client: PublicClient, holder: Address, tokens: readonly Address[]) {
  const calls = tokens.flatMap((t) => [
    { address: t, abi: erc20Abi, functionName: "balanceOf", args: [holder] } as const,
    { address: t, abi: b20Abi, functionName: "balanceOfUI", args: [holder] } as const,
    { address: t, abi: b20Abi, functionName: "uiMultiplier" } as const,
  ]);
  const res = await client.multicall({ contracts: calls, allowFailure: false });
  return tokens.map((token, i) => ({
    token,
    raw: res[i * 3] as bigint,
    ui: res[i * 3 + 1] as bigint,
    multiplier: res[i * 3 + 2] as bigint,
  })) satisfies B20Position[];
}

/**
 * Checks that `wallet` may receive (and send) `token` under its transfer policies. Skips any token that fails.
 * The token stores a policy ID per scope; the Policy Registry answers isAuthorized (never reverts).
 */
export async function canHold(client: PublicClient, token: Address, wallet: Address): Promise<boolean> {
  const scopes = [POLICY_SCOPE.TRANSFER_RECEIVER, POLICY_SCOPE.TRANSFER_SENDER] as const;
  for (const scope of scopes) {
    const id = await client.readContract({ address: token, abi: b20Abi, functionName: "policyId", args: [scope] });
    if (id === 0n) continue; // ALWAYS_ALLOW
    const exists = await client.readContract({
      address: ADDR.POLICY_REGISTRY,
      abi: policyRegistryAbi,
      functionName: "policyExists",
      args: [id],
    });
    if (!exists) return false;
    const ok = await client.readContract({
      address: ADDR.POLICY_REGISTRY,
      abi: policyRegistryAbi,
      functionName: "isAuthorized",
      args: [id, wallet],
    });
    if (!ok) return false;
  }
  return true;
}
