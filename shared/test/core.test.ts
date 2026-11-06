import { describe, expect, it } from "vitest";
import { builderCodeSuffix, hasBuilderCode } from "../src/builderCode";
import { weekSchedule, isMarketOpen, newYorkOffsetHours, watTime, GENESIS, tradingCloseBefore } from "../src/schedule";
import { timeWeightedReturn, paperReturn, prizeSplit, rankTier, markBeatTheBot, canonicalJson, resultsHash, type Ranked } from "../src/scoring";
import { valueUsd } from "../src/b20";
import { applySlippage } from "../src/swap";

const utc = (s: string) => Date.parse(s) / 1000;

describe("Builder Code (ERC-8021 schema 0)", () => {
  it("matches the example on docs.base.org", () => {
    expect(builderCodeSuffix("bc_b7k3p9da")).toBe("0x62635f62376b33703964610b0080218021802180218021802180218021");
  });
  it("detects the suffix at the end of calldata", () => {
    const data = ("0xa9059cbb" + "00".repeat(64) + builderCodeSuffix("bc_test123").slice(2)) as `0x${string}`;
    expect(hasBuilderCode(data, "bc_test123")).toBe(true);
    expect(hasBuilderCode(data, "bc_other")).toBe(false);
    expect(hasBuilderCode("0xa9059cbb", "bc_test123")).toBe(false);
  });
  it("rejects malformed codes", () => {
    expect(() => builderCodeSuffix("bad,code")).toThrow();
    expect(() => builderCodeSuffix("")).toThrow();
  });
});

describe("league calendar", () => {
  it("week 1 starts Monday 9 Nov 2026 (the repo's default season start)", () => {
    expect(GENESIS).toBe(utc("2026-11-09T00:00:00Z"));
    const w = weekSchedule(1);
    expect(w.entryClose).toBe(utc("2026-11-09T14:30:00Z")); // 15:30 WAT
    expect(watTime(w.entryClose)).toBe("15:30 WAT");
    expect(w.scoreAt).toBe(utc("2026-11-13T21:00:00Z"));
    expect(watTime(w.resultsAt)).toBe("22:30 WAT");
    expect(watTime(w.reminderAt)).toBe("14:30 WAT");
  });
  it("Thanksgiving week scores at Friday's 13:00 ET early close", () => {
    const w = weekSchedule(3);
    expect(w.scoreAt).toBe(utc("2026-11-27T18:00:00Z"));
    expect(w.tradingDays.length).toBe(4);
  });
  it("Christmas week scores Thursday at the early close; New Year week scores Thursday", () => {
    expect(weekSchedule(7).scoreAt).toBe(utc("2026-12-24T18:00:00Z"));
    expect(weekSchedule(8).scoreAt).toBe(utc("2026-12-31T21:00:00Z"));
  });
  it("MLK Day moves the entry close to Tuesday's open", () => {
    expect(weekSchedule(11).entryClose).toBe(utc("2027-01-19T14:30:00Z"));
  });
  it("follows US daylight saving", () => {
    expect(newYorkOffsetHours(utc("2026-10-30T00:00:00Z"))).toBe(-4);
    expect(newYorkOffsetHours(utc("2026-11-02T00:00:00Z"))).toBe(-5);
    expect(weekSchedule(19).entryClose).toBe(utc("2027-03-15T13:30:00Z"));
  });
  it("knows when the market is open", () => {
    expect(isMarketOpen(utc("2026-11-10T15:00:00Z"))).toBe(true);
    expect(isMarketOpen(utc("2026-11-10T14:00:00Z"))).toBe(false);
    expect(isMarketOpen(utc("2026-11-14T15:00:00Z"))).toBe(false); // Saturday
    expect(isMarketOpen(utc("2026-11-26T15:00:00Z"))).toBe(false); // Thanksgiving
  });
  it("finds the close five trading days back", () => {
    // From Monday 16 Nov after the open: last close Fri 13 Nov, five trading days earlier Fri 6 Nov.
    expect(tradingCloseBefore(utc("2026-11-16T15:00:00Z"), 0)).toBe(utc("2026-11-13T21:00:00Z"));
    expect(tradingCloseBefore(utc("2026-11-16T15:00:00Z"), 5)).toBe(utc("2026-11-06T21:00:00Z"));
  });
});

describe("scoring", () => {
  it("time-weighted return ignores deposits and withdrawals", () => {
    // $100 grows 10%, then $100 is added, then the $210 grows 10%.
    const snaps = [
      { t: 0, valueUsd: 100 },
      { t: 1, valueUsd: 110 },
      { t: 2, valueUsd: 231 },
    ];
    const r = timeWeightedReturn(snaps, [{ t: 2, usd: 100 }]);
    expect(r).toBeCloseTo(0.21, 10);
    // A late large deposit does not inflate the return.
    const r2 = timeWeightedReturn([{ t: 0, valueUsd: 5 }, { t: 1, valueUsd: 105 * 1.02 }], [{ t: 1, usd: 100 }]);
    expect(r2).toBeCloseTo(0.02, 10);
  });
  it("paper return is the weighted sum of price changes", () => {
    const tokens = ["0xA", "0xB", "0xC"];
    const open = { "0xa": 100_00000000n, "0xb": 200_00000000n, "0xc": 50_00000000n };
    const close = { "0xa": 110_00000000n, "0xb": 190_00000000n, "0xc": 50_00000000n };
    const r = paperReturn([{ tokenIndex: 0, weightBps: 5000 }, { tokenIndex: 1, weightBps: 3000 }, { tokenIndex: 2, weightBps: 2000 }], tokens, open, close);
    expect(r).toBeCloseTo(0.5 * 0.1 + 0.3 * -0.05, 12);
  });
  it("ranks with ties to the earlier lock and marks beat-the-bot", () => {
    const ranked = rankTier<Ranked>([
      { wallet: "0x2", tier: "paper" as const, ret: 0.03, lockedAt: 20 },
      { wallet: "0x1", tier: "paper" as const, ret: 0.03, lockedAt: 10 },
      { wallet: "0x3", tier: "paper" as const, ret: 0.05, lockedAt: 30 },
    ]);
    expect(ranked.map((r) => r.wallet)).toEqual(["0x3", "0x1", "0x2"]);
    const bots = [{ wallet: "b1", tier: "bot" as const, ret: 0.04, name: "Momentum" }, { wallet: "b2", tier: "bot" as const, ret: 0.01, name: "Steady" }];
    const marked = markBeatTheBot(ranked, bots);
    expect(marked[0]!.beatTheBot).toBe(true);
    expect(marked[1]!.beats).toEqual(["Steady"]);
    expect(marked[1]!.beatTheBot).toBe(false);
  });
  it("splits prizes 50/30/20", () => {
    expect(prizeSplit(40_000_000n, 3)).toEqual([20_000_000n, 12_000_000n, 8_000_000n]);
    expect(prizeSplit(40_000_000n, 1)).toEqual([20_000_000n]);
  });
  it("hashes results canonically", () => {
    expect(canonicalJson({ b: 1n, a: [{ d: 2, c: undefined }] })).toBe('{"a":[{"d":2}],"b":"1"}');
    expect(resultsHash({ x: 1, y: 2 })).toBe(resultsHash({ y: 2, x: 1 }));
  });
});

describe("valuation and slippage", () => {
  it("values a B20 balance with its multiplier", () => {
    // 0.5 token, multiplier 1.02, price $200 => $102
    expect(valueUsd(50_000_000n, 1_020_000_000_000_000_000n, 200_00000000n)).toBeCloseTo(102, 8);
  });
  it("applies a 1% slippage floor", () => {
    expect(applySlippage(1_000_000n)).toBe(990_000n);
  });
});
