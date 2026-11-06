import "server-only";
import { weekIdAt, weekSchedule } from "@btb/shared/schedule";

/** The week an agent's picks go to now: this week until its entries close (the US open on Monday), then next week. */
export function entryWeek(now = Math.floor(Date.now() / 1000)) {
  const cur = weekSchedule(Math.max(1, weekIdAt(now)));
  const s = now < cur.entryClose ? cur : weekSchedule(cur.weekId + 1);
  return { ...s, openNow: now >= s.entryOpen && now < s.entryClose };
}
