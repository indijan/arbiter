-- Enable required extensions
create extension if not exists "pgcrypto";

-- profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);

-- market_snapshots
create table if not exists public.market_snapshots (
  id bigserial primary key,
  ts timestamptz not null default now(),
  exchange text not null,
  symbol text not null,
  spot_bid numeric,
  spot_ask numeric,
  perp_bid numeric,
  perp_ask numeric,
  funding_rate numeric,
  mark_price numeric,
  index_price numeric
);

-- opportunities
create table if not exists public.opportunities (
  id bigserial primary key,
  ts timestamptz not null default now(),
  exchange text not null,
  symbol text not null,
  type text not null,
  net_edge_bps numeric,
  expected_daily_bps numeric,
  confidence numeric,
  status text not null default 'new',
  details jsonb not null default '{}'::jsonb
);

-- positions
create table if not exists public.positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  exchange_account_id uuid null,
  symbol text not null,
  mode text not null default 'paper',
  spot_qty numeric not null default 0,
  perp_qty numeric not null default 0,
  entry_ts timestamptz not null default now(),
  entry_spot_price numeric,
  entry_perp_price numeric,
  status text not null default 'open',
  meta jsonb not null default '{}'::jsonb
);

-- executions
create table if not exists public.executions (
  id bigserial primary key,
  position_id uuid not null references public.positions(id) on delete cascade,
  ts timestamptz not null default now(),
  leg text not null,
  requested_qty numeric not null default 0,
  filled_qty numeric not null default 0,
  avg_price numeric,
  fee numeric,
  raw jsonb not null default '{}'::jsonb
);

-- indexes
create index if not exists market_snapshots_ts_desc_idx
  on public.market_snapshots (ts desc);

create index if not exists market_snapshots_exchange_symbol_ts_desc_idx
  on public.market_snapshots (exchange, symbol, ts desc);

create index if not exists opportunities_ts_desc_idx
  on public.opportunities (ts desc);

create index if not exists opportunities_exchange_symbol_ts_desc_idx
  on public.opportunities (exchange, symbol, ts desc);

create index if not exists positions_user_entry_ts_desc_idx
  on public.positions (user_id, entry_ts desc);

create index if not exists executions_position_ts_desc_idx
  on public.executions (position_id, ts desc);

-- RLS
alter table public.profiles enable row level security;
alter table public.positions enable row level security;
alter table public.executions enable row level security;
alter table public.market_snapshots enable row level security;
alter table public.opportunities enable row level security;

-- profiles policies
create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid());

create policy "profiles_insert_own"
  on public.profiles
  for insert
  to authenticated
  with check (id = auth.uid());

create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- positions policies
create policy "positions_select_own"
  on public.positions
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "positions_insert_own"
  on public.positions
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "positions_update_own"
  on public.positions
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "positions_delete_own"
  on public.positions
  for delete
  to authenticated
  using (user_id = auth.uid());

-- executions policies
create policy "executions_select_own"
  on public.executions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.positions
      where public.positions.id = executions.position_id
        and public.positions.user_id = auth.uid()
    )
  );

create policy "executions_insert_own"
  on public.executions
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.positions
      where public.positions.id = executions.position_id
        and public.positions.user_id = auth.uid()
    )
  );

create policy "executions_update_own"
  on public.executions
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.positions
      where public.positions.id = executions.position_id
        and public.positions.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.positions
      where public.positions.id = executions.position_id
        and public.positions.user_id = auth.uid()
    )
  );

create policy "executions_delete_own"
  on public.executions
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.positions
      where public.positions.id = executions.position_id
        and public.positions.user_id = auth.uid()
    )
  );

-- market_snapshots policies
create policy "market_snapshots_select_auth"
  on public.market_snapshots
  for select
  to authenticated
  using (true);

-- opportunities policies
create policy "opportunities_select_auth"
  on public.opportunities
  for select
  to authenticated
  using (true);
