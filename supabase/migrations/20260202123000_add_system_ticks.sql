create table if not exists public.system_ticks (
  id bigserial primary key,
  ts timestamptz not null default now(),
  ingest_errors int not null default 0,
  ingest_errors_json jsonb not null default '[]'::jsonb,
  detect_summary jsonb not null default '{}'::jsonb
);

alter table public.system_ticks enable row level security;

create policy "system_ticks_select_auth"
  on public.system_ticks
  for select
  to authenticated
  using (true);
