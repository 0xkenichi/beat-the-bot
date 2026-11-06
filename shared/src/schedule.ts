import deployments from "./deployments.json";

/**
 * League calendar. Week 1 starts on the Monday in deployments.json `genesis` (00:00 UTC), set with
 * `pnpm admin season` before the contracts are deployed; PrizePool is deployed with the same value. Times follow the
 * New York market clock, so
 * they move with US daylight saving: from 2 Nov 2026 to 13 Mar 2027 the US open is 14:30 UTC (15:30 WAT)
 * and the close 21:00 UTC (22:00 WAT).
 *  - Entries open Monday 00:00 UTC and close at the US open on the week's first trading day.
 *  - The week is scored at the US close on its last trading day (holiday weeks score early).
 */
export const GENESIS: number = deployments.genesis;
if (GENESIS % 86_400 !== 0 || new Date(GENESIS * 1000).getUTCDay() !== 1) throw new Error(`deployments.json genesis ${GENESIS} is not a Monday 00:00 UTC`);
export const DAY = 86_400;
export const WEEK = 7 * DAY;
export const WAT_OFFSET_HOURS = 1;

/** NYSE full-day closures. */
export const NYSE_HOLIDAYS = new Set([
  "2026-11-26", "2026-12-25", "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26",
  "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);
/** NYSE 13:00 ET early closes. */
export const NYSE_EARLY_CLOSES = new Set(["2026-11-27", "2026-12-24", "2027-11-26"]);

const ymd = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

/** nth weekday (0 = Sunday) of a month, as a UTC midnight timestamp. */
function nthWeekday(year: number, month: number, weekday: number, n: number): number {
  const first = new Date(Date.UTC(year, month, 1));
  const delta = (weekday - first.getUTCDay() + 7) % 7;
  return Date.UTC(year, month, 1 + delta + (n - 1) * 7) / 1000;
}

/** UTC offset of New York (hours) on a given UTC calendar day. DST: 2nd Sunday of March to 1st Sunday of November. */
export function newYorkOffsetHours(dayStartUtc: number): -4 | -5 {
  const y = new Date(dayStartUtc * 1000).getUTCFullYear();
  const dstStart = nthWeekday(y, 2, 0, 2); // March
  const dstEnd = nthWeekday(y, 10, 0, 1); // November
  return dayStartUtc >= dstStart && dayStartUtc < dstEnd ? -4 : -5;
}

const isWeekday = (dayStartUtc: number) => {
  const d = new Date(dayStartUtc * 1000).getUTCDay();
  return d >= 1 && d <= 5;
};
export const isTradingDay = (dayStartUtc: number) => isWeekday(dayStartUtc) && !NYSE_HOLIDAYS.has(ymd(dayStartUtc));

/** US open (09:30 New York) for the UTC calendar day starting at `dayStartUtc`. */
export const marketOpen = (dayStartUtc: number) => dayStartUtc + (9.5 - newYorkOffsetHours(dayStartUtc)) * 3600;
/** US close (16:00, or 13:00 on early-close days). */
export const marketClose = (dayStartUtc: number) =>
  dayStartUtc + ((NYSE_EARLY_CLOSES.has(ymd(dayStartUtc)) ? 13 : 16) - newYorkOffsetHours(dayStartUtc)) * 3600;

export const weekIdAt = (t: number) => Math.floor((t - GENESIS) / WEEK) + 1;
export const weekStart = (weekId: number) => GENESIS + (weekId - 1) * WEEK;

export type WeekSchedule = {
  weekId: number;
  entryOpen: number;
  entryClose: number;
  scoreAt: number;
  resultsAt: number;
  reminderAt: number;
  entriesOpenPostAt: number;
  tradingDays: number[];
};

export function weekSchedule(weekId: number): WeekSchedule {
  const start = weekStart(weekId);
  const tradingDays = [0, 1, 2, 3, 4].map((d) => start + d * DAY).filter(isTradingDay);
  if (tradingDays.length === 0) throw new Error(`Week ${weekId} has no trading days`);
  const entryClose = marketOpen(tradingDays[0]!);
  const scoreAt = marketClose(tradingDays[tradingDays.length - 1]!);
  return {
    weekId,
    entryOpen: start,
    entryClose,
    scoreAt,
    resultsAt: scoreAt + 30 * 60, // Telegram results, 30 minutes after the close
    reminderAt: entryClose - 3600, // "one hour left"
    entriesOpenPostAt: start + 5 * 3600, // Monday 06:00 WAT
    tradingDays,
  };
}

/** True during regular US market hours on a trading day. */
export function isMarketOpen(t: number): boolean {
  const day = t - (t % DAY);
  return isTradingDay(day) && t >= marketOpen(day) && t < marketClose(day);
}

/** The next US open at or after t. */
export function nextMarketOpen(t: number): number {
  for (let day = t - (t % DAY), i = 0; i < 14; i++, day += DAY) {
    if (isTradingDay(day) && marketOpen(day) >= t) return marketOpen(day);
  }
  throw new Error("no market open within 14 days");
}

/** Close of the trading day `n` trading days before the most recent close at or before t. */
export function tradingCloseBefore(t: number, n: number): number {
  const closes: number[] = [];
  for (let day = t - (t % DAY), i = 0; closes.length <= n && i < 60; i++, day -= DAY) {
    if (isTradingDay(day) && marketClose(day) <= t) closes.push(marketClose(day));
  }
  if (closes.length <= n) throw new Error("not enough trading days");
  return closes[n]!;
}

/** "15:30 WAT" style label. */
export function watTime(t: number): string {
  const d = new Date((t + WAT_OFFSET_HOURS * 3600) * 1000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} WAT`;
}

export function watDateTime(t: number): string {
  const d = new Date((t + WAT_OFFSET_HOURS * 3600) * 1000);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]}, ${watTime(t)}`;
}
