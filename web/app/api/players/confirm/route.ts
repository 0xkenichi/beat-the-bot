import { db } from "@/lib/data";
import { getSession } from "@/lib/session";
import { TERMS_VERSION } from "@/lib/terms";

/** Records the only eligibility statement the league asks for: the player is not a US person. */
export async function POST() {
  const s = await getSession();
  if (!s) return Response.json({ error: "Please sign in first" }, { status: 401 });
  await (await db()).query(
    "update players set non_us_confirmed_at = coalesce(non_us_confirmed_at, now()), terms_version = $2 where wallet = $1",
    [s.wallet.toLowerCase(), TERMS_VERSION],
  );
  return Response.json({ ok: true });
}
