create table if not exists public.paper_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  balance_usd numeric not null default 10000,
  reserved_usd numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

alter table public.paper_accounts enable row level security;

create policy "paper_accounts_select_own"
  on public.paper_accounts
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "paper_accounts_insert_own"
  on public.paper_accounts
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "paper_accounts_update_own"
  on public.paper_accounts
  for update
  to authenticated
  using (user_id = auth.uid());
