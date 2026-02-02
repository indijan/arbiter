alter table public.positions
  add column if not exists exit_ts timestamptz,
  add column if not exists exit_spot_price numeric,
  add column if not exists exit_perp_price numeric,
  add column if not exists realized_pnl_usd numeric;
