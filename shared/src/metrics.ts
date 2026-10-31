import type { Db } from "./db";

export type Metrics = {
  generatedAt: string;
  users: { allTime: number; verified: number; dau: number; wau: number };
  swaps: { userCount: number; userVolumeUsdc: number; userVolumeUsdc30d: number; botCount: number; botVolumeUsdc: number; attributedShare: number };
  paper: { entriesAllTime: number; byWeek: { week: number; entries: number }[] };
  prizes: { weeksSettled: number; settleTxs: number };
  agents: { registered: number; house: number };
};

/** Grant-form metrics from the indexed data. "Users" are wallets with at least one app transaction (a swap or a lock). */
export async function weeklyMetrics(db: Db): Promise<Metrics> {
  const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params))[0]!;
  const users = await one<{ all_time: string; dau: string; wau: string }>(`
    with acts as (
      select wallet, ts from trades where kind = 'user' and status = 'confirmed'
      union all select wallet, to_timestamp(locked_at) as ts from paper_locks
    )
    select count(distinct wallet) as all_time,
           count(distinct wallet) filter (where ts > now() - interval '1 day') as dau,
           count(distinct wallet) filter (where ts > now() - interval '7 days') as wau
    from acts`);
  const verified = await one<{ n: string }>("select count(*) as n from players where telegram_id is not null");
  const sw = await one<{ uc: string; uv: string; uv30: string; bc: string; bv: string; attr: string; total: string }>(`
    select count(*) filter (where kind = 'user') as uc,
           coalesce(sum(usdc_raw::numeric) filter (where kind = 'user'), 0) as uv,
           coalesce(sum(usdc_raw::numeric) filter (where kind = 'user' and ts > now() - interval '30 days'), 0) as uv30,
           count(*) filter (where kind = 'bot') as bc,
           coalesce(sum(usdc_raw::numeric) filter (where kind = 'bot'), 0) as bv,
           count(*) filter (where builder_code) as attr,
           count(*) as total
    from trades where status = 'confirmed'`);
  const paperAll = await one<{ n: string }>("select count(*) as n from paper_locks");
  const byWeek = await db.query<{ week: number; n: string }>("select week, count(*) as n from paper_locks group by week order by week");
  const prizes = await one<{ weeks: string; txs: string }>("select count(*) filter (where settle_txs is not null) as weeks, coalesce(sum(jsonb_array_length(settle_txs)), 0) as txs from weeks");
  const agents = await one<{ n: string; house: string }>("select count(*) as n, count(*) filter (where house) as house from agents");
  return {
    generatedAt: new Date().toISOString(),
    users: { allTime: Number(users.all_time), verified: Number(verified.n), dau: Number(users.dau), wau: Number(users.wau) },
    swaps: {
      userCount: Number(sw.uc),
      userVolumeUsdc: Number(sw.uv) / 1e6,
      userVolumeUsdc30d: Number(sw.uv30) / 1e6,
      botCount: Number(sw.bc),
      botVolumeUsdc: Number(sw.bv) / 1e6,
      attributedShare: Number(sw.total) ? Number(sw.attr) / Number(sw.total) : 0,
    },
    paper: { entriesAllTime: Number(paperAll.n), byWeek: byWeek.map((r) => ({ week: r.week, entries: Number(r.n) })) },
    prizes: { weeksSettled: Number(prizes.weeks), settleTxs: Number(prizes.txs) },
    agents: { registered: Number(agents.n), house: Number(agents.house) },
  };
}
