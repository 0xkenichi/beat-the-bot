// Bundles the small page scripts (client/*.ts) into public/js. The wallet SDK is split into its own chunk and is
// only fetched when a page is about to sign someone in.
import { build } from "esbuild";
import { copyFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// The wallet SDK's own prebuilt browser bundle, copied from the pinned package (no CDN).
const require = createRequire(import.meta.url);
const sdkDir = dirname(dirname(require.resolve("@base-org/account/browser")));
const sdkVersion = JSON.parse(readFileSync(join(sdkDir, "package.json"), "utf8")).version;
rmSync("public/js", { recursive: true, force: true });
mkdirSync("public/js/vendor", { recursive: true });
copyFileSync(join(sdkDir, "dist/base-account.min.js"), "public/js/vendor/base-account.min.js");
console.log(`vendor: @base-org/account ${sdkVersion}`);

await build({
  entryPoints: ["client/trade.ts", "client/play.ts", "client/fund.ts"],
  outdir: "public/js",
  bundle: true,
  splitting: true,
  format: "esm",
  minify: true,
  target: ["es2020"],
  chunkNames: "chunks/[name]-[hash]",
  define: { "process.env.NODE_ENV": '"production"', global: "globalThis" },
  conditions: ["browser", "import"],
  mainFields: ["browser", "module", "main"],
  legalComments: "none",
  metafile: true,
  logLevel: "warning",
}).then((r) => {
  const out = Object.entries(r.metafile.outputs).map(([f, o]) => `${(o.bytes / 1024).toFixed(1).padStart(7)} KB  ${f}`);
  console.log(out.join("\n"));
});
