/**
 * Minimal, escaping HTML templates. Pages are plain server-rendered HTML with small scripts, so a phone on slow
 * mobile data downloads kilobytes, not a framework.
 */
export class Raw {
  constructor(readonly s: string) {}
  toString() {
    return this.s;
  }
}
export const raw = (s: string) => new Raw(s);

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (v: unknown) => String(v).replace(/[&<>"']/g, (c) => ESC[c]!);

function render(v: unknown): string {
  if (v == null || v === false || v === true) return "";
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join("");
  return esc(v);
}

export function html(strings: TemplateStringsArray, ...vals: unknown[]): Raw {
  let out = strings[0]!;
  vals.forEach((v, i) => (out += render(v) + strings[i + 1]!));
  return new Raw(out);
}

/** JSON for a <script type="application/json"> block, safe against </script> injection. */
export const jsonData = (id: string, data: unknown) =>
  raw(`<script type="application/json" id="${esc(id)}">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`);
