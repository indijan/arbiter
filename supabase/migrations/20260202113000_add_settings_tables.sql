create table if not exists public.strategy_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  strategy_key text not null,
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  unique (user_id, strategy_key)
);

create table if not exists public.exchange_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  exchange_key text not null,
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  unique (user_id, exchange_key)
);

alter table public.strategy_settings enable row level security;
alter table public.exchange_settings enable row level security;

create policy "strategy_settings_select_own"
  on public.strategy_settings
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "strategy_settings_insert_own"
  on public.strategy_settings
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "strategy_settings_update_own"
  on public.strategy_settings
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "strategy_settings_delete_own"
  on public.strategy_settings
  for delete
  to authenticated
  using (user_id = auth.uid());

create policy "exchange_settings_select_own"
  on public.exchange_settings
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "exchange_settings_insert_own"
  on public.exchange_settings
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "exchange_settings_update_own"
  on public.exchange_settings
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "exchange_settings_delete_own"
  on public.exchange_settings
  for delete
  to authenticated
  using (user_id = auth.uid());
