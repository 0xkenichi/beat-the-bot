/**
 * Tiny Postgres layer shared by the web app, the jobs and the Telegram bot.
 * DATABASE_URL=postgres://... in production; "pglite:" (in memory) or "pglite:./data/local" for local runs.
 */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

let shared: Promise<Db> | undefined;

export function getDb(url = process.env.DATABASE_URL): Promise<Db> {
  shared ??= openDb(url);
  return shared;
}

export async function openDb(url = process.env.DATABASE_URL): Promise<Db> {
  if (!url || url.startsWith("pglite:")) {
    const { PGlite } = await import("@electric-sql/pglite");
    const dir = url?.slice("pglite:".length) || undefined;
    const pg = new PGlite(dir);
    const db: Db = {
      query: async (sql, params = []) => (await pg.query(sql, params as unknown[])).rows as never,
      close: () => pg.close(),
    };
    await migrate(db);
    return db;
  }
  const postgres = (await import("postgres")).default;
  const sql = postgres(url, { max: 4, prepare: false, idle_timeout: 20, connect_timeout: 15 });
  return {
    query: async (q, params = []) => (await sql.unsafe(q, params as never[])) as never,
    close: () => sql.end({ timeout: 5 }),
  };
}

export const SCHEMA = `
create table if not exists agents (
  id text primary key,
  name text not null,
  strategy text not null,
  wallet text not null unique,
  house boolean not null default true,
  erc8004_id text,
  roster_id integer,
  started_at timestamptz,
  start_nav double precision,
  paused boolean not null default false,
  paused_reason text
);
create table if not exists players (
  wallet text primary key,
  universal text,
  created_at timestamptz not null default now(),
  non_us_confirmed_at timestamptz,
  terms_version text,
  telegram_id bigint unique,
  telegram_username text,
  display_name text,
  dm_opt_in boolean not null default true,
  lang text not null default 'en'
);
create table if not exists link_codes (
  code text primary key,
  wallet text not null,
  created_at timestamptz not null default now(),
  used_at timestamptz
);
create table if not exists nav_snapshots (
  wallet text not null,
  taken_at timestamptz not null,
  block bigint not null,
  nav_usd double precision not null,
  usdc_raw text not null,
  holdings jsonb not null,
  primary key (wallet, taken_at)
);
create table if not exists trades (
  tx_hash text not null,
  wallet text not null,
  kind text not null,
  side text not null,
  token text not null,
  amount_in text not null,
  amount_out text not null,
  usdc_raw text not null,
  block bigint,
  ts timestamptz not null default now(),
  builder_code boolean not null default false,
  status text not null default 'pending',
  primary key (tx_hash, token)
);
create index if not exists trades_wallet_ts on trades (wallet, ts desc);
create table if not exists flows (
  tx_hash text not null,
  log_index integer not null,
  wallet text not null,
  token text not null,
  amount_raw text not null,
  usd double precision not null,
  ts timestamptz not null,
  block bigint not null,
  primary key (tx_hash, log_index)
);
create table if not exists paper_locks (
  week integer not null,
  wallet text not null,
  picks jsonb not null,
  picks_hash text not null,
  locked_at bigint not null,
  tx_hash text not null,
  block bigint not null,
  primary key (week, wallet)
);
create table if not exists weeks (
  week integer primary key,
  entry_open bigint not null,
  entry_close bigint not null,
  score_at bigint not null,
  universe jsonb not null,
  open_prices jsonb,
  close_prices jsonb,
  results jsonb,
  results_hash text,
  prize_token text,
  real_pot_raw text,
  paper_pot_raw text,
  fund_txs jsonb,
  settle_txs jsonb,
  status text not null default 'scheduled'
);
create table if not exists kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
`;

export async function migrate(db: Db) {
  for (const stmt of SCHEMA.split(";").map((s) => s.trim()).filter(Boolean)) await db.query(stmt);
}

export async function kvGet<T>(db: Db, key: string, fallback: T): Promise<T> {
  const rows = await db.query<{ value: T }>("select value from kv where key = $1", [key]);
  return rows[0]?.value ?? fallback;
}

export async function kvSet(db: Db, key: string, value: unknown) {
  await db.query(
    "insert into kv (key, value, updated_at) values ($1, $2::jsonb, now()) on conflict (key) do update set value = excluded.value, updated_at = now()",
    [key, JSON.stringify(value)],
  );
}
