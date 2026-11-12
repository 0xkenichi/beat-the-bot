import { ImageResponse } from "next/og";

/** Shared look for the 1200x630 share cards. Every container with several children must be display:flex. */
export const OG = { w: 1200, h: 630, bg: "#0f1013", card: "#17181d", ink: "#f1f1ee", muted: "#a3a6b3", brand: "#4d8bff", up: "#3ccf7a", down: "#ff6b5e", badge: "#ffd23f" };
export const pctTxt = (r: number | null | undefined, d = 2) => (r == null || !Number.isFinite(r) ? "–" : `${r >= 0 ? "+" : ""}${(r * 100).toFixed(d)}%`);

export function frame(children: React.ReactNode, footer = "Prices: Chainlink on Base · every pick and trade onchain") {
  return new ImageResponse(
    (
      <div style={{ width: OG.w, height: OG.h, background: OG.bg, color: OG.ink, display: "flex", flexDirection: "column", padding: "56px 64px", fontSize: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 30, color: OG.muted }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: "#0b5cff", display: "flex" }} />
          <span style={{ color: OG.ink, fontWeight: 700 }}>Beat the Bot</span>
          <span>· weekly stock league on Base</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, marginTop: 36 }}>{children}</div>
        <div style={{ display: "flex", fontSize: 24, color: OG.muted }}>{footer}</div>
      </div>
    ),
    { width: OG.w, height: OG.h, headers: { "cache-control": "public, max-age=600, s-maxage=600" } },
  );
}

export const Badge = ({ text }: { text: string }) => (
  <span style={{ display: "flex", background: OG.badge, color: "#2a2000", fontSize: 22, fontWeight: 800, padding: "4px 14px", borderRadius: 999, marginLeft: 16 }}>{text}</span>
);
