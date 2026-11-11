import { issueNonce } from "@/lib/session";

export async function GET() {
  if (!process.env.SESSION_SECRET) return Response.json({ error: "Sign-in opens at launch." }, { status: 503 });
  return Response.json({ nonce: await issueNonce() }, { headers: { "cache-control": "no-store" } });
}
