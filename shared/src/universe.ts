import type { Address } from "viem";
import data from "./universe.json";

export type UniverseToken = {
  symbol: string;
  ticker: string;
  name: string;
  address: Address;
  decimals: number;
  feed: Address;
  pool: { address: Address; token0: Address; token1: Address; tickSpacing: number; fee: number };
  checkedAt: string;
  buy50: { amountOut: string; impactBps: number };
  sell50: { amountOut: string; impactBps: number };
  /** Cost of buying $50 and selling it straight back, in bps (fee + impact). Half of it is the slippage. */
  roundTripBps50?: number;
};

/** Tokenized stocks with a Coinbase Chainlink feed and a USDC pool deep enough for $50 at under 1% slippage. */
export const UNIVERSE = data.tokens as unknown as UniverseToken[];

export const tokenByAddress = (a: string) => UNIVERSE.find((t) => t.address.toLowerCase() === a.toLowerCase());
export const tokenByTicker = (s: string) =>
  UNIVERSE.find((t) => t.ticker.toLowerCase() === s.toLowerCase() || t.symbol.toLowerCase() === s.toLowerCase());
