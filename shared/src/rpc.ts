import { createPublicClient, createWalletClient, fallback, http, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { CHAINS } from "./chain";
import { contractsChainId } from "./config";
import { builderCodeSuffix, requireBuilderCode } from "./builderCode";

type Env = Record<string, string | undefined>;
const transports = (urls: (string | undefined)[]) =>
  fallback(urls.filter((u): u is string => !!u).map((u) => http(u, { batch: { wait: 16 }, retryCount: 2, timeout: 20_000 })));

/** Base mainnet: stocks, USDC, Chainlink prices, swaps. BASE_RPC_URL (Kenichi's own key) first, then public endpoints. */
export function makePublicClient(url = process.env.BASE_RPC_URL ?? process.env.NEXT_PUBLIC_BASE_RPC_URL): PublicClient {
  return createPublicClient({ chain: base, transport: transports([url, "https://mainnet.base.org", "https://base-mainnet.g.alchemy.com/public"]) }) as PublicClient;
}

/** The chain the league's contracts live on (Base Sepolia by default). CONTRACTS_RPC_URL first, then the public RPC. */
export function makeContractsClient(env: Env = process.env): PublicClient {
  const id = contractsChainId(env);
  if (id === 8453) return makePublicClient(env.BASE_RPC_URL);
  return createPublicClient({ chain: baseSepolia, transport: transports([env.CONTRACTS_RPC_URL, CHAINS[84532].rpc]) }) as PublicClient;
}

/** A wallet on the contracts chain that appends the Builder Code to every transaction it sends. */
export function makeContractsWallet(privateKey: Hex, env: Env = process.env) {
  const id = contractsChainId(env);
  return createWalletClient({
    account: privateKeyToAccount(privateKey),
    chain: id === 8453 ? base : baseSepolia,
    transport: http(id === 8453 ? (env.BASE_RPC_URL ?? CHAINS[8453].rpc) : (env.CONTRACTS_RPC_URL ?? CHAINS[84532].rpc)),
    dataSuffix: builderCodeSuffix(requireBuilderCode(env)),
  });
}
