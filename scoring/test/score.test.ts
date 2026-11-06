import { describe, expect, it } from "vitest";
import type { PublicClient } from "viem";
import { openDb } from "@btb/shared/db";
import { UNIVERSE, weekSchedule, ADDR } from "@btb/shared";
import { scoreWeek, type PriceRec } from "../src/score";

/**
 * Scoring dry run against a hand calculation. Every expected number below is worked out by hand in the comments.
 */
describe("week scoring matches a hand calculation", async () => {
  const db = await openDb("pglite:");
  const s = weekSchedule(1);
  const mid = s.entryClose + 2 * 86400;
  const [t0, t1, t2] = UNIVERSE;
  const price = (p: number): PriceRec => ({ price8: String(Math.round(p * 1e8)), updatedAt: s.scoreAt - 60, roundId: "1", stale: false, feed: "0x0" });
  const open = { [t0!.address.toLowerCase()]: price(100), [t1!.address.toLowerCase()]: price(200), [t2!.address.toLowerCase()]: price(50) };
  const close = { [t0!.address.toLowerCase()]: price(110), [t1!.address.toLowerCase()]: price(190), [t2!.address.toLowerCase()]: price(51) };
  const W = { botA: "0x00000000000000000000000000000000000000a1", botB: "0x00000000000000000000000000000000000000b1", p1: "0x0000000000000000000000000000000000000c01", p2: "0x0000000000000000000000000000000000000c02", p3: "0x0000000000000000000000000000000000000c03", p4: "0x0000000000000000000000000000000000000c04" };

  await db.query(`insert into weeks (week, entry_open, entry_close, score_at, universe, open_prices, prize_token, real_pot_raw, paper_pot_raw, status) values (1, $1, $2, $3, $4::jsonb, $5::jsonb, $6, '40000000', '10000000', 'live')`,
    [s.entryOpen, s.entryClose, s.scoreAt, JSON.stringify(UNIVERSE.map((u) => u.address)), JSON.stringify(open), ADDR.USDC]);
  await db.query(`insert into agents (id, name, strategy, wallet) values ('a', 'Alpha', 'x', $1), ('b', 'Beta', 'y', $2)`, [W.botA, W.botB]);
  for (const [w, tg] of [[W.p1, 101], [W.p2, null], [W.p3, 103], [W.p4, 104]] as const) {
    await db.query("insert into players (wallet, non_us_confirmed_at, telegram_id) values ($1, now(), $2)", [w, tg]);
  }
  const snap = (w: string, t: number, v: number) => db.query("insert into nav_snapshots (wallet, taken_at, block, nav_usd, usdc_raw, holdings) values ($1, to_timestamp($2), 1, $3, '0', '[]')", [w, t, v]);
  // Bot Alpha: 100 -> 102 -> 104.04, no flows. Return = 1.02 * 1.02 - 1 = +4.04%
  await snap(W.botA, s.entryClose, 100); await snap(W.botA, mid, 102); await snap(W.botA, s.scoreAt, 104.04);
  // Bot Beta: 100 -> 99 -> 97.02. Return = 0.99 * 0.98 - 1 = -2.98%
  await snap(W.botB, s.entryClose, 100); await snap(W.botB, mid, 99); await snap(W.botB, s.scoreAt, 97.02);
  // Player 1: $10 at the open, deposits $20 mid-week, $31 at mid, $32.55 at the close.
  // TWR = (31 / (10 + 20)) * (32.55 / 31) - 1 = 32.55 / 30 - 1 = +8.5%
  await snap(W.p1, s.entryClose, 10); await snap(W.p1, mid, 31); await snap(W.p1, s.scoreAt, 32.55);
  await db.query("insert into flows (tx_hash, log_index, wallet, token, amount_raw, usd, ts, block) values ('0x01', 0, $1, $2, '20000000', 20, to_timestamp($3), 1)", [W.p1, ADDR.USDC.toLowerCase(), mid - 3600]);
  // Player 2: $6 -> $5.70 = -5%, but no Telegram link: ranked, not prize-eligible.
  await snap(W.p2, s.entryClose, 6); await snap(W.p2, s.scoreAt, 5.7);
  // Player 4: $4 at the open: below the $5 minimum, not ranked.
  await snap(W.p4, s.entryClose, 4); await snap(W.p4, s.scoreAt, 4.4);
  // Paper: prices +10%, -5%, +2%.
  // Player 3 picks 50/30/20: 0.5*0.10 + 0.3*(-0.05) + 0.2*0.02 = +3.9%
  // Player 1 picks 34/33/33: 0.34*0.10 + 0.33*(-0.05) + 0.33*0.02 = +2.41%
  const lock = (w: string, picks: number[], at: number) =>
    db.query("insert into paper_locks (week, wallet, picks, picks_hash, locked_at, tx_hash, block) values (1, $1, $2::jsonb, '0x', $3, '0xab', 1)", [w, JSON.stringify(picks.map((weightBps, tokenIndex) => ({ tokenIndex, weightBps }))), at]);
  await lock(W.p3, [5000, 3000, 2000], s.entryOpen + 100);
  await lock(W.p1, [3400, 3300, 3300], s.entryOpen + 200);

  const { results, hash } = await scoreWeek({} as PublicClient, db, 1, { now: s.scoreAt + 600, closePrices: close, takeSnapshot: false });

  it("bot returns", () => {
    expect(results.bots.map((b) => b.name)).toEqual(["Alpha", "Beta"]);
    expect(results.bots[0]!.ret).toBeCloseTo(0.0404, 10);
    expect(results.bots[1]!.ret).toBeCloseTo(-0.0298, 10);
  });
  it("real-money returns are time-weighted and the $5 minimum applies", () => {
    expect(results.real.map((r) => r.wallet)).toEqual([W.p1, W.p2]);
    expect(results.real[0]!.ret).toBeCloseTo(0.085, 10);
    expect(results.real[1]!.ret).toBeCloseTo(-0.05, 10);
    expect(results.real[1]!.eligible).toBe(false);
  });
  it("paper returns", () => {
    expect(results.paper.map((r) => r.wallet)).toEqual([W.p3, W.p1]);
    expect(results.paper[0]!.ret).toBeCloseTo(0.039, 10);
    expect(results.paper[1]!.ret).toBeCloseTo(0.0241, 10);
  });
  it("beat the bot", () => {
    expect(results.real[0]!.beatTheBot).toBe(true); // 8.5% > 4.04%
    expect(results.paper[0]!.beatTheBot).toBe(false); // 3.9% < 4.04%
    expect(results.paper[0]!.beats).toEqual(["Beta"]);
  });
  it("prizes go 50/30/20 to eligible players only", () => {
    // Real pot $40: only player 1 is eligible -> $20 (50%); the other $20 returns to the sponsor at settle.
    // Paper pot $10: player 3 first -> $5, player 1 second -> $3; third share ($2) returns to the sponsor.
    expect(results.winners).toEqual([
      expect.objectContaining({ tier: "real", rank: 1, wallet: W.p1, amountRaw: "20000000" }),
      expect.objectContaining({ tier: "paper", rank: 1, wallet: W.p3, amountRaw: "5000000" }),
      expect.objectContaining({ tier: "paper", rank: 2, wallet: W.p1, amountRaw: "3000000" }),
    ]);
  });
  it("an excluded wallet is ranked but wins nothing", async () => {
    const r = await scoreWeek({} as PublicClient, db, 1, { now: s.scoreAt + 600, closePrices: close, takeSnapshot: false, excluded: [W.p3] });
    expect(r.results.paper[0]!.wallet).toBe(W.p3);
    expect(r.results.winners.filter((x) => x.tier === "paper").map((x) => x.wallet)).toEqual([W.p1]);
  });
  it("the results hash is stable", async () => {
    const again = await scoreWeek({} as PublicClient, db, 1, { now: s.scoreAt + 600, closePrices: close, takeSnapshot: false });
    expect(again.hash).toBe(hash);
  });
});

/**
 * The no-cost league: house bots and entered agents hold no money and compete on their locked picks, and no sponsor
 * has funded the week. Prices: +10%, -5%, +2% (same as above).
 */
describe("bots that compete on picks rank in the bots tier, scored like paper", async () => {
  const db = await openDb("pglite:");
  const s = weekSchedule(2);
  const [t0, t1, t2] = UNIVERSE;
  const price = (p: number): PriceRec => ({ price8: String(Math.round(p * 1e8)), updatedAt: s.scoreAt - 60, roundId: "1", stale: false, feed: "0x0" });
  const open = { [t0!.address.toLowerCase()]: price(100), [t1!.address.toLowerCase()]: price(200), [t2!.address.toLowerCase()]: price(50) };
  const close = { [t0!.address.toLowerCase()]: price(110), [t1!.address.toLowerCase()]: price(190), [t2!.address.toLowerCase()]: price(51) };
  const W = { mom: "0x00000000000000000000000000000000000000d1", con: "0x00000000000000000000000000000000000000d2", agent: "0x00000000000000000000000000000000000000e1", p: "0x0000000000000000000000000000000000000f01", late: "0x0000000000000000000000000000000000000f02" };

  await db.query(`insert into weeks (week, entry_open, entry_close, score_at, universe, open_prices, status) values (2, $1, $2, $3, $4::jsonb, $5::jsonb, 'live')`,
    [s.entryOpen, s.entryClose, s.scoreAt, JSON.stringify(UNIVERSE.map((u) => u.address)), JSON.stringify(open)]);
  await db.query(`insert into agents (id, name, strategy, wallet, house) values ('momentum', 'Momentum', 'x', $1, true), ('contrarian', 'Contrarian', 'y', $2, true), ('agent-1', 'Outside Agent', 'z', $3, false)`, [W.mom, W.con, W.agent]);
  await db.query("insert into players (wallet, non_us_confirmed_at, telegram_id) values ($1, now(), 201), ($2, now(), 202)", [W.p, W.late]);
  const lock = (w: string, picks: number[], at: number) =>
    db.query("insert into paper_locks (week, wallet, picks, picks_hash, locked_at, tx_hash, block) values (2, $1, $2::jsonb, '0x', $3, '0xcd', 1)", [w, JSON.stringify(picks.map((weightBps, tokenIndex) => ({ tokenIndex, weightBps }))), at]);
  // Momentum 60/30/10: 0.6*0.10 + 0.3*(-0.05) + 0.1*0.02 = +4.7%
  await lock(W.mom, [6000, 3000, 1000], s.entryOpen + 300);
  // Contrarian 20/50/30: 0.2*0.10 + 0.5*(-0.05) + 0.3*0.02 = +0.1%
  await lock(W.con, [2000, 5000, 3000], s.entryOpen + 400);
  // Outside agent 34/33/33: +2.41%
  await lock(W.agent, [3400, 3300, 3300], s.entryOpen + 500);
  // Player 50/30/20: +3.9%. A lock after entries close does not count.
  await lock(W.p, [5000, 3000, 2000], s.entryOpen + 600);
  await lock(W.late, [9000, 500, 500], s.entryClose + 60);

  const { results } = await scoreWeek({} as PublicClient, db, 2, { now: s.scoreAt + 600, closePrices: close, takeSnapshot: false });

  it("house bots and agents rank together on their picks", () => {
    expect(results.bots.map((b) => [b.name, b.agentId])).toEqual([["Momentum", "momentum"], ["Outside Agent", "agent-1"], ["Contrarian", "contrarian"]]);
    expect(results.bots[0]!.ret).toBeCloseTo(0.047, 10);
    expect(results.bots[1]!.ret).toBeCloseTo(0.0241, 10);
    expect(results.bots[2]!.ret).toBeCloseTo(0.001, 10);
    expect(results.bots[0]!.picks).toEqual([{ ticker: t0!.ticker, weightBps: 6000 }, { ticker: t1!.ticker, weightBps: 3000 }, { ticker: t2!.ticker, weightBps: 1000 }]);
  });
  it("agents are not in the players' table and can't win prizes", () => {
    expect(results.paper.map((r) => r.wallet)).toEqual([W.p]);
    expect(results.bots.every((b) => b.eligible === undefined)).toBe(true);
  });
  it("players are measured against the best bot", () => {
    expect(results.paper[0]!.ret).toBeCloseTo(0.039, 10);
    expect(results.paper[0]!.beatTheBot).toBe(false); // 3.9% < 4.7%
    expect(results.paper[0]!.beats).toEqual(["Outside Agent", "Contrarian"]);
  });
  it("an unfunded week has no winners", () => {
    expect(results.winners).toEqual([]);
  });
});
