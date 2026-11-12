/** "Momentum", "Atlas and Momentum", "Atlas, Steady and Momentum": names joined the way a person would write them. */
export function listText(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
