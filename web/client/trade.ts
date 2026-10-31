import { $, $$, h, data, message, clearMessage } from "./dom";
import { configure, preload, preloadWhenIdle, prefetchNonce, sendCalls, signIn, friendlyError, type Call } from "./wallet";

type D = { mode: "live" | "view-only"; session: { wallet: string } | null; confirmed: boolean; linked: boolean; suffix: string | null; countsFrom: string; copy: Record<string, string> };
type Quote = { side: "buy" | "sell"; usd: number; lines: { ticker: string; symbol: string; youGet: string; minOut: string }[]; calls: Call[] };

const d = data<D>("trade-data");
const c = d.copy;
let session = d.session;
let confirmed = d.confirmed;
let picked: string[] = [];
let amount = 5;
let busy = false;

configure(d.suffix);
prefetchNonce();
preloadWhenIdle();

function sync() {
  $("#signin")!.hidden = !!session;
  $("#confirm")!.hidden = !session || confirmed;
  $("#portfolio")!.hidden = !session;
  $("#link")!.hidden = !session || !confirmed || d.linked;
  $("#order")!.hidden = picked.length === 0;
  const tickers = $$("[data-addr]").filter((b) => picked.includes(b.dataset.addr!)).map((b) => b.dataset.ticker);
  const buy = $<HTMLButtonElement>("#buy-btn")!;
  buy.textContent = busy ? "…" : `${c.buy} $${amount} of ${tickers.join(" + ")}`;
  buy.disabled = busy || d.mode !== "live" || !session || !confirmed;
  if (session) {
    $("#wallet-addr")!.textContent = session.wallet;
    $<HTMLAnchorElement>("#wallet-proof")!.href = `https://basescan.org/address/${session.wallet}`;
  }
}

$("#signin-btn")!.addEventListener("pointerdown", () => void preload());
$("#signin-btn")!.addEventListener("click", async (e) => {
  const btn = e.currentTarget as HTMLButtonElement;
  clearMessage();
  btn.disabled = true;
  btn.textContent = c.signing_in!;
  try {
    const r = await signIn();
    session = { wallet: r.wallet };
    confirmed = r.confirmed;
    void refresh();
  } catch (err) {
    message("err", friendlyError(err));
  } finally {
    btn.disabled = false;
    btn.textContent = c.sign_in!;
    sync();
  }
});

$("#confirm-btn")!.addEventListener("click", async () => {
  const r = await fetch("/api/players/confirm", { method: "POST" });
  if (r.ok) confirmed = true;
  else message("err", (await r.json()).error ?? "Could not save");
  sync();
});

for (const b of $$("[data-addr]")) {
  b.addEventListener("click", () => {
    const a = b.dataset.addr!;
    picked = picked.includes(a) ? picked.filter((x) => x !== a) : picked.length >= 3 ? [...picked.slice(1), a] : [...picked, a];
    for (const x of $$("[data-addr]")) x.setAttribute("aria-pressed", String(picked.includes(x.dataset.addr!)));
    $("#quote")!.replaceChildren();
    sync();
  });
}
for (const chip of $$(".amt")) {
  chip.addEventListener("click", () => {
    amount = Number(chip.dataset.amt);
    for (const x of $$(".amt")) x.setAttribute("aria-pressed", String(x === chip));
    $("#quote")!.replaceChildren();
    sync();
  });
}

async function getQuote(qs: string, target: HTMLElement) {
  clearMessage();
  busy = true;
  sync();
  try {
    const r = await fetch(`/api/quote?${qs}`, { cache: "no-store" });
    const q = (await r.json()) as Quote & { error?: string };
    if (!r.ok) throw new Error(q.error ?? "No quote");
    renderQuote(q, target);
  } catch (err) {
    message("err", friendlyError(err));
  } finally {
    busy = false;
    sync();
  }
}

function renderQuote(q: Quote, target: HTMLElement) {
  const go = h("button", { class: "btn grow" }, q.side === "buy" ? c.confirm_buy! : c.confirm_sell!) as HTMLButtonElement;
  const cancel = h("button", { class: "btn secondary", onclick: () => target.replaceChildren() }, "✕");
  go.addEventListener("click", async () => {
    if (!session) return;
    go.disabled = true;
    go.textContent = c.working!;
    try {
      const { id, txHash } = await sendCalls(session.wallet, q.calls);
      void fetch("/api/trades", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, txHash }) });
      message("ok", q.side === "buy" ? `${c.done_buy} ${d.countsFrom}` : c.done_sell!, txHash);
      target.replaceChildren();
      picked = [];
      for (const x of $$("[data-addr]")) x.setAttribute("aria-pressed", "false");
      void refresh();
    } catch (err) {
      message("err", friendlyError(err));
      go.disabled = false;
      go.textContent = q.side === "buy" ? c.confirm_buy! : c.confirm_sell!;
    }
    sync();
  });
  target.replaceChildren(
    h("div", { style: "margin-top:8px" },
      ...q.lines.map((l) => h("div", { class: "row between small", style: "padding:4px 0" },
        h("span", {}, q.side === "buy" ? `${c.you_get} ${l.youGet} ${l.symbol}` : `${c.you_get} $${l.youGet}`),
        h("span", { class: "muted" }, `min ${l.minOut}`))),
      h("div", { class: "row", style: "gap:8px;margin-top:8px" }, go, cancel)),
  );
}

$("#buy-btn")!.addEventListener("click", () => getQuote(`side=buy&amount=${amount}&tokens=${picked.join(",")}`, $("#quote")!));

async function refresh() {
  const box = $("#holdings")!;
  const r = await fetch("/api/portfolio", { cache: "no-store" });
  if (!r.ok) return;
  const pf = (await r.json()) as { usdc: number; holdings: { token: string; ticker: string; valueUsd: number }[] };
  box.replaceChildren(
    h("div", { class: "row between" }, h("span", {}, c.usdc_balance!), h("b", { class: "num" }, `$${pf.usdc.toFixed(2)}`)),
    ...(pf.holdings.length ? [] : [h("p", { class: "empty" }, c.empty_portfolio!)]),
    ...pf.holdings.map((x) =>
      h("div", { class: "row between", style: "padding:10px 0;border-top:1px solid var(--line)" },
        h("div", { class: "grow" }, h("b", {}, x.ticker), ` $${x.valueUsd.toFixed(2)} `,
          h("a", { class: "proof", href: `https://basescan.org/token/${x.token}?a=${session!.wallet}`, target: "_blank", rel: "noopener noreferrer" }, "Basescan")),
        h("button", { class: "chip", onclick: () => getQuote(`side=sell&token=${x.token}&fraction=0.5`, $("#sell-quote")!) }, c.sell_half!),
        h("button", { class: "chip", onclick: () => getQuote(`side=sell&token=${x.token}&fraction=1`, $("#sell-quote")!) }, c.sell_all!))),
  );
}

$("#link-btn")?.addEventListener("click", async () => {
  const r = await fetch("/api/link/code", { method: "POST" });
  if (!r.ok) return message("err", (await r.json()).error ?? "Could not create a code");
  const j = (await r.json()) as { url: string; code: string };
  $("#link-body")!.replaceChildren(h("a", { class: "btn block", href: j.url }, c.open_telegram!), h("p", { class: "small muted" }, `${c.link_code_text} /link ${j.code}`));
});

sync();
if (session) void refresh();
