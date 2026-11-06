import { concat, encodeAbiParameters, encodeFunctionData, getTypesForEIP712Domain, isAddress, keccak256, type Address, type Hex, type PublicClient, type TypedDataDomain } from "viem";
import { CHAINS, type ContractsChainId } from "./chain";
import { agentRosterAbi, erc8004IdentityAbi, pickBookAbi } from "./abis";
import { UNIVERSE } from "./universe";
import { builderCodeSuffix } from "./builderCode";
import { buildSwapCalls, quote, type Side } from "./swap";
import type { UniverseToken } from "./universe";

/**
 * Raw transactions for AI agents that enter the league from their own wallet, in the shape Bankr's agent API
 * (`POST /agent/submit`) and most agent wallets accept: { to, data, value, chainId }. Each one carries the app's
 * ERC-8021 Builder Code at the end of its calldata (the agent's wallet sends it directly).
 */
export type AgentTx = { to: Address; data: Hex; value: "0"; chainId: ContractsChainId; description: string };

export const withBuilderCode = (data: Hex, code: string): Hex => concat([data, builderCodeSuffix(code)]);

const tx = (to: Address, data: Hex, code: string, description: string, chainId: ContractsChainId = 8453): AgentTx => ({ to, data: withBuilderCode(data, code), value: "0", chainId, description });

export const NAME_MAX = 40;
export const STRATEGY_MAX = 200;

/** Cleans a display name or strategy line: printable characters only, trimmed, length-capped. */
export function cleanText(s: string | null | undefined, max: number): string {
  return (s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function validWallet(w: string | null | undefined): w is Address {
  return !!w && isAddress(w) && !/^0x0{40}$/i.test(w);
}

/** Step 1: an ERC-8004 identity for the agent on `chainId`, pointing at the agent card the league hosts for it. */
export function identityTx(agentURI: string, code: string, chainId: ContractsChainId = 8453): AgentTx {
  return tx(CHAINS[chainId].erc8004Identity, encodeFunctionData({ abi: erc8004IdentityAbi, functionName: "register", args: [agentURI] }), code, `Register an ERC-8004 identity for this agent on ${CHAINS[chainId].name}`, chainId);
}

/** Step 2: join the league from the agent's wallet. AgentRoster checks the caller and the (same-chain) identity. */
export function joinTx(roster: Address, wallet: Address, agentURI: string, erc8004Id: bigint, termsHash: Hex, code: string, chainId: ContractsChainId = 8453): AgentTx {
  return tx(roster, encodeFunctionData({ abi: agentRosterAbi, functionName: "register", args: [wallet, agentURI, erc8004Id, termsHash] }), code, "Join Beat the Bot (accepts the agent terms onchain)", chainId);
}

export type Pick = { tokenIndex: number; weightBps: number };

/** "NVDA:50,TSLA:30,MSFT:20" -> three picks with weights in basis points, in the week's token order. */
export function parsePicks(spec: string | null | undefined): Pick[] | { error: string } {
  const parts = (spec ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (parts.length !== 3) return { error: "give exactly three picks, like NVDA:50,TSLA:30,MSFT:20" };
  const picks: Pick[] = [];
  for (const p of parts) {
    const [ticker, pct] = p.split(":");
    const i = UNIVERSE.findIndex((u) => u.ticker.toUpperCase() === (ticker ?? "").toUpperCase());
    const w = Number(pct);
    if (i < 0) return { error: `unknown ticker ${ticker}` };
    if (!Number.isInteger(w) || w < 1) return { error: `weight for ${ticker} must be a whole percent, at least 1` };
    if (picks.some((x) => x.tokenIndex === i)) return { error: `${ticker} is picked twice` };
    picks.push({ tokenIndex: i, weightBps: w * 100 });
  }
  if (picks.reduce((a, x) => a + x.weightBps, 0) !== 10_000) return { error: "weights must add up to 100" };
  return picks;
}

/** keccak256(abi.encode(Pick[3])), exactly as PickBook stores it. */
export const picksHash = (picks: Pick[]): Hex =>
  keccak256(encodeAbiParameters([{ type: "tuple[3]", components: [{ name: "tokenIndex", type: "uint8" }, { name: "weightBps", type: "uint16" }] }], [picks as never]));

/** PickBook.lock from the agent's own wallet, for agents that can send transactions on the contracts chain. */
export function lockTx(pickBook: Address, week: number, picks: Pick[], code: string, chainId: ContractsChainId): AgentTx {
  return tx(pickBook, encodeFunctionData({ abi: pickBookAbi, functionName: "lock", args: [week, picks as never] }), code, `Lock this week's three picks`, chainId);
}

/** EIP-712 typed data an agent signs to join without sending a transaction (AgentRoster.registerFor). */
export function registerTypedData(o: { roster: Address; chainId: ContractsChainId; wallet: Address; metadataURI: string; erc8004Id: bigint; identityChainId: number; termsHash: Hex; deadline: bigint }) {
  return {
    domain: { name: "Beat the Bot AgentRoster", version: "1", chainId: o.chainId, verifyingContract: o.roster },
    types: {
      Register: [
        { name: "wallet", type: "address" },
        { name: "metadataURI", type: "string" },
        { name: "erc8004Id", type: "uint256" },
        { name: "identityChainId", type: "uint256" },
        { name: "termsHash", type: "bytes32" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Register" as const,
    message: { wallet: o.wallet, metadataURI: o.metadataURI, erc8004Id: o.erc8004Id, identityChainId: BigInt(o.identityChainId), termsHash: o.termsHash, deadline: o.deadline },
  };
}

/** EIP-712 typed data an agent (or a player) signs to lock picks without a transaction (PickBook.lockFor). */
export function lockTypedData(o: { pickBook: Address; chainId: ContractsChainId; player: Address; week: number; picks: Pick[]; nonce: bigint; deadline: bigint }) {
  return {
    domain: { name: "Beat the Bot PickBook", version: "1", chainId: o.chainId, verifyingContract: o.pickBook },
    types: {
      Lock: [
        { name: "player", type: "address" },
        { name: "weekId", type: "uint32" },
        { name: "picksHash", type: "bytes32" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Lock" as const,
    message: { player: o.player, weekId: o.week, picksHash: picksHash(o.picks), nonce: o.nonce, deadline: o.deadline },
  };
}

/**
 * JSON-safe eth_signTypedData_v4 payload (EIP712Domain listed in types, bigints as decimal strings), as agent wallets
 * and Bankr's /agent/sign expect.
 */
export function typedDataJson(td: { domain: TypedDataDomain; types: Record<string, unknown>; primaryType: string; message: unknown }): unknown {
  const full = { ...td, types: { EIP712Domain: getTypesForEIP712Domain({ domain: td.domain }), ...td.types } };
  return JSON.parse(JSON.stringify(full, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
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
