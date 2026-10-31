import { createPublicClient, fallback, http, type PublicClient } from "viem";
import { base } from "viem/chains";

/** Public client for Base. BASE_RPC_URL (Kenichi's own key) first, then public endpoints as fallbacks. */
export function makePublicClient(url = process.env.BASE_RPC_URL ?? process.env.NEXT_PUBLIC_BASE_RPC_URL): PublicClient {
  const transports = [url, "https://mainnet.base.org", "https://base-mainnet.g.alchemy.com/public"]
    .filter((u): u is string => !!u)
    .map((u) => http(u, { batch: { wait: 16 }, retryCount: 2, timeout: 20_000 }));
  return createPublicClient({ chain: base, transport: fallback(transports) }) as PublicClient;
}
