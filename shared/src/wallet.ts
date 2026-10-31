import type { Address, PublicClient } from "viem";
import { ADDR } from "./chain";
import { erc20Abi, b20Abi, aggregatorAbi } from "./abis";
import { UNIVERSE, type UniverseToken } from "./universe";
import { valueUsd } from "./b20";

export type Holding = {
  token: Address;
  ticker: string;
  raw: string;
  ui: string;
  multiplier: string;
  price8: string;
  priceUpdatedAt: number;
  feedRound: string;
  valueUsd: number;
};

export type WalletValue = { wallet: Address; block: bigint; navUsd: number; usdcRaw: bigint; holdings: Holding[] };

/** Values a wallet: USDC plus every universe stock (raw x uiMultiplier x Chainlink price), all at one block. */
export async function valueWallet(client: PublicClient, wallet: Address, universe: UniverseToken[] = UNIVERSE): Promise<WalletValue> {
  const block = await client.getBlockNumber();
  const calls = [
    { address: ADDR.USDC, abi: erc20Abi, functionName: "balanceOf", args: [wallet] } as const,
    ...universe.flatMap((t) => [
      { address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [wallet] } as const,
      { address: t.address, abi: b20Abi, functionName: "uiMultiplier" } as const,
      { address: t.feed, abi: aggregatorAbi, functionName: "latestRoundData" } as const,
    ]),
  ];
  const res = await client.multicall({ contracts: calls, allowFailure: false, blockNumber: block });
  const usdcRaw = res[0] as bigint;
  const holdings: Holding[] = universe.map((t, i) => {
    const raw = res[1 + i * 3] as bigint;
    const mult = res[2 + i * 3] as bigint;
    const [roundId, answer, , updatedAt] = res[3 + i * 3] as readonly [bigint, bigint, bigint, bigint, bigint];
    return {
      token: t.address,
      ticker: t.ticker,
      raw: raw.toString(),
      ui: ((raw * mult) / 10n ** 18n).toString(),
      multiplier: mult.toString(),
      price8: answer.toString(),
      priceUpdatedAt: Number(updatedAt),
      feedRound: roundId.toString(),
      valueUsd: valueUsd(raw, mult, answer),
    };
  });
  const navUsd = Number(usdcRaw) / 1e6 + holdings.reduce((a, h) => a + h.valueUsd, 0);
  return { wallet, block, navUsd, usdcRaw, holdings };
}
