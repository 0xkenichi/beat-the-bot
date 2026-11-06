import { db } from "@/lib/data";

const ALLOWED = new Set(["pm_getPaymasterStubData", "pm_getPaymasterData", "pm_sponsorUserOperation", "eth_chainId"]);

/**
 * ERC-7677 paymaster proxy. Keeps the CDP Paymaster URL (which contains Kenichi's key) server-side and only
 * sponsors players who signed in and confirmed they are not US persons. Contract allowlists and per-user caps
 * are configured in the CDP Paymaster dashboard.
 */
export async function POST(req: Request) {
  // One CDP Paymaster endpoint per chain: Base for stock trades, Base Sepolia for free-play picks (no-cost setup).
  const chain = Number(new URL(req.url).searchParams.get("chain") ?? 8453);
  const upstream = chain === 84532 ? process.env.PAYMASTER_URL_SEPOLIA : chain === 8453 ? process.env.PAYMASTER_URL : undefined;
  if (!upstream) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Gas sponsorship is not configured" } }, { status: 503 });
  const body = (await req.json().catch(() => null)) as { id?: unknown; method?: string; params?: unknown[] } | null;
  if (!body?.method || !ALLOWED.has(body.method)) return Response.json({ jsonrpc: "2.0", id: body?.id ?? null, error: { code: -32601, message: "Method not allowed" } });
  if (body.method !== "eth_chainId") {
    const op = body.params?.[0] as { sender?: string } | undefined;
    const chainId = body.params?.[2];
    if (Number(chainId) !== chain) return Response.json({ jsonrpc: "2.0", id: body.id, error: { code: -32602, message: "Chain mismatch" } });
    const sender = op?.sender?.toLowerCase();
    const [p] = sender ? await (await db()).query("select 1 from players where wallet = $1 and non_us_confirmed_at is not null", [sender]) : [];
    if (!p) return Response.json({ jsonrpc: "2.0", id: body.id, error: { code: -32001, message: "Sponsorship is for signed-in players" } });
  }
  const r = await fetch(upstream, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}
