import { decodeEventLog, decodeFunctionData, parseAbi, type Address, type Hex, type TransactionReceipt } from "viem";
import { entryPoint06Abi, entryPoint07Abi } from "viem/account-abstraction";
import { ADDR } from "./chain";
import { UNIVERSE } from "./universe";

/** The callData of `sender`'s user operation inside a bundler's handleOps transaction (EntryPoint 0.6 or 0.7). */
export function userOpCallData(input: Hex, sender: Address): Hex | null {
  for (const abi of [entryPoint06Abi, entryPoint07Abi] as const) {
    try {
      const d = decodeFunctionData({ abi, data: input });
      if (d.functionName !== "handleOps") continue;
      const ops = d.args[0] as readonly { sender: Address; callData: Hex }[];
      const op = ops.find((o) => o.sender.toLowerCase() === sender.toLowerCase());
      if (op) return op.callData;
    } catch {
      /* try the next EntryPoint version */
    }
  }
  return null;
}

const transferAbi = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);

export type ParsedSwap = { token: Address; side: "buy" | "sell"; tokenAmount: bigint; usdc: bigint };

/** Reads the swap legs of a wallet from a receipt: USDC out + stock in is a buy, stock out + USDC in is a sell. */
export function parseSwaps(receipt: TransactionReceipt, wallet: Address): ParsedSwap[] {
  const w = wallet.toLowerCase();
  const legs: { token: string; delta: bigint }[] = [];
  const tracked = new Set([ADDR.USDC.toLowerCase(), ...UNIVERSE.map((t) => t.address.toLowerCase())]);
  for (const log of receipt.logs) {
    if (!tracked.has(log.address.toLowerCase())) continue;
    try {
      const ev = decodeEventLog({ abi: transferAbi, data: log.data, topics: log.topics });
      const from = (ev.args.from as string).toLowerCase();
      const to = (ev.args.to as string).toLowerCase();
      const v = ev.args.value as bigint;
      if (from === w) legs.push({ token: log.address.toLowerCase(), delta: -v });
      if (to === w) legs.push({ token: log.address.toLowerCase(), delta: v });
    } catch {
      /* not a Transfer */
    }
  }
  const usdc = legs.filter((l) => l.token === ADDR.USDC.toLowerCase());
  const stocks = legs.filter((l) => l.token !== ADDR.USDC.toLowerCase());
  const out: ParsedSwap[] = [];
  // Pair each stock leg with the USDC leg of opposite sign, in order.
  const usdcOut = usdc.filter((l) => l.delta < 0);
  const usdcIn = usdc.filter((l) => l.delta > 0);
  for (const s of stocks) {
    const leg = s.delta > 0 ? usdcOut.shift() : usdcIn.shift();
    out.push({ token: s.token as Address, side: s.delta > 0 ? "buy" : "sell", tokenAmount: s.delta > 0 ? s.delta : -s.delta, usdc: leg ? (leg.delta < 0 ? -leg.delta : leg.delta) : 0n });
  }
  return out;
}
