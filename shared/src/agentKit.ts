import { concat, encodeFunctionData, isAddress, type Address, type Hex, type PublicClient } from "viem";
import { ADDR, CHAIN_ID } from "./chain";
import { agentRosterAbi, erc8004IdentityAbi } from "./abis";
import { builderCodeSuffix } from "./builderCode";
import { buildSwapCalls, quote, type Side } from "./swap";
import type { UniverseToken } from "./universe";

/**
 * Raw transactions for AI agents that enter the league from their own wallet, in the shape Bankr's agent API
 * (`POST /agent/submit`) and most agent wallets accept: { to, data, value, chainId }. Each one carries the app's
 * ERC-8021 Builder Code at the end of its calldata (the agent's wallet sends it directly).
 */
export type AgentTx = { to: Address; data: Hex; value: "0"; chainId: typeof CHAIN_ID; description: string };

export const withBuilderCode = (data: Hex, code: string): Hex => concat([data, builderCodeSuffix(code)]);

const tx = (to: Address, data: Hex, code: string, description: string): AgentTx => ({ to, data: withBuilderCode(data, code), value: "0", chainId: CHAIN_ID, description });

export const NAME_MAX = 40;
export const STRATEGY_MAX = 200;

/** Cleans a display name or strategy line: printable characters only, trimmed, length-capped. */
export function cleanText(s: string | null | undefined, max: number): string {
  return (s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function validWallet(w: string | null | undefined): w is Address {
  return !!w && isAddress(w) && !/^0x0{40}$/i.test(w);
}

/** Step 1: an ERC-8004 identity for the agent, pointing at the agent card the league hosts for it. */
export function identityTx(agentURI: string, code: string): AgentTx {
  return tx(ADDR.ERC8004_IDENTITY, encodeFunctionData({ abi: erc8004IdentityAbi, functionName: "register", args: [agentURI] }), code, "Register an ERC-8004 identity for this agent");
}

/** Step 2: join the league. AgentRoster checks the caller is the wallet and the identity belongs to it. */
export function joinTx(roster: Address, wallet: Address, agentURI: string, erc8004Id: bigint, termsHash: Hex, code: string): AgentTx {
  return tx(roster, encodeFunctionData({ abi: agentRosterAbi, functionName: "register", args: [wallet, agentURI, erc8004Id, termsHash] }), code, "Join Beat the Bot (accepts the agent terms onchain)");
}

/** Step 3: an exact-quoted swap from the agent's wallet back into the same wallet: approve, then swap, 1% floor. */
export async function tradeTxs(client: PublicClient, token: UniverseToken, side: Side, amountIn: bigint, wallet: Address, code: string, deadline: bigint) {
  const q = await quote(client, token, side, amountIn);
  const [approve, swap] = buildSwapCalls(q, wallet, deadline);
  return {
    quote: { side, amountIn: q.amountIn.toString(), amountOut: q.amountOut.toString(), minAmountOut: q.minAmountOut.toString(), pool: q.pool },
    transactions: [
      tx(approve!.to, approve!.data, code, `Approve the swap router to spend exactly this ${side === "buy" ? "USDC" : token.symbol}`),
      tx(swap!.to, swap!.data, code, `${side === "buy" ? "Buy" : "Sell"} ${token.symbol} (1% slippage floor, output to this wallet)`),
    ],
  };
}
