import type { Address } from "viem";
import d from "./deployments.json";

/** Public configuration: the Builder Code and contract addresses (all visible onchain anyway). */
export const DEPLOYMENTS = d as {
  builderCode: string | null;
  pickBook: Address | null;
  prizePool: Address | null;
  agentRoster: Address | null;
  deployedBlock: number | null;
  genesis: number;
  agentIdentities: Record<string, { erc8004Id: string; registerTx: string } | undefined>;
};

export function builderCodeFromConfig(env: Record<string, string | undefined> = process.env): string | null {
  return env.NEXT_PUBLIC_BUILDER_CODE ?? env.BUILDER_CODE ?? DEPLOYMENTS.builderCode;
}

export function contracts(env: Record<string, string | undefined> = process.env) {
  return {
    pickBook: (env.NEXT_PUBLIC_PICKBOOK ?? DEPLOYMENTS.pickBook) as Address | null,
    prizePool: (env.NEXT_PUBLIC_PRIZEPOOL ?? DEPLOYMENTS.prizePool) as Address | null,
    agentRoster: (env.NEXT_PUBLIC_AGENTROSTER ?? DEPLOYMENTS.agentRoster) as Address | null,
  };
}
