create table if not exists public.opportunity_decisions (
  id bigserial primary key,
  ts timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id bigint not null references public.opportunities(id) on delete cascade,
  variant text not null,
  score numeric,
  chosen boolean not null default false,
  position_id uuid null references public.positions(id) on delete set null,
  features jsonb not null default '{}'::jsonb
);

create index if not exists opportunity_decisions_ts_desc_idx
  on public.opportunity_decisions (ts desc);

create index if not exists opportunity_decisions_user_ts_desc_idx
  on public.opportunity_decisions (user_id, ts desc);

create index if not exists opportunity_decisions_opportunity_idx
  on public.opportunity_decisions (opportunity_id);

alter table public.opportunity_decisions enable row level security;

create policy "opportunity_decisions_select_own"
  on public.opportunity_decisions
  for select
  to authenticated
  using (user_id = auth.uid());
