import { describe, expect, it } from "vitest";
import { UNIVERSE, type WalletValue } from "@btb/shared";
import { checkWeights, planRebalance } from "../src/executor";
import { parseWeights } from "../src/strategies/steady";
import { equalWeights } from "../src/strategies/common";

const [a, b, c] = UNIVERSE;
const empty = (usdc: number): WalletValue => ({ wallet: "0x0000000000000000000000000000000000000001", block: 1n, navUsd: usdc, usdcRaw: BigInt(usdc * 1e6), holdings: [] });

describe("guardrails", () => {
  it("rejects more than 50% in one name, tokens outside the universe, and over-allocation", () => {
    expect(() => checkWeights({ [a!.address]: 6000, [b!.address]: 4000 })).toThrow(/50%/);
    expect(() => checkWeights({ "0x000000000000000000000000000000000000dEaD": 1000 })).toThrow(/universe/);
    expect(() => checkWeights({ [a!.address]: 5000, [b!.address]: 5000, [c!.address]: 100 })).toThrow(/sum/);
  });
  it("equal weights sum to 100%", () => {
    const w = equalWeights(UNIVERSE.slice(0, 3));
    expect(Object.values(w).reduce((x, y) => x + y, 0)).toBe(10_000);
  });
});

describe("rebalance planning", () => {
  it("invests 95% of a fresh $50 wallet in thirds and keeps a 5% buffer", () => {
    const plan = planRebalance(empty(50), equalWeights([a!, b!, c!]));
    expect(plan).toHaveLength(3);
    expect(plan.every((p) => p.side === "buy")).toBe(true);
    const total = plan.reduce((s, p) => s + p.usd, 0);
    expect(total).toBeCloseTo(47.5, 1);
  });
  it("sells what is no longer wanted before buying", () => {
    const v: WalletValue = {
      ...empty(0),
      navUsd: 50,
      usdcRaw: 2_500_000n,
      holdings: [{ token: a!.address, ticker: a!.ticker, raw: "10000000", ui: "10000000", multiplier: (10n ** 18n).toString(), price8: "47500000000", priceUpdatedAt: 0, feedRound: "1", valueUsd: 47.5 }],
    };
    const plan = planRebalance(v, equalWeights([b!, c!]));
    expect(plan[0]!.side).toBe("sell");
    expect(plan[0]!.amountIn).toBe(10_000_000n); // the whole position
    expect(plan.slice(1).every((p) => p.side === "buy")).toBe(true);
  });
});

describe("Steady's model answer", () => {
  it("accepts a valid answer", () => {
    const r = parseWeights('Sure: {"weights": {"AAPL": 40, "NVDA": 35, "TSLA": 25}, "reason": "Balanced."}', UNIVERSE);
    expect("weights" in r && Object.keys(r.weights)).toHaveLength(3);
  });
  it("rejects bad answers", () => {
    expect(parseWeights('{"weights": {"AAPL": 60, "NVDA": 40}}', UNIVERSE)).toEqual({ error: "AAPL above 50%" });
    expect(parseWeights('{"weights": {"AAPL": 50, "NVDA": 40}}', UNIVERSE)).toEqual({ error: "weights sum to 90" });
    expect(parseWeights('{"weights": {"DOGE": 100}}', UNIVERSE)).toEqual({ error: "unknown ticker DOGE" });
    expect(parseWeights("no json here", UNIVERSE)).toEqual({ error: "no JSON object" });
  });
});
