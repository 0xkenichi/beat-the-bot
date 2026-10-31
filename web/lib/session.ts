import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/** Signed session cookie: the player's league wallet (sub account) and their Base Account. */
export type Session = { wallet: `0x${string}`; universal: `0x${string}`; exp: number };

const NAME = "btb_session";
const NONCE = "btb_nonce";
const secret = () => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (32+ characters)");
  return s;
};
const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

export function seal(data: object): string {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function unseal<T>(token: string | undefined): T | null {
  if (!token) return null;
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const a = Buffer.from(sign(payload));
  const b = Buffer.from(mac);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString()) as T;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  const s = unseal<Session>((await cookies()).get(NAME)?.value);
  return s && s.exp > Date.now() / 1000 ? s : null;
}

export async function setSession(s: Omit<Session, "exp">) {
  const exp = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
  (await cookies()).set(NAME, seal({ ...s, exp }), { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 30 * 24 * 3600 });
}

export async function clearSession() {
  (await cookies()).delete(NAME);
}

export async function issueNonce(): Promise<string> {
  const nonce = createHmac("sha256", secret()).update(`${Date.now()}:${Math.random()}`).digest("hex").slice(0, 24);
  (await cookies()).set(NONCE, seal({ nonce, exp: Date.now() / 1000 + 600 }), { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 });
  return nonce;
}

export async function takeNonce(): Promise<string | null> {
  const jar = await cookies();
  const v = unseal<{ nonce: string; exp: number }>(jar.get(NONCE)?.value);
  jar.delete(NONCE);
  return v && v.exp > Date.now() / 1000 ? v.nonce : null;
}
