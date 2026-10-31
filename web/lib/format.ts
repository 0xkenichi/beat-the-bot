export const usd = (n: number, digits = 2) =>
  `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
export const pct = (r: number | null | undefined, digits = 1) =>
  r == null || !Number.isFinite(r) ? "–" : `${r >= 0 ? "+" : ""}${(r * 100).toFixed(digits)}%`;
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const shares = (raw: string | bigint, decimals = 8) => {
  const n = Number(BigInt(raw)) / 10 ** decimals;
  return n >= 1 ? n.toFixed(4) : n.toPrecision(4);
};
