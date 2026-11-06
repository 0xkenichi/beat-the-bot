import type { Row, WeekTable } from "./league";
import { pct } from "./scoring";
import { watTime } from "./schedule";

/**
 * Telegram copy in English. The weekly message is the product's best writing: short, specific, with proof.
 * Pidgin versions are written by Kenichi (bot-telegram/src/pidgin.ts) and used when a player picks Pidgin.
 */
export const EN = {
  entriesOpen: (week: number, closeAt: number, botsLine: string) =>
    `Week ${week} is open.\n\n${botsLine}\n\nPick three stocks before ${watTime(closeAt)} today. Free play takes three taps; real money starts at $1.`,
  oneHourLeft: (week: number) => `One hour left to get into week ${week}. Entries close at the US open.`,
  resultsHeader: (week: number) => `Week ${week} results`,
  noHumans: "No humans beat the bots this week. Next week opens Monday.",
};

const fmt = (r: Row) => `${r.name} ${pct(r.ret, 2)}`;

/** The group message posted after every Friday close. */
export function resultsMessage(t: WeekTable, site: string): string {
  const lines: string[] = [EN.resultsHeader(t.weekId), ""];
  const best = t.bots[0];
  if (t.bots.length) lines.push(`Bots: ${t.bots.map(fmt).join(" · ")}`);
  const winners = [...t.real.filter((r) => r.beatTheBot), ...t.paper.filter((r) => r.beatTheBot)];
  if (winners.length) {
    lines.push("", `Beat the bot (${best ? `${best.name} ${pct(best.ret, 2)}` : "best bot"}):`);
    for (const w of winners.slice(0, 10)) lines.push(`• ${fmt(w)} (${w.tier === "real" ? "real money" : "free play"})`);
  } else {
    lines.push("", EN.noHumans);
  }
  const top = (rows: Row[], label: string) => rows.length && lines.push("", `${label}: ${rows.slice(0, 3).map((r, i) => `${i + 1}. ${fmt(r)}`).join("  ")}`);
  top(t.real, "Real money");
  top(t.paper, "Free play");
  lines.push("", `Full table, prices and payouts: ${site}/week/${t.weekId}`);
  if (t.resultsHash) lines.push(`Results hash: ${t.resultsHash.slice(0, 18)}…`);
  return lines.join("\n");
}

/** The personal DM: "You beat Momentum and Steady. Contrarian beat you by 0.4%." */
export function personalMessage(t: WeekTable, me: Row, prize?: { text: string; tx?: string }, site?: string): string {
  const beaten = t.bots.filter((b) => me.ret > b.ret).map((b) => b.name);
  const above = t.bots.filter((b) => b.ret >= me.ret).sort((a, b) => a.ret - b.ret)[0];
  const parts = [`Week ${t.weekId}: you made ${pct(me.ret, 2)}.`];
  if (beaten.length === t.bots.length && t.bots.length) parts.push(`You beat all ${t.bots.length} bots.`);
  else if (beaten.length) parts.push(`You beat ${beaten.join(" and ")}.`);
  if (above) parts.push(`${above.name} beat you by ${((above.ret - me.ret) * 100).toFixed(1)}%.`);
  if (prize) parts.push(`Prize: ${prize.text}, in your wallet.${prize.tx ? ` Proof: https://basescan.org/tx/${prize.tx}` : ""}`);
  if (site) parts.push(`\n\nShare your week: ${site}/p/${me.wallet.toLowerCase()}?week=${t.weekId}`);
  return parts.join(" ");
}
