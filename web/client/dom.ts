export const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
export const $$ = <T extends HTMLElement = HTMLElement>(sel: string) => Array.from(document.querySelectorAll(sel)) as T[];

export function h(tag: string, attrs: Record<string, string | boolean | ((e: Event) => void)> = {}, ...kids: (Node | string | null | false)[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === "function") el.addEventListener(k.replace(/^on/, ""), v as EventListener);
    else if (v === true) el.setAttribute(k, "");
    else if (v !== false) el.setAttribute(k, v);
  }
  for (const k of kids) if (k) el.append(k);
  return el;
}

export function data<T>(id: string): T {
  return JSON.parse(document.getElementById(id)!.textContent!) as T;
}

export function message(kind: "ok" | "err", text: string, tx?: string, explorer = "https://basescan.org") {
  const box = $("#msg")!;
  box.className = kind;
  box.style.margin = "12px 0";
  box.replaceChildren(text, tx ? h("a", { class: "proof", href: `${explorer}/tx/${tx}`, target: "_blank", rel: "noopener noreferrer" }, "Basescan") : "");
  box.scrollIntoView({ block: "nearest", behavior: "smooth" });
}
export const clearMessage = () => { const b = $("#msg")!; b.className = ""; b.replaceChildren(); };
