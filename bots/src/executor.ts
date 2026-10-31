import { createWalletClient, http, formatEther, type Address, type Hex, type PublicClient, type WalletClient, type Account } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import {
  ADDR, GUARDRAILS, UNIVERSE, buildSwapCalls, builderCodeSuffix, hasBuilderCode, impactBps, isMarketOpen, quote,
  valueWallet, type UniverseToken, type WalletValue,
} from "@btb/shared";

export type PlannedTrade = { side: "buy" | "sell"; token: UniverseToken; amountIn: bigint; usd: number; why: string };

/** Checks a strategy's output against the guardrails before any trade is planned. */
export function checkWeights(weights: Record<string, number>, universe: UniverseToken[] = UNIVERSE) {
  let sum = 0;
  for (const [token, bps] of Object.entries(weights)) {
    if (!universe.some((t) => t.address.toLowerCase() === token.toLowerCase())) throw new Error(`Guardrail: ${token} is not in this week's universe`);
    if (bps > GUARDRAILS.maxWeightBps) throw new Error(`Guardrail: ${bps / 100}% in one name exceeds 50%`);
    if (bps < 0) throw new Error("Guardrail: negative weight");
    sum += bps;
  }
  if (sum > 10_000) throw new Error(`Guardrail: weights sum to ${sum / 100}%`);
}

/**
 * Turns target weights into trades. The invested part is NAV minus a 5% USDC buffer. Sells come first so
 * buys can use their proceeds. Differences under $1 are ignored.
 */
export function planRebalance(v: WalletValue, weights: Record<string, number>, universe: UniverseToken[] = UNIVERSE): PlannedTrade[] {
  checkWeights(weights, universe);
  const investable = v.navUsd * (1 - GUARDRAILS.cashBufferBps / 10_000);
  const sells: PlannedTrade[] = [];
  const buys: PlannedTrade[] = [];
  for (const t of universe) {
    const h = v.holdings.find((x) => x.token.toLowerCase() === t.address.toLowerCase());
    const current = h?.valueUsd ?? 0;
    const w = Object.entries(weights).find(([a]) => a.toLowerCase() === t.address.toLowerCase())?.[1] ?? 0;
    const target = (investable * w) / 10_000;
    const diff = target - current;
    if (diff < -GUARDRAILS.minTradeUsd && h) {
      const raw = BigInt(h.raw);
      const amount = target <= GUARDRAILS.minTradeUsd ? raw : (raw * BigInt(Math.round((-diff / current) * 1e6))) / 1_000_000n;
      if (amount > 0n) sells.push({ side: "sell", token: t, amountIn: amount, usd: -diff, why: `${t.ticker} from $${current.toFixed(2)} to $${target.toFixed(2)}` });
    } else if (diff > GUARDRAILS.minTradeUsd) {
      buys.push({ side: "buy", token: t, amountIn: BigInt(Math.floor(diff * 1e6)), usd: diff, why: `${t.ticker} from $${current.toFixed(2)} to $${target.toFixed(2)}` });
    }
  }
  return [...sells, ...buys];
}

export type ExecutedTrade = { tx: Hex; approveTx: Hex; side: "buy" | "sell"; token: UniverseToken; amountIn: bigint; amountOut: bigint; usdc: bigint; builderCode: boolean };

export function makeBotWallet(privateKey: Hex, builderCode: string, rpc?: string) {
  return createWalletClient({
    account: privateKeyToAccount(privateKey),
    chain: base,
    transport: http(rpc ?? process.env.BASE_RPC_URL ?? "https://mainnet.base.org"),
    dataSuffix: builderCodeSuffix(builderCode), // ERC-8021 Builder Code on every transaction
  });
}

const MIN_ETH_FOR_GAS = 20_000_000_000_000n; // 0.00002 ETH

/**
 * Executes a plan from the bot's own wallet. Every swap is quoted from the pool, refused if the pool price is
 * more than 1% from the oracle, and sent with a 1% minimum-output floor. Only during US market hours.
 */
export async function executePlan(opts: {
  client: PublicClient;
  wallet: WalletClient & { account: Account };
  plan: PlannedTrade[];
  builderCode: string;
  now?: number;
  log?: (s: string) => void;
}): Promise<ExecutedTrade[]> {
  const { client, wallet, builderCode } = opts;
  const log = opts.log ?? console.log;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (!isMarketOpen(now)) throw new Error("Guardrail: trading only during US market hours");
  const me = wallet.account.address as Address;
  const eth = await client.getBalance({ address: me });
  if (eth < MIN_ETH_FOR_GAS) throw new Error(`Not enough ETH for gas in ${me}: ${formatEther(eth)} ETH`);

  const done: ExecutedTrade[] = [];
  const sells = opts.plan.filter((p) => p.side === "sell");
  const buys = opts.plan.filter((p) => p.side === "buy");
  for (const step of [...sells, ...buys]) {
    let amountIn = step.amountIn;
    if (step.side === "buy") {
      // Re-read USDC after the sells, keep the buffer.
      const v = await valueWallet(client, me);
      const buffer = BigInt(Math.floor(v.navUsd * 1e6 * (GUARDRAILS.cashBufferBps / 10_000)));
      const spendable = v.usdcRaw > buffer ? v.usdcRaw - buffer : 0n;
      if (spendable < amountIn) amountIn = spendable;
      if (amountIn < BigInt(GUARDRAILS.minTradeUsd * 1e6)) { log(`skip ${step.why}: not enough USDC`); continue; }
    }
    const q = await quote(client, step.token, step.side, amountIn);
    const oracle = await client.readContract({
      address: step.token.feed,
      abi: [{ type: "function", name: "latestRoundData", stateMutability: "view", inputs: [], outputs: [{ type: "uint80" }, { type: "int256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint80" }] }] as const,
      functionName: "latestRoundData",
    });
    const dev = impactBps(q, oracle[1]);
    if (dev > GUARDRAILS.maxOracleDeviationBps) { log(`skip ${step.why}: pool is ${dev} bps worse than the oracle`); continue; }
    const deadline = BigInt(now + 600);
    const [approve, swap] = buildSwapCalls(q, me, deadline);
    const approveTx = await wallet.sendTransaction({ to: approve!.to, data: approve!.data, value: 0n, chain: base, account: wallet.account });
    await client.waitForTransactionReceipt({ hash: approveTx });
    const tx = await wallet.sendTransaction({ to: swap!.to, data: swap!.data, value: 0n, chain: base, account: wallet.account });
    const receipt = await client.waitForTransactionReceipt({ hash: tx });
    if (receipt.status !== "success") throw new Error(`Swap reverted: ${tx}`);
    const sent = await client.getTransaction({ hash: tx });
    const attributed = hasBuilderCode(sent.input, builderCode);
    if (!attributed) throw new Error(`Swap ${tx} is missing the Builder Code suffix`);
    log(`${step.side} ${step.token.ticker}: ${tx} (${step.why})`);
    done.push({
      tx, approveTx, side: step.side, token: step.token, amountIn, amountOut: q.amountOut,
      usdc: step.side === "buy" ? amountIn : q.amountOut, builderCode: attributed,
    });
  }
  return done;
}

export const usdcAddress = ADDR.USDC;
