import { parseSiweMessage } from "viem/siwe";
import { isAddress, parseAbi, type Address, type Hex } from "viem";
import { client, db } from "@/lib/data";
import { clearSession, setSession, takeNonce } from "@/lib/session";

const ownerAbi = parseAbi(["function isOwnerAddress(address account) view returns (bool)"]);

/** Verifies the Sign in with Base message (smart-account signatures included) and starts a session. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { wallet?: string; universal?: string; message?: string; signature?: string } | null;
  if (!body?.message || !body.signature || !body.wallet || !body.universal || !isAddress(body.wallet) || !isAddress(body.universal)) {
    return Response.json({ error: "Missing sign-in data" }, { status: 400 });
  }
  const nonce = await takeNonce();
  if (!nonce) return Response.json({ error: "Sign-in expired. Please try again." }, { status: 400 });
  const parsed = parseSiweMessage(body.message);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  if (parsed.nonce !== nonce) return Response.json({ error: "Sign-in nonce mismatch" }, { status: 400 });
  if (parsed.chainId !== 8453) return Response.json({ error: "Wrong network" }, { status: 400 });
  if (parsed.domain && host && parsed.domain !== host) return Response.json({ error: "Sign-in domain mismatch" }, { status: 400 });
  if (!parsed.address || parsed.address.toLowerCase() !== body.universal.toLowerCase()) return Response.json({ error: "Address mismatch" }, { status: 400 });

  const c = client();
  const ok = await c.verifySiweMessage({ message: body.message, signature: body.signature as Hex, nonce });
  if (!ok) return Response.json({ error: "Signature check failed" }, { status: 401 });

  // The league wallet is the app sub-account. Once it is deployed, it must list the Base Account as an owner.
  const wallet = body.wallet as Address;
  const code = await c.getCode({ address: wallet });
  if (code && code !== "0x") {
    const owned = await c.readContract({ address: wallet, abi: ownerAbi, functionName: "isOwnerAddress", args: [body.universal as Address] }).catch(() => false);
    if (!owned) return Response.json({ error: "This app account does not belong to your Base Account" }, { status: 401 });
  }
  const d = await db();
  await d.query(
    `insert into players (wallet, universal) values ($1, $2)
     on conflict (wallet) do update set universal = excluded.universal`,
    [wallet.toLowerCase(), body.universal.toLowerCase()],
  );
  const [p] = await d.query<{ non_us_confirmed_at: string | null }>("select non_us_confirmed_at from players where wallet = $1", [wallet.toLowerCase()]);
  await setSession({ wallet, universal: body.universal as Address });
  return Response.json({ ok: true, confirmed: !!p?.non_us_confirmed_at });
}

export async function DELETE() {
  await clearSession();
  return Response.json({ ok: true });
}
