create table if not exists public.ai_usage_daily (
  day date primary key,
  requests int not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.ai_usage_daily enable row level security;

create policy "ai_usage_daily_select_auth"
  on public.ai_usage_daily
  for select
  to authenticated
  using (true);
