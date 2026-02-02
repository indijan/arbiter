alter table public.paper_accounts
  add column if not exists min_notional_usd numeric not null default 100,
  add column if not exists max_notional_usd numeric not null default 500;
