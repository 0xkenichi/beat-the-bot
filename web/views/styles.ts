// Site stylesheet, inlined into every page (about 2 KB gzipped). Edit the readable source below.
const SOURCE = `
:root{--bg:#f7f7f2;--card:#ffffff;--ink:#15161a;--muted:#5d6170;--line:#e3e3dc;--brand:#0b5cff;--brand-ink:#ffffff;--up:#0a7d3c;--down:#c2261b;--badge:#ffd23f;--badge-ink:#3a2c00;--radius:14px;--gap:16px;color-scheme:light dark;}
@media (prefers-color-scheme:dark){:root{--bg:#0f1013;--card:#17181d;--ink:#f1f1ee;--muted:#a3a6b3;--line:#2a2c33;--brand:#4d8bff;--up:#3ccf7a;--down:#ff6b5e;--badge:#ffd23f;--badge-ink:#2a2000;}
}
*{box-sizing:border-box;}
html,body{margin:0;padding:0;}
body{background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-text-size-adjust:100%;}
a{color:var(--brand);text-decoration:none;}
a:hover{text-decoration:underline;}
main{max-width:720px;margin:0 auto;padding:12px 16px 48px;}
h1{font-size:1.6rem;line-height:1.2;margin:8px 0 12px;}
h2{font-size:1.15rem;margin:24px 0 8px;}
h3{font-size:1rem;margin:16px 0 6px;}
p{margin:8px 0;}
.muted{color:var(--muted);}
.small{font-size:0.875rem;}
.up{color:var(--up);}
.down{color:var(--down);}
header.top{position:sticky;top:0;z-index:10;background:color-mix(in srgb,var(--bg) 92%,transparent);backdrop-filter:blur(6px);border-bottom:1px solid var(--line);}
header.top .bar{max-width:720px;margin:0 auto;padding:10px 16px;display:flex;align-items:center;gap:12px;}
header.top .logo{font-weight:800;color:var(--ink);letter-spacing:-0.02em;white-space:nowrap;}
header.top nav{display:flex;gap:14px;overflow-x:auto;scrollbar-width:none;flex:1;}
header.top nav a{color:var(--muted);white-space:nowrap;font-size:0.95rem;}
header.top nav a[aria-current="page"]{color:var(--ink);font-weight:600;}
.lang{font-size:0.8rem;color:var(--muted);white-space:nowrap;}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:16px;margin:12px 0;}
.row{display:flex;align-items:center;gap:10px;}
.between{justify-content:space-between;}
.wrap{flex-wrap:wrap;}
.grow{flex:1;min-width:0;}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:0 18px;border-radius:12px;border:1px solid transparent;background:var(--brand);color:var(--brand-ink);font-weight:650;font-size:1rem;cursor:pointer;text-decoration:none !important;}
.btn.secondary{background:transparent;color:var(--ink);border-color:var(--line);}
.btn.block{width:100%;}
.btn[disabled]{opacity:0.5;cursor:not-allowed;}
.chips{display:flex;gap:8px;flex-wrap:wrap;}
.chip{min-height:40px;padding:0 14px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--ink);font-weight:600;cursor:pointer;}
.chip[aria-pressed="true"]{background:var(--ink);color:var(--bg);border-color:var(--ink);}
table{width:100%;border-collapse:collapse;}
th,td{text-align:left;padding:8px 4px;border-bottom:1px solid var(--line);vertical-align:middle;}
th{font-size:0.8rem;font-weight:600;color:var(--muted);}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}
.rank{width:2ch;color:var(--muted);font-variant-numeric:tabular-nums;}
.badge{display:inline-block;background:var(--badge);color:var(--badge-ink);font-size:0.72rem;font-weight:800;padding:2px 8px;border-radius:999px;text-transform:uppercase;letter-spacing:0.03em;vertical-align:middle;}
.tag{display:inline-block;font-size:0.72rem;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:1px 8px;}
.proof{font-size:0.75rem;color:var(--muted);white-space:nowrap;margin-left:4px;}
.proof::after{content:" ↗";}
.empty{color:var(--muted);padding:12px 0;}
.notice{background:color-mix(in srgb,var(--badge) 22%,var(--card));border:1px solid color-mix(in srgb,var(--badge) 60%,var(--line));border-radius:var(--radius);padding:12px 14px;}
.ok{background:color-mix(in srgb,var(--up) 14%,var(--card));border:1px solid color-mix(in srgb,var(--up) 40%,var(--line));border-radius:var(--radius);padding:12px 14px;}
.err{background:color-mix(in srgb,var(--down) 12%,var(--card));border:1px solid color-mix(in srgb,var(--down) 40%,var(--line));border-radius:var(--radius);padding:12px 14px;}
.stock{display:grid;grid-template-columns:1fr auto;gap:2px 12px;padding:12px 0;border-bottom:1px solid var(--line);}
.stock:last-child{border-bottom:0;}
.ticker{font-weight:750;}
.addr{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:0.85rem;word-break:break-all;}
input[type="number"],input[type="text"]{width:100%;min-height:48px;padding:0 12px;border-radius:12px;border:1px solid var(--line);background:var(--card);color:var(--ink);font-size:1.05rem;}
.stat{font-size:1.6rem;font-weight:800;font-variant-numeric:tabular-nums;}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
footer.foot{max-width:720px;margin:0 auto;padding:24px 16px 40px;color:var(--muted);font-size:0.82rem;border-top:1px solid var(--line);}
footer.foot a{color:var(--muted);text-decoration:underline;}
ol.steps{padding-left:1.2em;}
ol.steps li{margin:10px 0;}
.qr svg{width:180px;height:180px;background:#fff;padding:8px;border-radius:12px;}
.spark{width:100%;height:80px;display:block;}

@media (max-width: 520px) {
header.top .bar { flex-wrap: wrap; row-gap: 6px; }
header.top nav { order: 3; flex-basis: 100%; gap: 16px; }
}
button.stock { width: 100%; background: transparent; border: 0; border-bottom: 1px solid var(--line); color: inherit; text-align: left; font: inherit; cursor: pointer; padding: 12px 4px; display: grid; grid-template-columns: 1fr auto; align-items: center; border-radius: 0; }
button.stock:last-child { border-bottom: 0; }
button.stock[aria-pressed="true"] { background: color-mix(in srgb, var(--brand) 12%, var(--card)); box-shadow: inset 3px 0 0 var(--brand); }
button.stock[aria-pressed="true"] .num::after { content: " ✓"; color: var(--brand); }
button.stock .num { font-variant-numeric: tabular-nums; }
.chip:disabled { opacity: .5; }
#msg:empty { display: none; }
[hidden] { display: none !important; }
`;

export const CSS = SOURCE.replace(/\s*\n\s*/g, "").replace(/\s*([{};:,>])\s*/g, "$1");
