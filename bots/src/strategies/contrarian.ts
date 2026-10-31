import type { PublicClient } from "viem";
import { pct, type UniverseToken } from "@btb/shared";
import { equalWeights, fiveDayReturns, type Targets } from "./common";

/** Bottom three by five-trading-day return, equal weight. */
export async function contrarian(client: PublicClient, universe: UniverseToken[], now: number): Promise<Targets> {
  const { returns } = await fiveDayReturns(client, universe, now);
  const picks = [...returns].sort((a, b) => a.ret - b.ret).slice(0, 3);
  return {
    weights: equalWeights(picks.map((p) => p.token)),
    source: "rule",
    note: `Bottom three over five trading days: ${picks.map((p) => `${p.token.ticker} ${pct(p.ret)}`).join(", ")}`,
  };
}
