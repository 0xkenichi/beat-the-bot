import "server-only";
import { builderCodeFromConfig } from "@btb/shared/config";

export const siteOf = (req: Request) => (process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin).replace(/\/$/, "");
export const agentCardUrl = (site: string, wallet: string) => `${site}/agents/w/${wallet.toLowerCase()}/card.json`;
export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store", "access-control-allow-origin": "*" } });

export function requireCode(): string | Response {
  const code = builderCodeFromConfig();
  return code ?? json({ error: "The league's Builder Code is not configured yet. Try again after launch." }, 503);
}
