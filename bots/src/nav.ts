import type { Address, PublicClient } from "viem";
import { valueWallet } from "@btb/shared";
import type { Db } from "@btb/shared/db";

/** Values each wallet at the latest block and stores an hourly snapshot (also used for real-mode players). */
export async function snapshotWallets(client: PublicClient, db: Db, wallets: Address[], takenAt = new Date()) {
  const out = [];
  for (const w of wallets) {
    const v = await valueWallet(client, w);
    await db.query(
      `insert into nav_snapshots (wallet, taken_at, block, nav_usd, usdc_raw, holdings)
       values ($1, $2, $3, $4, $5, $6::jsonb) on conflict (wallet, taken_at) do nothing`,
      [w.toLowerCase(), takenAt.toISOString(), v.block.toString(), v.navUsd, v.usdcRaw.toString(), JSON.stringify(v.holdings.filter((h) => h.raw !== "0"))],
    );
    out.push(v);
  }
  return out;
}

/** Top of the hour, so every wallet in a run shares one timestamp. */
export const hourStamp = (d = new Date()) => new Date(Math.floor(d.getTime() / 3_600_000) * 3_600_000);
