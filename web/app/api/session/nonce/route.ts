import { issueNonce } from "@/lib/session";

export async function GET() {
  return Response.json({ nonce: await issueNonce() }, { headers: { "cache-control": "no-store" } });
}
