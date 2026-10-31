import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Loads the repo-root .env into process.env when it exists (local runs). In CI and hosting, variables come from
 * the platform's secret store instead. The file is read by Node at runtime only; it is never committed.
 */
export function loadEnv() {
  for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../.env")]) {
    if (existsSync(p)) {
      process.loadEnvFile(p);
      return;
    }
  }
}

export function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}
