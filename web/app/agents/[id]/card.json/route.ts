import { agent } from "@/lib/data";
import { ADDR, CHAIN_ID } from "@btb/shared/chain";
import { DEPLOYMENTS } from "@btb/shared/config";

/** ERC-8004 agent registration file (eips.ethereum.org/EIPS/eip-8004#registration-v1). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await agent(id);
  if (!data) return Response.json({ error: "unknown agent" }, { status: 404 });
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin;
  const identity = DEPLOYMENTS.agentIdentities[id];
  return Response.json(
    {
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      name: `Beat the Bot: ${data.agent.name}`,
      description: `${data.agent.strategy} A house agent in Beat the Bot, a weekly stock-picking league on Base where people try to beat AI agents.`,
      image: `${site}/icon.svg`,
      services: [
        { name: "web", endpoint: `${site}/agents/${id}` },
        { name: "nav-api", endpoint: `${site}/api/agents/${id}` },
      ],
      x402Support: false,
      active: !data.agent.paused,
      registrations: identity ? [{ agentId: Number(identity.erc8004Id), agentRegistry: `eip155:${CHAIN_ID}:${ADDR.ERC8004_IDENTITY}` }] : [],
      supportedTrust: [],
      wallet: data.agent.wallet,
    },
    { headers: { "cache-control": "public, max-age=300" } },
  );
}
