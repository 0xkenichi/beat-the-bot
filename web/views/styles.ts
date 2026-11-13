// Site stylesheet, inlined into every page (about 3 KB gzipped). Edit the readable source below.
const SOURCE = `
:root{--bg:#f4f4f5;--card:#ffffff;--soft:#efeff1;--ink:#0d0d10;--muted:#6b6b76;--line:#e6e6ea;--brand:#2f6bff;--brand-ink:#ffffff;--up:#119c4b;--down:#e0404a;--badge:#ffd23f;--badge-ink:#3a2c00;--radius:20px;--shadow:0 1px 2px rgba(16,16,24,.04),0 8px 28px rgba(16,16,24,.06);--t-momentum:#ff6a2b;--t-contrarian:#7a5cff;--t-steady:#22b863;--t-agent:#2f6bff;color-scheme:light dark;}
@media (prefers-color-scheme:dark){:root{--bg:#0b0b0d;--card:#151518;--soft:#1f1f23;--ink:#f4f4f5;--muted:#9b9ba6;--line:#26262c;--brand:#5b8cff;--up:#3ccf7a;--down:#ff6b6b;--shadow:0 1px 2px rgba(0,0,0,.3),0 8px 28px rgba(0,0,0,.35);}}
*{box-sizing:border-box;}
html,body{margin:0;padding:0;}
body{background:var(--bg);color:var(--ink);font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;-webkit-text-size-adjust:100%;-webkit-font-smoothing:antialiased;}
a{color:var(--brand);text-decoration:none;}
a:hover{text-decoration:underline;}
main{max-width:760px;margin:0 auto;padding:8px 16px 48px;}
h1{font-size:2.1rem;line-height:1.05;letter-spacing:-0.035em;font-weight:800;margin:20px 0 12px;}
h2{font-size:1.2rem;letter-spacing:-0.02em;font-weight:750;margin:24px 0 8px;}
h3{font-size:1rem;margin:16px 0 6px;}
p{margin:8px 0;}
.muted{color:var(--muted);}
.small{font-size:0.875rem;}
.up{color:var(--up);}
.down{color:var(--down);}
header.top{position:sticky;top:0;z-index:10;padding:10px 12px 0;}
header.top .bar{max-width:760px;margin:0 auto;padding:6px 6px 6px 8px;display:flex;align-items:center;gap:12px;background:color-mix(in srgb,var(--card) 86%,transparent);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid var(--line);border-radius:999px;box-shadow:var(--shadow);}
.logo{display:flex;align-items:center;gap:8px;font-weight:800;color:var(--ink);letter-spacing:-0.02em;white-space:nowrap;text-decoration:none !important;}
.logo .mark{width:32px;height:32px;border-radius:50%;background:var(--ink);color:var(--card);display:grid;place-items:center;font-size:16px;font-weight:800;}
header.top nav{display:flex;gap:4px;overflow-x:auto;scrollbar-width:none;flex:1;}
header.top nav::-webkit-scrollbar{display:none;}
header.top nav a{color:var(--muted);white-space:nowrap;font-size:0.92rem;font-weight:550;padding:6px 10px;border-radius:999px;text-decoration:none !important;}
header.top nav a[aria-current="page"]{color:var(--ink);background:var(--soft);}
.lang{font-size:0.8rem;color:var(--muted);white-space:nowrap;}
.cta{background:var(--ink);color:var(--card) !important;border-radius:999px;padding:8px 14px;font-weight:650;font-size:0.9rem;white-space:nowrap;text-decoration:none !important;}
.hero{text-align:center;padding:36px 0 12px;}
.hero h1{font-size:clamp(2.4rem,9vw,4rem);margin:16px auto 14px;max-width:12ch;}
.hero h1 em{font-style:normal;color:var(--brand);}
.hero .lede{color:var(--muted);font-size:1.1rem;max-width:32ch;margin:0 auto;}
.hero .actions{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin:22px 0 6px;}
.pill-badge{display:inline-flex;align-items:center;gap:8px;background:var(--card);border:1px solid var(--line);border-radius:999px;padding:4px 12px 4px 4px;font-size:0.85rem;font-weight:550;box-shadow:var(--shadow);}
.pill-badge b{background:var(--brand);color:var(--brand-ink);border-radius:999px;padding:2px 10px;font-size:0.78rem;font-weight:700;}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:18px;margin:14px 0;box-shadow:var(--shadow);}
.card h2{margin-top:0;}
.row{display:flex;align-items:center;gap:10px;}
.between{justify-content:space-between;}
.wrap{flex-wrap:wrap;}
.grow{flex:1;min-width:0;}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:0 22px;border-radius:999px;border:1px solid transparent;background:var(--ink);color:var(--card);font-weight:650;font-size:1rem;cursor:pointer;text-decoration:none !important;}
.btn.brand{background:var(--brand);color:var(--brand-ink);}
.btn.secondary{background:var(--soft);color:var(--ink);border-color:var(--line);}
.btn.block{width:100%;}
.btn[disabled]{opacity:0.5;cursor:not-allowed;}
.chips{display:flex;gap:8px;flex-wrap:wrap;}
.chip{min-height:40px;padding:0 14px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--ink);font-weight:600;cursor:pointer;}
.chip[aria-pressed="true"]{background:var(--ink);color:var(--card);border-color:var(--ink);}
.features{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:18px 0;}
.feature{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:18px;box-shadow:var(--shadow);}
.feature h3{margin:14px 0 4px;font-size:1.05rem;letter-spacing:-0.01em;}
.feature p{color:var(--muted);margin:0 0 12px;font-size:0.95rem;line-height:1.45;}
.tile{display:inline-grid;place-items:center;width:30px;height:30px;border-radius:9px;color:#fff;font-weight:800;font-size:15px;flex:none;background:var(--t-agent);box-shadow:inset 0 -2px 0 rgba(0,0,0,.12);}
.feature .tile{width:40px;height:40px;border-radius:12px;font-size:19px;}
.t-momentum{background:var(--t-momentum);}
.t-contrarian{background:var(--t-contrarian);}
.t-steady{background:var(--t-steady);}
.status{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;}
.status .label{font-size:0.8rem;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:0.06em;}
table{width:100%;border-collapse:collapse;}
th,td{text-align:left;padding:12px 4px;border-bottom:1px solid var(--line);vertical-align:middle;}
tr:last-child td{border-bottom:0;}
th{font-size:0.75rem;font-weight:650;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;padding-top:4px;}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}
td.num{font-weight:650;}
.rank{width:2ch;color:var(--muted);font-variant-numeric:tabular-nums;}
.who{display:flex;align-items:center;gap:6px 10px;flex-wrap:wrap;}
.who a,.who span.name{font-weight:700;color:var(--ink);}
.picks{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;align-items:center;}
.badge{display:inline-block;white-space:nowrap;background:var(--badge);color:var(--badge-ink);font-size:0.7rem;font-weight:800;padding:2px 8px;border-radius:999px;text-transform:uppercase;letter-spacing:0.03em;vertical-align:middle;}
.tag{display:inline-block;font-size:0.75rem;font-weight:600;color:var(--ink);background:var(--soft);border-radius:999px;padding:2px 9px;white-space:nowrap;}
.proof{font-size:0.75rem;color:var(--muted);white-space:nowrap;margin-left:4px;font-weight:500;}
.proof::after{content:" ↗";}
@media (max-width:480px){td.num .proof{display:block;margin-left:0;}}
.empty{color:var(--muted);padding:12px 0;}
.notice{background:color-mix(in srgb,var(--badge) 20%,var(--card));border:1px solid color-mix(in srgb,var(--badge) 55%,var(--line));border-radius:16px;padding:12px 14px;}
.ok{background:color-mix(in srgb,var(--up) 12%,var(--card));border:1px solid color-mix(in srgb,var(--up) 40%,var(--line));border-radius:16px;padding:12px 14px;}
.err{background:color-mix(in srgb,var(--down) 10%,var(--card));border:1px solid color-mix(in srgb,var(--down) 40%,var(--line));border-radius:16px;padding:12px 14px;}
.stock{display:grid;grid-template-columns:1fr auto;gap:2px 12px;padding:12px 0;border-bottom:1px solid var(--line);}
.stock:last-child{border-bottom:0;}
.ticker{font-weight:750;}
.addr{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:0.85rem;word-break:break-all;}
input[type="number"],input[type="text"]{width:100%;min-height:48px;padding:0 14px;border-radius:14px;border:1px solid var(--line);background:var(--card);color:var(--ink);font-size:1.05rem;}
.stat{font-size:1.7rem;font-weight:800;letter-spacing:-0.02em;font-variant-numeric:tabular-nums;}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
footer.foot{max-width:760px;margin:0 auto;padding:28px 16px 44px;color:var(--muted);font-size:0.82rem;text-align:center;}
footer.foot a{color:var(--muted);text-decoration:underline;}
ol.steps{padding-left:1.2em;}
ol.steps li{margin:10px 0;}
.qr svg{width:180px;height:180px;background:#fff;padding:8px;border-radius:14px;}
.spark{width:100%;height:80px;display:block;}
@media (max-width:620px){
header.top .bar{flex-wrap:wrap;border-radius:24px;row-gap:4px;padding:6px 6px 6px 8px;}
header.top nav{order:3;flex-basis:100%;}
.logo{flex:1;}
.features{grid-template-columns:1fr;}
.feature{display:grid;grid-template-columns:auto 1fr;gap:2px 14px;align-items:start;}
.feature .tile{grid-row:span 3;}
.feature h3{margin:2px 0 4px;}
.feature .tag{justify-self:start;}
h1{font-size:1.9rem;}
}
button.stock{width:100%;background:transparent;border:0;border-bottom:1px solid var(--line);color:inherit;text-align:left;font:inherit;cursor:pointer;padding:12px 4px;display:grid;grid-template-columns:1fr auto;align-items:center;border-radius:0;}
button.stock:last-child{border-bottom:0;}
button.stock[aria-pressed="true"]{background:color-mix(in srgb,var(--brand) 10%,var(--card));box-shadow:inset 3px 0 0 var(--brand);border-radius:12px;}
button.stock[aria-pressed="true"] .num::after{content:" ✓";color:var(--brand);}
button.stock .num{font-variant-numeric:tabular-nums;}
.chip:disabled{opacity:.5;}
#msg:empty{display:none;}
[hidden]{display:none !important;}
`;

export const CSS = SOURCE.replace(/\s*\n\s*/g, "").replace(/\s*([{};:,>])\s*/g, "$1");
