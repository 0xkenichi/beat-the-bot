import type { PublicClient } from "viem";
import { pct, type UniverseToken } from "@btb/shared";
import { equalWeights, fiveDayReturns, type Targets } from "./common";

/** Top three by five-trading-day return, equal weight. */
export async function momentum(client: PublicClient, universe: UniverseToken[], now: number): Promise<Targets> {
  const { returns } = await fiveDayReturns(client, universe, now);
  const picks = [...returns].sort((a, b) => b.ret - a.ret).slice(0, 3);
  return {
    weights: equalWeights(picks.map((p) => p.token)),
    source: "rule",
    note: `Top three over five trading days: ${picks.map((p) => `${p.token.ticker} ${pct(p.ret)}`).join(", ")}`,
  };
}
