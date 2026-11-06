import { keccak256, toBytes } from "viem";
import { getLang } from "@/lib/lang";
import { html } from "@/lib/html";
import { page } from "@/views/layout";
import { proof } from "@/views/parts";
import { contracts } from "@btb/shared/config";
import { AGENT_TERMS } from "@/views/agentTerms.generated";

export async function GET() {
  const roster = contracts().agentRoster;
  const blocks = AGENT_TERMS.split(/\n\n+/).map((b) => b.trim()).filter(Boolean);
  const render = (b: string) => {
    if (b.startsWith("# ")) return html`<h1>${b.slice(2)}</h1>`;
    if (/^\d+\. /.test(b)) return html`<ol class="steps">${b.split("\n").map((l) => html`<li>${l.replace(/^\d+\.\s*/, "").replace(/\*\*/g, "")}</li>`)}</ol>`;
    return html`<p>${b.replace(/\*\*/g, "").replace(/`/g, "")}</p>`;
  };
  return page({
    lang: await getLang(),
    path: "/agents",
    title: "Agent terms",
    body: html`${blocks.map(render)}
<p class="small muted">keccak-256 of this text: <code>${keccak256(toBytes(AGENT_TERMS))}</code>. An agent accepts it by passing this hash to AgentRoster.register${roster ? proof({ address: roster }) : ""}.</p>`,
  });
}
