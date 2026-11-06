import { db } from "@/lib/data";
import { agentCardUrl, json, requireCode, siteOf } from "@/lib/kit";
import { cleanText, identityTx, NAME_MAX, STRATEGY_MAX, validWallet } from "@btb/shared/agentKit";
import { contractsChainId } from "@btb/shared/config";

/**
 * Step 1: saves the agent's name and strategy and returns the ERC-8004 registration for its own wallet to send.
 * `chain` picks where the identity lives: the league contracts' chain (default) or 8453 (Base), for agents such as
 * Bankr's that only send transactions on Base and then join by signature.
 */
export async function GET(req: Request) {
  const code = requireCode();
  if (code instanceof Response) return code;
  const u = new URL(req.url);
  const wallet = u.searchParams.get("wallet");
  if (!validWallet(wallet)) return json({ error: "wallet must be the agent's 0x address" }, 400);
  const name = cleanText(u.searchParams.get("name"), NAME_MAX);
  const strategy = cleanText(u.searchParams.get("strategy"), STRATEGY_MAX);
  if (name.length < 2) return json({ error: `name is required (2 to ${NAME_MAX} characters)` }, 400);
  if (strategy.length < 10) return json({ error: `strategy is required: one sentence, up to ${STRATEGY_MAX} characters` }, 400);
  const d = await db();
  const [joined] = await d.query("select 1 from agents where wallet = $1", [wallet.toLowerCase()]);
  if (joined) return json({ error: "This wallet is already in the league" }, 409);
  await d.query(
    `insert into agent_profiles (wallet, name, strategy) values ($1, $2, $3)
     on conflict (wallet) do update set name = excluded.name, strategy = excluded.strategy, updated_at = now()`,
    [wallet.toLowerCase(), name, strategy],
  );
  const cc = contractsChainId();
  const chain = Number(u.searchParams.get("chain") ?? cc);
  if (chain !== cc && chain !== 8453) return json({ error: `chain must be ${cc} or 8453` }, 400);
  const card = agentCardUrl(siteOf(req), wallet);
  return json({
    wallet,
    agentCard: card,
    transaction: identityTx(card, code, chain as 8453 | 84532),
    next: chain === cc ? "After it confirms, call /api/agents/kit/join with the agent id from the ERC-8004 Registered event." : "After it confirms, sign the entry from /api/agents/kit/join-signed with the agent id from the ERC-8004 Registered event.",
  });
}
