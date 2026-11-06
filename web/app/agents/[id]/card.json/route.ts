import { agent } from "@/lib/data";
import { CHAINS, type ContractsChainId } from "@btb/shared/chain";
import { contractsChainId, network } from "@btb/shared/config";

/** ERC-8004 agent registration file (eips.ethereum.org/EIPS/eip-8004#registration-v1). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await agent(id);
  if (!data) return Response.json({ error: "unknown agent" }, { status: 404 });
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin;
  const identity = network().agentIdentities[id];
  const chain = (data.agent.identity_chain ?? contractsChainId()) as ContractsChainId;
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
      registrations: identity ? [{ agentId: Number(identity.erc8004Id), agentRegistry: `eip155:${chain}:${CHAINS[chain].erc8004Identity}` }] : [],
      supportedTrust: [],
      wallet: data.agent.wallet,
    },
    { headers: { "cache-control": "public, max-age=300" } },
  );
}
