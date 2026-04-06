create table if not exists public.backcheck_runs (
  id bigserial primary key,
  ts timestamptz not null default now(),
  window_days int not null,
  summary jsonb not null default '{}'::jsonb
);

create index if not exists backcheck_runs_ts_idx on public.backcheck_runs (ts desc);
create index if not exists backcheck_runs_window_days_ts_idx on public.backcheck_runs (window_days, ts desc);

