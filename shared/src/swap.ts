import { encodeFunctionData, type Address, type Hex, type PublicClient } from "viem";
import { ADDR, QUOTE_PROBE_ADDRESS } from "./chain";
import { clRouterAbi, erc20Abi, quoteProbeAbi, quoteProbeRuntime } from "./abis";
import type { UniverseToken } from "./universe";

/** Slippage cap on every swap, users and bots alike. */
export const SLIPPAGE_BPS = 100;
/** Per-wallet soft cap for real-mode positions, in USDC (6 decimals). */
export const SOFT_CAP_USDC = 100_000_000n;
/** Gas is sponsored for swaps under this size. */
export const SPONSOR_LIMIT_USDC = 100_000_000n;

export type Side = "buy" | "sell";
export type Call = { to: Address; data: Hex; value: bigint };

export type Quote = {
  side: Side;
  token: UniverseToken;
  amountIn: bigint;
  amountOut: bigint;
  minAmountOut: bigint;
  pool: Address;
};

/**
 * Exact quote from the stock's USDC pool. QuoteProbe's runtime code is placed at an empty address through an
 * eth_call state override; the pool computes the swap and the probe reverts in the callback, so nothing moves.
 */
export async function quote(client: PublicClient, token: UniverseToken, side: Side, amountIn: bigint): Promise<Quote> {
  if (amountIn <= 0n) throw new Error("amountIn must be positive");
  const tokenIn = side === "buy" ? ADDR.USDC : token.address;
  const zeroForOne = tokenIn.toLowerCase() === token.pool.token0.toLowerCase();
  const { data } = await client.call({
    to: QUOTE_PROBE_ADDRESS,
    data: encodeFunctionData({ abi: quoteProbeAbi, functionName: "quote", args: [token.pool.address, zeroForOne, amountIn] }),
    stateOverride: [{ address: QUOTE_PROBE_ADDRESS, code: quoteProbeRuntime }],
  });
  if (!data) throw new Error("Quote failed: empty response");
  const a0 = BigInt.asIntN(256, BigInt("0x" + data.slice(2, 66)));
  const a1 = BigInt.asIntN(256, BigInt("0x" + data.slice(66, 130)));
  const out = zeroForOne ? -a1 : -a0;
  if (out <= 0n) throw new Error("Quote returned no output");
  return { side, token, amountIn, amountOut: out, minAmountOut: applySlippage(out), pool: token.pool.address };
}

export const applySlippage = (amountOut: bigint, bps = SLIPPAGE_BPS) => (amountOut * BigInt(10_000 - bps)) / 10_000n;

/**
 * The two calls of a swap from the holder's own wallet: an exact approval, then the router swap that sends the
 * output straight back to the same wallet. Nothing is ever held by the app.
 */
export function buildSwapCalls(q: Quote, recipient: Address, deadline: bigint): Call[] {
  const tokenIn = q.side === "buy" ? ADDR.USDC : q.token.address;
  const tokenOut = q.side === "buy" ? q.token.address : ADDR.USDC;
  return [
    {
      to: tokenIn,
      value: 0n,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [ADDR.AERO_CL_ROUTER, q.amountIn] }),
    },
    {
      to: ADDR.AERO_CL_ROUTER,
      value: 0n,
      data: encodeFunctionData({
        abi: clRouterAbi,
        functionName: "exactInputSingle",
        args: [
          {
            tokenIn,
            tokenOut,
            tickSpacing: q.token.pool.tickSpacing,
            recipient,
            deadline,
            amountIn: q.amountIn,
            amountOutMinimum: q.minAmountOut,
            sqrtPriceLimitX96: 0n,
          },
        ],
      }),
    },
  ];
}

/** Price impact versus the oracle, in basis points (positive = worse than oracle). */
export function impactBps(q: Quote, oraclePrice8: bigint): number {
  // USDC has 6 decimals, stocks 8, the oracle 8.
  const usdc = Number(q.side === "buy" ? q.amountIn : q.amountOut) / 1e6;
  const shares = Number(q.side === "buy" ? q.amountOut : q.amountIn) / 1e8;
  const exec = usdc / shares;
  const oracle = Number(oraclePrice8) / 1e8;
  const worse = q.side === "buy" ? exec / oracle - 1 : 1 - exec / oracle;
  return Math.round(worse * 10_000);
}
