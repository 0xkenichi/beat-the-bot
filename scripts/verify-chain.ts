// Checks every chain fact the app relies on, live against Base mainnet. Run before launch and whenever in doubt:
//   pnpm verify:chain
import { type Address } from "viem";
import { ADDR, CHAIN_ID, UNIVERSE, aggregatorAbi, b20Abi, clPoolAbi, clRouterAbi, erc20Abi, policyRegistryAbi, canHold, quote, makePublicClient } from "../shared/src/index";

const client = makePublicClient();
const results: [string, boolean | "skip", string][] = [];
const check = async (name: string, f: () => Promise<[boolean, string]>) => {
  try { const [ok, info] = await f(); results.push([name, ok, info]); }
  catch (e) { results.push([name, false, (e as Error).message.split("\n")[0]!]); }
};
const code = async (a: Address) => ((await client.getCode({ address: a })) ?? "0x").length > 2;

await check("chain id is 8453", async () => { const id = await client.getChainId(); return [id === CHAIN_ID, String(id)]; });
await check("USDC: native USDC with 6 decimals", async () => {
  const [sym, dec] = await Promise.all([client.readContract({ address: ADDR.USDC, abi: erc20Abi, functionName: "symbol" }), client.readContract({ address: ADDR.USDC, abi: erc20Abi, functionName: "decimals" })]);
  return [sym === "USDC" && dec === 6, `${sym} ${dec}`];
});
await check("tokenized-stocks registry has code", async () => [await code(ADDR.TOKENIZED_STOCKS_REGISTRY), ADDR.TOKENIZED_STOCKS_REGISTRY]);
await check("policy registry precompile answers", async () => {
  const ok = await client.readContract({ address: ADDR.POLICY_REGISTRY, abi: policyRegistryAbi, functionName: "policyExists", args: [0n] });
  return [ok, "policyExists(0) = ALWAYS_ALLOW"];
});
await check("ERC-8004 identity registry has code", async () => [await code(ADDR.ERC8004_IDENTITY), ADDR.ERC8004_IDENTITY]);
await check("swap router is bound to the stock-pool factory", async () => {
  const f = await client.readContract({ address: ADDR.AERO_CL_ROUTER, abi: clRouterAbi, functionName: "factory" });
  return [f === ADDR.AERO_CL_FACTORY, f];
});
await check("L2 sequencer is up", async () => {
  const [, answer, , updatedAt] = await client.readContract({ address: ADDR.SEQUENCER_UPTIME_FEED, abi: aggregatorAbi, functionName: "latestRoundData" });
  return [answer === 0n, `status ${answer}, since ${new Date(Number(updatedAt) * 1000).toISOString()}`];
});

async function fetchList() {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch("https://api.coinbase.com/v1/tokenized-stocks?page_size=500", { signal: AbortSignal.timeout(20_000) });
      if (r.ok) return (await r.json()) as { tokens: { symbol: string; contract_address: string }[] };
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
  }
  return { tokens: [] };
}
const list = await fetchList();
for (const t of UNIVERSE) {
  if (!list.tokens.length) results.push([`${t.ticker}: listed by Coinbase at this address`, "skip", "api.coinbase.com unreachable from here; rerun later"]);
  else await check(`${t.ticker}: listed by Coinbase at this address`, async () => {
    const hit = list.tokens.find((x) => x.contract_address.toLowerCase() === t.address.toLowerCase());
    return [!!hit && hit.symbol === t.symbol, hit ? hit.symbol : "not in the List Tokenized Stocks endpoint"];
  });
  await check(`${t.ticker}: B20 decimals and multiplier`, async () => {
    const [dec, m] = await Promise.all([client.readContract({ address: t.address, abi: erc20Abi, functionName: "decimals" }), client.readContract({ address: t.address, abi: b20Abi, functionName: "uiMultiplier" })]);
    return [dec === 8 && m >= 10n ** 18n, `decimals ${dec}, uiMultiplier ${Number(m) / 1e18}`];
  });
  await check(`${t.ticker}: transfer policy lets wallets and the router hold it`, async () => {
    const ok = (await canHold(client, t.address, "0x000000000000000000000000000000000000bEEF")) && (await canHold(client, t.address, ADDR.AERO_CL_ROUTER));
    return [ok, ok ? "authorized" : "blocked"];
  });
  await check(`${t.ticker}: Chainlink feed`, async () => {
    const [desc, dec, round] = await Promise.all([
      client.readContract({ address: t.feed, abi: aggregatorAbi, functionName: "description" }),
      client.readContract({ address: t.feed, abi: aggregatorAbi, functionName: "decimals" }),
      client.readContract({ address: t.feed, abi: aggregatorAbi, functionName: "latestRoundData" }),
    ]);
    const age = (Date.now() / 1000 - Number(round[3])) / 3600;
    return [desc === `Coinbase ${t.ticker}` && dec === 8 && round[1] > 0n, `${desc}, $${(Number(round[1]) / 1e8).toFixed(2)}, updated ${age.toFixed(1)} h ago`];
  });
  await check(`${t.ticker}: pool on the expected factory`, async () => {
    const [f, t0, t1] = await Promise.all([
      client.readContract({ address: t.pool.address, abi: clPoolAbi, functionName: "factory" }),
      client.readContract({ address: t.pool.address, abi: clPoolAbi, functionName: "token0" }),
      client.readContract({ address: t.pool.address, abi: clPoolAbi, functionName: "token1" }),
    ]);
    const pair = [t0.toLowerCase(), t1.toLowerCase()].sort().join() === [ADDR.USDC.toLowerCase(), t.address.toLowerCase()].sort().join();
    return [f === ADDR.AERO_CL_FACTORY && pair, `${t.pool.address} USDC/${t.symbol}`];
  });
  await check(`${t.ticker}: $50 round trip under 2%`, async () => {
    const b = await quote(client, t, "buy", 50_000_000n);
    const s = await quote(client, t, "sell", b.amountOut);
    const bps = Number(((50_000_000n - s.amountOut) * 10_000n) / 50_000_000n);
    return [bps < 200, `${bps} bps for buying $50 and selling it back`];
  });
}

let failed = 0;
for (const [name, ok, info] of results) { console.log(`${ok === "skip" ? "SKIP" : ok ? "PASS" : "FAIL"}  ${name.padEnd(58)} ${info}`); if (ok === false) failed++; }
console.log(`\n${results.length - failed}/${results.length} checks passed at ${new Date().toISOString()}`);
process.exit(failed ? 1 : 0);
