import type { Address, PublicClient } from "viem";
import { aggregatorAbi } from "./abis";

export type Round = { roundId: bigint; answer: bigint; updatedAt: number };

/** Prices taken at a cutoff must have updatedAt within this window, otherwise the fallback is logged. */
export const PRICE_STALENESS_SECONDS = 2 * 60 * 60;

export async function latestRound(client: PublicClient, feed: Address): Promise<Round> {
  const [roundId, answer, , updatedAt] = await client.readContract({
    address: feed,
    abi: aggregatorAbi,
    functionName: "latestRoundData",
  });
  if (answer <= 0n) throw new Error(`Feed ${feed} returned a non-positive answer`);
  return { roundId, answer, updatedAt: Number(updatedAt) };
}

export type CutoffPrice = Round & { feed: Address; cutoff: number; stale: boolean; note?: string };

/**
 * The price in force at `cutoff` (unix seconds): the latest round with updatedAt <= cutoff.
 * Run shortly after the cutoff. If that round is more than 2 hours older than the cutoff the price is still
 * the last valid round, flagged `stale` so the results file shows it. A frozen feed (no round within 4 days,
 * so not just a weekend) throws: we never score against a frozen feed.
 */
export async function priceAtCutoff(client: PublicClient, feed: Address, cutoff: number): Promise<CutoffPrice> {
  let r = await latestRound(client, feed);
  let steps = 0;
  while (r.updatedAt > cutoff) {
    if (++steps > 500) throw new Error(`Feed ${feed}: could not walk back to cutoff ${cutoff}`);
    const prevId = r.roundId - 1n;
    const [roundId, answer, , updatedAt] = await client.readContract({
      address: feed,
      abi: aggregatorAbi,
      functionName: "getRoundData",
      args: [prevId],
    });
    if (updatedAt === 0n) throw new Error(`Feed ${feed}: round ${prevId} is empty (phase boundary)`);
    r = { roundId, answer, updatedAt: Number(updatedAt) };
  }
  const age = cutoff - r.updatedAt;
  if (age > 4 * 24 * 3600) throw new Error(`Feed ${feed} is frozen: last update ${age}s before the cutoff`);
  const stale = age > PRICE_STALENESS_SECONDS;
  return {
    ...r,
    feed,
    cutoff,
    stale,
    note: stale ? `last valid round is ${(age / 3600).toFixed(1)} h before the cutoff` : undefined,
  };
}

export const toUsd = (price8: bigint) => Number(price8) / 1e8;
