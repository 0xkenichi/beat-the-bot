import type { Address } from "viem";
import d from "./deployments.json";
import { CHAINS, type ContractsChainId } from "./chain";

/**
 * Public configuration: the Builder Code, which chain the league's contracts live on, and their addresses.
 * Trading (stocks, USDC, prices) is always Base mainnet. The contracts default to Base Sepolia, so the league runs
 * at no cost; set contractsChain to 8453 (or CONTRACTS_CHAIN_ID) to run them on mainnet instead.
 */
type Network = {
  pickBook: Address | null;
  prizePool: Address | null;
  agentRoster: Address | null;
  deployedBlock: number | null;
  agentIdentities: Record<string, { erc8004Id: string; registerTx: string; rosterTx?: string } | undefined>;
};
export const DEPLOYMENTS = d as unknown as { builderCode: string | null; contractsChain: number; genesis: number; networks: Record<string, Network> };

type Env = Record<string, string | undefined>;

export function contractsChainId(env: Env = process.env): ContractsChainId {
  const id = Number(env.CONTRACTS_CHAIN_ID ?? env.NEXT_PUBLIC_CONTRACTS_CHAIN_ID ?? DEPLOYMENTS.contractsChain);
  if (id !== 8453 && id !== 84532) throw new Error(`Unsupported contracts chain ${id}`);
  return id;
}

export function network(env: Env = process.env): Network {
  return DEPLOYMENTS.networks[String(contractsChainId(env))] ?? { pickBook: null, prizePool: null, agentRoster: null, deployedBlock: null, agentIdentities: {} };
}

export function builderCodeFromConfig(env: Env = process.env): string | null {
  return env.NEXT_PUBLIC_BUILDER_CODE ?? env.BUILDER_CODE ?? DEPLOYMENTS.builderCode;
}

/** League contract addresses on the contracts chain (env overrides win). */
export function contracts(env: Env = process.env) {
  const n = network(env);
  return {
    chainId: contractsChainId(env),
    pickBook: (env.NEXT_PUBLIC_PICKBOOK ?? n.pickBook) as Address | null,
    prizePool: (env.NEXT_PUBLIC_PRIZEPOOL ?? n.prizePool) as Address | null,
    agentRoster: (env.NEXT_PUBLIC_AGENTROSTER ?? n.agentRoster) as Address | null,
    erc8004Identity: CHAINS[contractsChainId(env)].erc8004Identity,
  };
}

/** True when the league's contracts are on a testnet (the no-cost setup): bots lock picks instead of trading. */
export const isTestnetLeague = (env: Env = process.env) => contractsChainId(env) === 84532;

/**
 * How the house bots play. "trade": real stocks from funded wallets on Base. "picks": three picks a week locked in
 * PickBook, like a free player; the default when the league's contracts are on Base Sepolia (the no-cost setup).
 */
export const botsMode = (env: Env = process.env): "trade" | "picks" =>
  env.BOTS_MODE === "trade" || env.BOTS_MODE === "picks" ? env.BOTS_MODE : isTestnetLeague(env) ? "picks" : "trade";
