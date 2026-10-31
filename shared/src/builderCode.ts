import { Attribution } from "ox/erc8021";
import type { Hex } from "viem";

/**
 * ERC-8021 data suffix for a Base Builder Code (schema 0): codes | length | 0x00 | 0x8021 x8.
 * Every transaction the app, the bots or the scoring job sends carries this suffix so base.dev counts it.
 */
export function builderCodeSuffix(code: string): Hex {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(code)) throw new Error(`Invalid Builder Code: ${JSON.stringify(code)}`);
  return Attribution.toDataSuffix({ codes: [code] }) as Hex;
}

/** True when `data` ends with an ERC-8021 suffix that names `code`. */
export function hasBuilderCode(data: Hex | undefined, code: string): boolean {
  if (!data) return false;
  try {
    const a = Attribution.fromData(data as `0x${string}`);
    return !!a && (a.codes ?? []).includes(code);
  } catch {
    return false;
  }
}

/** Reads the Builder Code from env and fails loudly if it is missing, so nothing is ever sent unattributed. */
export function requireBuilderCode(env: Record<string, string | undefined> = process.env): string {
  const code = env.BUILDER_CODE ?? env.NEXT_PUBLIC_BUILDER_CODE;
  if (!code) throw new Error("BUILDER_CODE is not set. Register the app on base.dev and put its Builder Code in .env.");
  builderCodeSuffix(code); // validates
  return code;
}
