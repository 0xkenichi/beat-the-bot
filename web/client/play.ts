import { $, $$, h, data, message, clearMessage } from "./dom";
import { configure, preload, preloadWhenIdle, prefetchNonce, sendCalls, signIn, friendlyError, type Call } from "./wallet";

type D = { week: number; session: { wallet: string } | null; confirmed: boolean; existing: { tokenIndex: number; weightBps: number }[] | null; suffix: string | null; chainHex: string; explorer: string; copy: Record<string, string> };
const d = data<D>("play-data");
const c = d.copy;
let session = d.session;
let confirmed = d.confirmed;
let picks: number[] = d.existing?.map((p) => p.tokenIndex) ?? [];
let weights: Record<number, number> = Object.fromEntries((d.existing ?? []).map((p) => [p.tokenIndex, p.weightBps / 100]));

configure(d.suffix);
prefetchNonce();
preloadWhenIdle();

function render() {
  for (const row of $$("[data-idx]")) {
    const i = Number(row.dataset.idx);
    const ctl = row.querySelector(".ctl")!;
    if (picks.includes(i)) {
      ctl.replaceChildren(
        h("span", { class: "row", style: "gap:6px" },
          h("button", { class: "chip", "aria-label": "less", onclick: () => bump(i, -5) }, "−"),
          h("b", { class: "num", style: "min-width:3.5ch;text-align:center" }, `${weights[i] ?? 0}%`),
          h("button", { class: "chip", "aria-label": "more", onclick: () => bump(i, 5) }, "+")),
      );
    } else ctl.replaceChildren(h("button", { class: "chip", onclick: () => toggle(i) }, "Pick"));
  }
  const total = picks.reduce((a, i) => a + (weights[i] ?? 0), 0);
  $("#count")!.textContent = `${picks.length}/3`;
  const tl = $("#total")!;
  tl.textContent = `Total ${total}%`;
  tl.className = `small ${total === 100 || picks.length < 3 ? "muted" : "down"}`;
  $("#confirm")!.hidden = !session || confirmed;
}
function toggle(i: number) {
  clearMessage();
  picks = picks.includes(i) ? picks.filter((x) => x !== i) : picks.length >= 3 ? [...picks.slice(1), i] : [...picks, i];
  const even = picks.length ? Math.floor(100 / picks.length) : 0;
  weights = Object.fromEntries(picks.map((x, k) => [x, even + (k === 0 ? 100 - even * picks.length : 0)]));
  render();
}
function bump(i: number, delta: number) {
  weights[i] = Math.max(5, Math.min(90, (weights[i] ?? 0) + delta));
  render();
}
for (const b of $$(".pick-name")) b.addEventListener("click", () => toggle(Number(b.closest<HTMLElement>("[data-idx]")!.dataset.idx)));

$("#confirm-btn")!.addEventListener("click", async () => {
  const r = await fetch("/api/players/confirm", { method: "POST" });
  if (r.ok) { confirmed = true; clearMessage(); }
  render();
});

const lockBtn = $<HTMLButtonElement>("#lock-btn")!;
lockBtn.addEventListener("pointerdown", () => void preload());
lockBtn.addEventListener("click", async () => {
  clearMessage();
  if (picks.length !== 3) return message("err", c.pick_three!);
  if (picks.reduce((a, i) => a + (weights[i] ?? 0), 0) !== 100) return message("err", c.weights_must_sum!);
  const label = lockBtn.textContent;
  lockBtn.disabled = true;
  lockBtn.textContent = c.working!;
  try {
    if (!session) {
      const r = await signIn();
      session = { wallet: r.wallet };
      confirmed = r.confirmed;
    }
    if (!confirmed) { render(); throw new Error(c.non_us_text); }
    const p = picks.map((i) => `${i}:${(weights[i] ?? 0) * 100}`).join(",");
    const r = await fetch(`/api/play/calls?week=${d.week}&p=${p}`, { cache: "no-store" });
    const j = (await r.json()) as { calls?: Call[]; error?: string };
    if (!r.ok || !j.calls) throw new Error(j.error ?? "Could not prepare your lock");
    const { txHash } = await sendCalls(session.wallet, j.calls, { chainHex: d.chainHex });
    await fetch("/api/play/locked", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ txHash }) });
    message("ok", c.locked!, txHash, d.explorer);
  } catch (err) {
    message("err", friendlyError(err));
  } finally {
    lockBtn.disabled = false;
    lockBtn.textContent = session ? c.lock_picks! : label;
    render();
  }
});
render();
