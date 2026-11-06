/**
 * Base Account in the browser. Sign-in is one passkey prompt that also creates an app sub-account; after that
 * the sub-account's browser key signs every trade, so there are no more wallet pop-ups. Gas goes through the
 * paymaster proxy and every batch carries the ERC-8021 Builder Code suffix.
 */
type Provider = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
export type Call = { to: string; data: string; value: string };

let providerPromise: Promise<Provider> | null = null;
let suffix: string | null = null;

export function configure(builderSuffix: string | null) {
  suffix = builderSuffix;
}

type CreateSdk = (o: Record<string, unknown>) => { getProvider: () => unknown };
const SDK_SRC = "/js/vendor/base-account.min.js";

/** The SDK's own prebuilt browser bundle (same pinned version as package.json), served from this site. */
function loadSdk(): Promise<CreateSdk> {
  const w = window as unknown as { createBaseAccountSDK?: CreateSdk };
  if (w.createBaseAccountSDK) return Promise.resolve(w.createBaseAccountSDK);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SDK_SRC;
    s.async = true;
    s.onload = () => (w.createBaseAccountSDK ? resolve(w.createBaseAccountSDK) : reject(new Error("Wallet library failed to load")));
    s.onerror = () => reject(new Error("Wallet library failed to load. Check your connection and try again."));
    document.head.append(s);
  });
}

/** Loads and creates the SDK. Called in idle time so the pop-up opens straight from the user's tap. */
export function preload(): Promise<Provider> {
  providerPromise ??= loadSdk().then((createBaseAccountSDK) => {
    const sdk = createBaseAccountSDK({
      appName: "Beat the Bot",
      appLogoUrl: `${location.origin}/icon.svg`,
      appChainIds: [8453, 84532],
      subAccounts: { creation: "on-connect", defaultAccount: "sub", funding: "manual" },
      preference: { telemetry: false, ...(suffix ? { attribution: { dataSuffix: suffix } } : {}) },
    });
    return sdk.getProvider() as Provider;
  });
  providerPromise.catch(() => (providerPromise = null));
  return providerPromise;
}

export function preloadWhenIdle() {
  const w = window as unknown as { requestIdleCallback?: (f: () => void) => void };
  (w.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 1500)))(() => void preload());
}

let nonce: Promise<string> | null = null;
export const prefetchNonce = () => (nonce = fetch("/api/session/nonce").then((r) => r.json()).then((j) => j.nonce as string));

/** Passkey sign-in, verified by the server, which starts the session. */
export async function signIn(): Promise<{ wallet: string; confirmed: boolean }> {
  const provider = await preload();
  const n = await (nonce ?? prefetchNonce());
  nonce = null;
  const res = (await provider.request({
    method: "wallet_connect",
    params: [{ version: "1", capabilities: { signInWithEthereum: { nonce: n, chainId: "0x2105" } } }],
  })) as { accounts: { address: string; capabilities?: { signInWithEthereum?: { message: string; signature: string }; subAccounts?: { address: string }[] } }[] };
  const withSiwe = res.accounts.find((a) => a.capabilities?.signInWithEthereum);
  if (!withSiwe?.capabilities?.signInWithEthereum) throw new Error("Sign-in did not return a signature");
  const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
  const universal = withSiwe.address;
  const wallet = res.accounts.flatMap((a) => a.capabilities?.subAccounts ?? []).map((s) => s.address)[0] ?? accounts.find((a) => a.toLowerCase() !== universal.toLowerCase());
  if (!wallet) throw new Error("No app account was created");
  const r = await fetch("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet, universal, ...withSiwe.capabilities.signInWithEthereum }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? "Sign-in failed");
  return { wallet, confirmed: !!j.confirmed };
}

/**
 * Sends one atomic batch from the sub-account on the given chain (stock trades: Base, "0x2105"; free-play picks:
 * the league contracts' chain) and waits for the transaction hash. Gas goes through the paymaster proxy for that chain.
 */
export async function sendCalls(from: string, calls: Call[], opts: { sponsored?: boolean; chainHex?: string } = {}): Promise<{ id: string; txHash: string }> {
  const provider = await preload();
  const chainHex = opts.chainHex ?? "0x2105";
  const capabilities: Record<string, unknown> = {};
  if (opts.sponsored !== false) capabilities.paymasterService = { url: `${location.origin}/api/paymaster?chain=${parseInt(chainHex, 16)}` };
  if (suffix) capabilities.dataSuffix = { value: suffix, optional: true };
  const id = (await provider.request({
    method: "wallet_sendCalls",
    params: [{ version: "2.0.0", chainId: chainHex, from, atomicRequired: true, calls, capabilities }],
  })) as string | { id: string };
  const callsId = typeof id === "string" ? id : id.id;
  for (let i = 0; i < 90; i++) {
    const st = (await provider.request({ method: "wallet_getCallsStatus", params: [callsId] })) as { status: number | string; receipts?: { transactionHash: string; status?: string }[] };
    const code = typeof st.status === "number" ? st.status : st.status === "CONFIRMED" ? 200 : st.status === "PENDING" ? 100 : 400;
    if (code >= 200 && code < 300 && st.receipts?.[0]) {
      const rs = st.receipts[0].status;
      if (rs && rs !== "0x1" && rs !== "success") throw new Error("The transaction reverted onchain");
      return { id: callsId, txHash: st.receipts[0].transactionHash };
    }
    if (code >= 400) throw new Error("The transaction failed");
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Still waiting for confirmation. Check your portfolio in a minute.");
}

export const friendlyError = (e: unknown) => {
  const m = (e as Error)?.message || "Something went wrong";
  if (/paymaster|sponsor/i.test(m)) return "Gas sponsorship didn't go through. Please try again in a minute.";
  if (/user (rejected|denied|cancel)/i.test(m)) return "Cancelled.";
  return m;
};
