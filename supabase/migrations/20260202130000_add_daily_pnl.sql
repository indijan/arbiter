create table if not exists public.daily_strategy_pnl (
  id bigserial primary key,
  day date not null,
  strategy_key text not null,
  exchange_key text not null,
  pnl_usd numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (day, strategy_key, exchange_key)
);

alter table public.daily_strategy_pnl enable row level security;

create policy "daily_strategy_pnl_select_auth"
  on public.daily_strategy_pnl
  for select
  to authenticated
  using (true);
