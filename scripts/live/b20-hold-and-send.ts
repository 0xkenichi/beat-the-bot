// The B20 hold-and-send test, run against Base mainnet's own node with eth_simulateV1.
//
// Coinbase tokenized stocks are B20 precompiles implemented inside Base's node, so a local Foundry fork
// cannot execute them (contracts/test/fork/BaseFork.t.sol shows this). eth_simulateV1 runs a simulated block
// on top of the real chain with the real precompiles, without signing or sending anything.
//
// One simulated block:
//   1. deploy PrizePool (and a second contract, to prove contracts can receive stock),
//   2. the sponsor buys NVDAc with USDC through the Aerodrome router (real pool, real precompile transfer),
//   3. the sponsor funds the pool with the NVDAc  -> stock moves INTO a contract via transferFrom,
//   4. the pool's position is valued with uiMultiplier/balanceOfUI and the Chainlink price,
//   5. the resolver settles to an EOA and a contract -> stock moves OUT of the contract.
// Usage: pnpm test:live            (BASE_RPC_URL optional)
import {
  decodeFunctionResult, encodeAbiParameters, encodeDeployData, encodeFunctionData, getContractAddress,
  keccak256, maxUint256, numberToHex, pad, toHex, type Address, type Hex,
} from "viem";
import { ADDR } from "../../shared/src/chain";
import { b20Abi, clRouterAbi, erc20Abi, pickBookAbi, pickBookBytecode, prizePoolAbi, prizePoolBytecode } from "../../shared/src/abis";
import { makePublicClient } from "../../shared/src/rpc";
import { tokenByTicker } from "../../shared/src/universe";
import { latestRound } from "../../shared/src/prices";
import { valueUsd } from "../../shared/src/b20";

const client = makePublicClient();
const STOCK = tokenByTicker(process.env.TICKER ?? "NVDA")!;
const deployer = "0x00000000000000000000000000000000de910000" as Address;
const owner = "0x0000000000000000000000000000000000000a11" as Address;
const resolver = "0x0000000000000000000000000000000000000a12" as Address;
const sponsor = "0x0000000000000000000000000000000000000a13" as Address;
const winnerEoa = "0x0000000000000000000000000000000000000a14" as Address;
const DAY = 86_400n;

/** USDC (FiatToken v2.2) keeps balances in `balanceAndBlacklistStates`, storage slot 9. */
const usdcBalanceSlot = (a: Address) => keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [a, 9n]));

type SimCall = { from: Address; to?: Address; data: Hex; label: string };

async function simulate(calls: SimCall[]) {
  const [block] = await client.simulateBlocks({
    blocks: [{
      stateOverrides: [
        ...[deployer, owner, resolver, sponsor].map((a) => ({ address: a, balance: 10n ** 18n })),
        { address: ADDR.USDC, stateDiff: [{ slot: usdcBalanceSlot(sponsor), value: pad(toHex(1_000_000_000n), { size: 32 }) }] },
      ],
      calls: calls.map((c) => ({ from: c.from, to: c.to, data: c.data })),
    }],
    validation: false,
  } as never);
  const results = (block as { calls: { status: string; data: Hex; error?: { message?: string } }[] }).calls;
  results.forEach((r, i) => {
    if (r.status !== "success") throw new Error(`call ${i} (${calls[i]!.label}) failed: ${r.error?.message ?? r.data}`);
  });
  return results;
}

const read = (token: Address, fn: "balanceOf" | "balanceOfUI", who: Address, label: string): SimCall => ({
  from: owner, to: token, label,
  data: fn === "balanceOf"
    ? encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [who] })
    : encodeFunctionData({ abi: b20Abi, functionName: "balanceOfUI", args: [who] }),
});
const u256 = (h: Hex) => BigInt(h.slice(0, 66));

async function main() {
  const latest = await client.getBlock();
  const now = latest.timestamp;
  // Genesis = Monday 00:00 UTC of the week that contains (now - 3 days): settlement is open and refunds are not.
  const t = now - 3n * DAY;
  const genesis = t - ((t - 4n * DAY) % (7n * DAY));
  const week = 1;
  const pool = getContractAddress({ from: deployer, nonce: 0n });
  const contractWinner = getContractAddress({ from: deployer, nonce: 1n });
  const deadline = now + 3600n;

  const setup: SimCall[] = [
    { from: deployer, label: "deploy PrizePool", data: encodeDeployData({ abi: prizePoolAbi, bytecode: prizePoolBytecode, args: [owner, resolver, sponsor, genesis] }) },
    { from: deployer, label: "deploy a second contract (recipient)", data: encodeDeployData({ abi: pickBookAbi, bytecode: pickBookBytecode, args: [owner] }) },
    { from: sponsor, to: ADDR.USDC, label: "USDC approve router", data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [ADDR.AERO_CL_ROUTER, 20_000_000n] }) },
    { from: sponsor, to: ADDR.AERO_CL_ROUTER, label: `buy $20 of ${STOCK.symbol}`, data: encodeFunctionData({ abi: clRouterAbi, functionName: "exactInputSingle", args: [{ tokenIn: ADDR.USDC, tokenOut: STOCK.address, tickSpacing: STOCK.pool.tickSpacing, recipient: sponsor, deadline, amountIn: 20_000_000n, amountOutMinimum: 1n, sqrtPriceLimitX96: 0n }] }) },
    read(STOCK.address, "balanceOf", sponsor, "sponsor stock balance"),
  ];
  const first = await simulate(setup);
  const bought = u256(first[4]!.data);
  console.log(`sponsor bought ${Number(bought) / 1e8} ${STOCK.symbol} for $20 (real pool, real precompile transfer)`);

  const share = (bought * 6n) / 10n;
  const rest = bought - share;
  const resultsHash = keccak256(toHex("live-test"));
  const calls: SimCall[] = [
    ...setup.slice(0, 4),
    { from: sponsor, to: STOCK.address, label: "stock approve pool", data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [pool, maxUint256] }) },
    { from: sponsor, to: pool, label: "fund(week, stock) -> transferFrom into the contract", data: encodeFunctionData({ abi: prizePoolAbi, functionName: "fund", args: [week, STOCK.address, bought] }) },
    read(STOCK.address, "balanceOf", pool, "pool raw balance"),
    read(STOCK.address, "balanceOfUI", pool, "pool UI balance"),
    { from: owner, to: STOCK.address, label: "uiMultiplier", data: encodeFunctionData({ abi: b20Abi, functionName: "uiMultiplier" }) },
    { from: resolver, to: pool, label: "settle -> transfers out of the contract", data: encodeFunctionData({ abi: prizePoolAbi, functionName: "settle", args: [week, STOCK.address, [winnerEoa, contractWinner], [share, rest], resultsHash] }) },
    read(STOCK.address, "balanceOf", winnerEoa, "EOA winner balance"),
    read(STOCK.address, "balanceOf", contractWinner, "contract winner balance"),
    read(STOCK.address, "balanceOf", pool, "pool balance after"),
    { from: owner, to: pool, label: "owed(EOA winner)", data: encodeFunctionData({ abi: prizePoolAbi, functionName: "owed", args: [STOCK.address, winnerEoa] }) },
    { from: owner, to: pool, label: "totalUnsettled", data: encodeFunctionData({ abi: prizePoolAbi, functionName: "totalUnsettled", args: [STOCK.address] }) },
  ];
  const r = await simulate(calls);
  const poolRaw = u256(r[6]!.data), poolUi = u256(r[7]!.data), mult = u256(r[8]!.data);
  const eoaBal = u256(r[10]!.data), ctBal = u256(r[11]!.data), poolAfter = u256(r[12]!.data);
  const owedEoa = u256(r[13]!.data), unsettled = u256(r[14]!.data);
  const price = await latestRound(client, STOCK.feed);

  const checks: [string, boolean][] = [
    ["pool received the full funding (stock INTO a contract)", poolRaw === bought],
    ["balanceOfUI == raw x uiMultiplier / 1e18", poolUi === (poolRaw * mult) / 10n ** 18n],
    ["EOA winner received its share (stock OUT of the contract)", eoaBal === share],
    ["contract winner received its share (a contract can hold stock)", ctBal === rest],
    ["pool is empty after settlement", poolAfter === 0n],
    ["nothing became owed (no transfer was refused)", owedEoa === 0n],
    ["accounting closed (totalUnsettled == 0)", unsettled === 0n],
  ];
  console.log(`block ${latest.number} (${new Date(Number(now) * 1000).toISOString()}), stock ${STOCK.symbol} ${STOCK.address}`);
  console.log(`uiMultiplier ${Number(mult) / 1e18}; pool held raw ${Number(poolRaw) / 1e8}, UI ${Number(poolUi) / 1e8} shares`);
  console.log(`valued at Chainlink ${STOCK.ticker} $${(Number(price.answer) / 1e8).toFixed(2)} (updated ${new Date(price.updatedAt * 1000).toISOString()}): $${valueUsd(poolRaw, mult, price.answer).toFixed(4)}`);
  let ok = true;
  for (const [name, pass] of checks) { console.log(`${pass ? "PASS" : "FAIL"}  ${name}`); ok &&= pass; }
  if (!ok) process.exit(1);
  console.log("\nResult: a contract can hold and send B20 tokenized stocks. Week-1 prizes can be paid in stock.");
}
main().catch((e) => { console.error(e); process.exit(1); });
