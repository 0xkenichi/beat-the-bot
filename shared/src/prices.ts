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

async function roundById(client: PublicClient, feed: Address, roundId: bigint): Promise<Round | null> {
  try {
    const [id, answer, , updatedAt] = await client.readContract({
      address: feed,
      abi: aggregatorAbi,
      functionName: "getRoundData",
      args: [roundId],
    });
    return updatedAt === 0n ? null : { roundId: id, answer, updatedAt: Number(updatedAt) };
  } catch {
    return null;
  }
}

/** Latest round with updatedAt <= t, by binary search over the current phase's sequential round ids. */
export async function roundAt(client: PublicClient, feed: Address, t: number): Promise<Round> {
  const latest = await latestRound(client, feed);
  if (latest.updatedAt <= t) return latest;
  const phase = latest.roundId >> 64n;
  const latestAgg = latest.roundId & ((1n << 64n) - 1n);
  const id = (agg: bigint) => (phase << 64n) | agg;
  // Find a lower bound with updatedAt <= t, doubling the distance each time.
  let span = 64n;
  let lo = latestAgg > span ? latestAgg - span : 1n;
  let loRound = await roundById(client, feed, id(lo));
  while (!loRound || loRound.updatedAt > t) {
    if (lo === 1n) throw new Error(`Feed ${feed}: no round at or before ${t} in the current phase`);
    span *= 2n;
    lo = latestAgg > span ? latestAgg - span : 1n;
    loRound = await roundById(client, feed, id(lo));
  }
  let hi = latestAgg; // updatedAt > t
  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n;
    const r = await roundById(client, feed, id(mid));
    if (r && r.updatedAt <= t) {
      lo = mid;
      loRound = r;
    } else hi = mid;
  }
  return loRound;
}

/**
 * The price in force at `cutoff` (unix seconds): the latest round with updatedAt <= cutoff.
 * If that round is more than 2 hours older than the cutoff it is still the last valid round, flagged `stale`
 * so the results file shows it. A frozen feed (no round within 4 days) throws: never score against a frozen feed.
 */
export async function priceAtCutoff(client: PublicClient, feed: Address, cutoff: number): Promise<CutoffPrice> {
  const r = await roundAt(client, feed, cutoff);
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
