// Builds shared/src/universe.json from live data: Coinbase's token list, Chainlink feeds listed on
// docs.base.org, and Aerodrome pools. A stock is kept only if every check passes.
// Usage: pnpm tsx scripts/build-universe.ts
import { writeFileSync } from "node:fs";
import { getAddress, type Address } from "viem";
import { ADDR } from "../shared/src/chain";
import { aggregatorAbi, b20Abi, clFactoryAbi, clPoolAbi, erc20Abi } from "../shared/src/abis";
import { makePublicClient } from "../shared/src/rpc";
import { canHold } from "../shared/src/b20";
import { quote, impactBps, type Quote } from "../shared/src/swap";
import { latestRound } from "../shared/src/prices";
import type { UniverseToken } from "../shared/src/universe";

// Coinbase Chainlink feeds on Base, as listed on docs.base.org's tokenized-stocks page.
const FEEDS: Record<string, Address> = {
  AAPL: "0x787f13dEa48Db0897CbCDD985de77809D837F988",
  AMZN: "0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295",
  GOOGL: "0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2",
  META: "0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D",
  MSFT: "0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c",
  MSTR: "0xB3cE282CD188b35DA0E38D8Bc7d58e33173D202a",
  NVDA: "0x04689a41629776563E6822F76f2e57D148d28513",
  SNDK: "0x388b0dC46C0Fb05A74BeE0994fa5b02c6Fcca2eA",
  SPCX: "0x6A634B235903C4ad6376892180d6fF8612e3Fa68",
  TSLA: "0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4",
};
const TICK_SPACINGS = [1, 10, 50, 100, 200];
const MAX_IMPACT_BPS = 100;

const client = makePublicClient();

async function main() {
  const res = await fetch("https://api.coinbase.com/v1/tokenized-stocks?page_size=500");
  if (!res.ok) throw new Error(`Coinbase API ${res.status}`);
  const { tokens } = (await res.json()) as { tokens: { symbol: string; name: string; contract_address: string; decimals: number }[] };
  const out: UniverseToken[] = [];
  const rejected: string[] = [];
  for (const [ticker, feed] of Object.entries(FEEDS)) {
    const t = tokens.find((x) => x.symbol === `${ticker}c`);
    if (!t) { rejected.push(`${ticker}: not in Coinbase list`); continue; }
    const address = getAddress(t.contract_address);
    const desc = await client.readContract({ address: feed, abi: aggregatorAbi, functionName: "description" });
    if (desc !== `Coinbase ${ticker}`) { rejected.push(`${ticker}: feed description is ${desc}`); continue; }
    const decimals = await client.readContract({ address, abi: erc20Abi, functionName: "decimals" });
    const mult = await client.readContract({ address, abi: b20Abi, functionName: "uiMultiplier" });

    // Deepest pool on the Aerodrome CL factory.
    let best: { pool: Address; liq: bigint; ts: number } | undefined;
    for (const ts of TICK_SPACINGS) {
      const pool = await client.readContract({ address: ADDR.AERO_CL_FACTORY, abi: clFactoryAbi, functionName: "getPool", args: [ADDR.USDC, address, ts] });
      if (pool === "0x0000000000000000000000000000000000000000") continue;
      const liq = await client.readContract({ address: pool, abi: clPoolAbi, functionName: "liquidity" });
      if (!best || liq > best.liq) best = { pool, liq, ts };
    }
    if (!best) { rejected.push(`${ticker}: no pool on the CL factory`); continue; }
    const [token0, token1, fee, factory] = await Promise.all([
      client.readContract({ address: best.pool, abi: clPoolAbi, functionName: "token0" }),
      client.readContract({ address: best.pool, abi: clPoolAbi, functionName: "token1" }),
      client.readContract({ address: best.pool, abi: clPoolAbi, functionName: "fee" }),
      client.readContract({ address: best.pool, abi: clPoolAbi, functionName: "factory" }),
    ]);
    if (factory !== ADDR.AERO_CL_FACTORY) { rejected.push(`${ticker}: pool factory mismatch`); continue; }

    const entry: UniverseToken = {
      symbol: t.symbol, ticker, name: t.name, address, decimals, feed,
      pool: { address: best.pool, token0, token1, tickSpacing: best.ts, fee: Number(fee) },
      checkedAt: new Date().toISOString(),
      buy50: { amountOut: "0", impactBps: 0 }, sell50: { amountOut: "0", impactBps: 0 },
    };
    // Policies: the router and a random fresh wallet must both be allowed to hold the token.
    const fresh = "0x000000000000000000000000000000000000bEEF" as Address;
    if (!(await canHold(client, address, fresh)) || !(await canHold(client, address, ADDR.AERO_CL_ROUTER))) {
      rejected.push(`${ticker}: transfer policy blocks ordinary wallets`); continue;
    }
    const oracle = await latestRound(client, feed);
    const buy: Quote = await quote(client, entry, "buy", 50_000_000n);
    const sell: Quote = await quote(client, entry, "sell", buy.amountOut);
    const bi = impactBps(buy, oracle.answer);
    const si = impactBps(sell, oracle.answer);
    // Slippage: half the cost of buying $50 and selling it straight back (pool fee + price impact).
    const roundTripBps = Number(((50_000_000n - sell.amountOut) * 10_000n) / 50_000_000n);
    entry.buy50 = { amountOut: buy.amountOut.toString(), impactBps: bi };
    entry.sell50 = { amountOut: sell.amountOut.toString(), impactBps: si };
    entry.roundTripBps50 = roundTripBps;
    const line = `${ticker.padEnd(5)} pool ${best.pool} ts=${best.ts} fee=${fee} mult=${Number(mult) / 1e18} oracle=$${(Number(oracle.answer) / 1e8).toFixed(2)} vs-oracle buy=${bi}bps sell=${si}bps roundtrip=${roundTripBps}bps`;
    if (roundTripBps / 2 > MAX_IMPACT_BPS) { rejected.push(`${line} (too shallow)`); continue; }
    console.log("OK  ", line);
    out.push(entry);
  }
  for (const r of rejected) console.log("SKIP", r);
  writeFileSync(new URL("../shared/src/universe.json", import.meta.url), JSON.stringify({ builtAt: new Date().toISOString(), tokens: out }, null, 2) + "\n");
  console.log(`wrote ${out.length} tokens to shared/src/universe.json`);
}
main().catch((e) => { console.error(e); process.exit(1); });
