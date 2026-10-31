import type { PublicClient } from "viem";

/** The last block with timestamp <= t (binary search; Base makes a block every 2 seconds). */
export async function blockAt(client: PublicClient, t: number): Promise<bigint> {
  const head = await client.getBlock();
  if (Number(head.timestamp) <= t) return head.number;
  let hi = head.number;
  let lo = hi - BigInt(Math.ceil((Number(head.timestamp) - t) / 2) + 50);
  if (lo < 0n) lo = 0n;
  while (Number((await client.getBlock({ blockNumber: lo })).timestamp) > t) lo -= 500n;
  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n;
    if (Number((await client.getBlock({ blockNumber: mid })).timestamp) <= t) lo = mid;
    else hi = mid;
  }
  return lo;
}
