// Screenshots of the site for the README, the grant form and the demo video, from a local preview filled with the
// demo data (real prices and the bots' real picks; made-up players and agent). Uses the installed Google Chrome,
// headless, with a throwaway profile, and the site's production build. Phones are emulated over the DevTools protocol
// (Chrome windows can't be narrower than about 500 px, so a plain --window-size would lay the page out too wide).
//
//   DATABASE_URL=pglite:./data/local/demo npx tsx scripts/demo-seed.ts
//   npx tsx scripts/capture/screens.ts                 -> docs/launch/screens/*.png
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = resolve(ROOT, process.env.SCREENS_OUT ?? "docs/launch/screens");
const DB = resolve(ROOT, "data/local/demo");
if (!existsSync(CHROME)) throw new Error("Needs Google Chrome in /Applications");
if (!existsSync(DB)) throw new Error("Run the demo seed first: DATABASE_URL=pglite:./data/local/demo npx tsx scripts/demo-seed.ts");
if (!existsSync(join(ROOT, "web/.next/BUILD_ID"))) throw new Error("Build the site first: pnpm --dir web exec next build");

const port = 9400 + Math.floor(Math.random() * 300);
const site = `http://127.0.0.1:${port}`;
// Placeholder contract addresses put the site in its live state; nothing here talks to a real contract.
const env = {
  PATH: process.env.PATH ?? "", HOME: homedir(), TMPDIR: tmpdir(), BTB_NO_DOTENV: "1", NEXT_TELEMETRY_DISABLED: "1",
  DATABASE_URL: `pglite:${DB}`, CONTRACTS_CHAIN_ID: "84532", BUILDER_CODE: "bc_preview",
  NEXT_PUBLIC_PICKBOOK: "0x1111111111111111111111111111111111111111", NEXT_PUBLIC_AGENTROSTER: "0x2222222222222222222222222222222222222222",
  NEXT_PUBLIC_PRIZEPOOL: "0x3333333333333333333333333333333333333333",
  SESSION_SECRET: "local-preview-only-not-a-secret-0123456789", PAYMASTER_URL: "http://127.0.0.1:1/preview",
  BASE_RPC_URL: process.env.BASE_RPC_URL ?? "https://base-mainnet.g.alchemy.com/public",
};

// h caps the height: the shot is the full page up to h CSS pixels.
type Shot = { name: string; path: string; w: number; h: number; scale: number; mobile: boolean };
const phone = (name: string, path: string, h = 1500): Shot => ({ name, path, w: 390, h, scale: 2, mobile: true });
const SHOTS: Shot[] = [
  phone("phone-home", "/"),
  phone("phone-agents", "/agents"),
  phone("phone-momentum", "/agents/momentum"),
  phone("phone-agent", "/agents/agent-1"),
  phone("phone-trade", "/trade"),
  phone("phone-rules", "/rules"),
  { name: "desktop-home", path: "/", w: 1280, h: 900, scale: 1.5, mobile: false },
];
// The player card shows whoever leads this week, read from the demo database before the site opens it.
process.env.BTB_NO_DOTENV = "1";
const { openDb } = await import("../../shared/src/db");
const { weekTable } = await import("../../shared/src/league");
const demo = await openDb(`pglite:${DB}`);
const table = await weekTable(demo);
await demo.close();
const leader = [...table.real, ...table.paper].sort((a, b) => b.ret - a.ret)[0];
const CARDS = [
  { name: "card-week", path: `/api/og/week/${table.weekId}` },
  { name: "card-momentum", path: "/api/og/agent/momentum" },
  ...(leader ? [{ name: "card-player", path: `/api/og/player/${leader.wallet}?week=${table.weekId}` }] : []),
];

/** A minimal DevTools Protocol client over Node's built-in WebSocket. */
async function devtools(wsUrl: string) {
  const ws = new WebSocket(wsUrl);
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
  let id = 0;
  const waiting = new Map<number, (r: { result?: Record<string, unknown>; error?: { message: string } }) => void>();
  const events = new Map<string, () => void>();
  ws.onmessage = (m) => {
    const msg = JSON.parse(String(m.data));
    if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)!(msg); waiting.delete(msg.id); }
    else if (msg.method && events.has(msg.method)) { events.get(msg.method)!(); events.delete(msg.method); }
  };
  const send = (method: string, params: object = {}) => new Promise<Record<string, unknown>>((ok, fail) => {
    const n = ++id;
    waiting.set(n, (r) => (r.error ? fail(new Error(`${method}: ${r.error.message}`)) : ok(r.result ?? {})));
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const once = (event: string, ms: number) => new Promise<void>((ok) => { events.set(event, ok); setTimeout(ok, ms); });
  return { send, once, close: () => ws.close() };
}

const server = spawn("pnpm", ["--dir", "web", "exec", "next", "start", "-p", String(port)], { cwd: ROOT, env, stdio: "ignore" });
const profile = mkdtempSync(join(tmpdir(), "btb-chrome-"));
const cdpPort = port + 1000;
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, `--remote-debugging-port=${cdpPort}`, "about:blank"], { stdio: "ignore" });
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(`${site}/rules`)).ok) break; } catch { /* starting */ }
    if (i > 150) throw new Error("the site did not start");
    await new Promise((r) => setTimeout(r, 200));
  }
  mkdirSync(OUT, { recursive: true });
  let pageWs = "";
  for (let i = 0; !pageWs; i++) {
    try { pageWs = ((await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[]).find((t) => t.type === "page")?.webSocketDebuggerUrl ?? ""; } catch { /* starting */ }
    if (!pageWs) { if (i > 100) throw new Error("Chrome did not start"); await new Promise((r) => setTimeout(r, 200)); }
  }
  const cdp = await devtools(pageWs);
  await cdp.send("Page.enable");
  for (const s of SHOTS) {
    await fetch(`${site}${s.path}`); // warm the page so the screenshot doesn't catch a cold start
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: s.w, height: 844, deviceScaleFactor: s.scale, mobile: s.mobile });
    const loaded = cdp.once("Page.loadEventFired", 15_000);
    await cdp.send("Page.navigate", { url: `${site}${s.path}` });
    await loaded;
    await new Promise((r) => setTimeout(r, 800)); // countdowns and fonts settle
    const { result } = (await cdp.send("Runtime.evaluate", { expression: "[document.documentElement.scrollHeight, document.documentElement.scrollWidth]", returnByValue: true })) as { result: { value: [number, number] } };
    const [height, width] = result.value;
    if (width > s.w) console.log(`  warning: ${s.path} is ${width}px wide at ${s.w}px (horizontal scroll)`);
    const h = s.mobile ? Math.min(height, s.h) : s.h;
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: s.w, height: h, deviceScaleFactor: s.scale, mobile: s.mobile });
    const shot = (await cdp.send("Page.captureScreenshot", { format: "png" })) as { data: string };
    writeFileSync(join(OUT, `${s.name}.png`), Buffer.from(shot.data, "base64"));
    console.log(`  ${s.name}.png  ${s.path}  ${s.w}x${h}`);
  }
  cdp.close();
  for (const c of CARDS) {
    const res = await fetch(`${site}${c.path}`);
    if (!res.ok) throw new Error(`${c.path}: ${res.status}`);
    writeFileSync(join(OUT, `${c.name}.png`), Buffer.from(await res.arrayBuffer()));
    console.log(`  ${c.name}.png  ${c.path}`);
  }
  console.log(`Saved to ${OUT}`);
} finally {
  server.kill("SIGTERM");
  chrome.kill("SIGTERM");
  await new Promise((r) => (chrome.exitCode !== null ? r(null) : chrome.once("exit", r)));
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
