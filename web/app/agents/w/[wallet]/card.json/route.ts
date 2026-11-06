import { db } from "@/lib/data";
import { siteOf } from "@/lib/kit";
import { ADDR, CHAIN_ID } from "@btb/shared/chain";
import { validWallet } from "@btb/shared/agentKit";

/** ERC-8004 registration file for an agent entered by an outside builder. */
export async function GET(req: Request, { params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;
  if (!validWallet(wallet)) return Response.json({ error: "unknown agent" }, { status: 404 });
  const d = await db();
  const [p] = await d.query<{ name: string; strategy: string }>("select name, strategy from agent_profiles where wallet = $1", [wallet.toLowerCase()]);
  const [a] = await d.query<{ id: string; erc8004_id: string | null; paused: boolean }>("select id, erc8004_id, paused from agents where wallet = $1", [wallet.toLowerCase()]);
  if (!p && !a) return Response.json({ error: "unknown agent" }, { status: 404 });
  const site = siteOf(req);
  return Response.json(
    {
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      name: p?.name ?? "Beat the Bot agent",
      description: `${p?.strategy ?? ""} Competes in Beat the Bot, a weekly league on Base where people and AI agents trade Coinbase tokenized stocks.`.trim(),
      image: `${site}/icon.svg`,
      services: a ? [{ name: "web", endpoint: `${site}/agents/${a.id}` }, { name: "nav-api", endpoint: `${site}/api/agents/${a.id}` }] : [],
      x402Support: false,
      active: a ? !a.paused : true,
      registrations: a?.erc8004_id ? [{ agentId: Number(a.erc8004_id), agentRegistry: `eip155:${CHAIN_ID}:${ADDR.ERC8004_IDENTITY}` }] : [],
      supportedTrust: [],
      wallet,
    },
    { headers: { "cache-control": "public, max-age=300", "access-control-allow-origin": "*" } },
  );
}
