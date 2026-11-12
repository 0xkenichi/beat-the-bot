// A silent, captioned preview video (1920x1080, about 50 seconds) built from the screenshots in docs/launch/screens: each slide
// in slides.html is rendered with headless Chrome, then joined with short crossfades by ffmpeg.
//
//   npx tsx scripts/capture/screens.ts
//   FFMPEG=/path/to/ffmpeg npx tsx scripts/capture/video.ts      -> data/local/beat-the-bot-preview.mp4 (VIDEO_OUT)
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "../..");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const OUT = resolve(ROOT, process.env.VIDEO_OUT ?? "data/local/beat-the-bot-preview.mp4");
const SLIDES = resolve(import.meta.dirname, "slides.html");
// Seconds on screen per slide: the title, six captioned screens, the end card.
const DURATIONS = [3.5, 8, 8, 8, 8, 8, 8, 4.5];
const FADE = 0.6;

const work = mkdtempSync(join(tmpdir(), "btb-slides-"));
try {
  const frames: string[] = [];
  for (let i = 0; i < DURATIONS.length; i++) {
    const file = join(work, `slide-${i}.png`);
    const r = spawnSync(CHROME, [
      "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--allow-file-access-from-files", `--user-data-dir=${join(work, "profile")}`,
      "--window-size=1920,1080", "--force-device-scale-factor=1", "--timeout=4000", `--screenshot=${file}`, `${pathToFileURL(SLIDES).href}?s=${i}`,
    ], { encoding: "utf8", timeout: 60_000 });
    if (!existsSync(file)) throw new Error(`slide ${i} did not render: ${r.stderr}`);
    frames.push(file);
    console.log(`  slide ${i + 1}/${DURATIONS.length}`);
  }

  const inputs = frames.flatMap((f, i) => ["-loop", "1", "-t", String(DURATIONS[i]), "-i", f]);
  const steps: string[] = [];
  let prev = "[0:v]", offset = 0;
  for (let i = 1; i < frames.length; i++) {
    offset += DURATIONS[i - 1]! - FADE;
    const out = i === frames.length - 1 ? "[v]" : `[x${i}]`;
    steps.push(`${prev}[${i}:v]xfade=transition=fade:duration=${FADE}:offset=${offset.toFixed(2)}${out}`);
    prev = out;
  }
  mkdirSync(resolve(OUT, ".."), { recursive: true });
  const r = spawnSync(FFMPEG, [
    "-y", "-hide_banner", "-loglevel", "error", ...inputs,
    "-filter_complex", `${steps.join(";")};[v]format=yuv420p,fps=30[out]`, "-map", "[out]",
    "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-movflags", "+faststart", OUT,
  ], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr || r.error}`);
  const total = DURATIONS.reduce((a, b) => a + b, 0) - FADE * (DURATIONS.length - 1);
  console.log(`Saved ${OUT} (${total.toFixed(1)} s)`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
