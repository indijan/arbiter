create table if not exists public.candidate_lane_policies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  label text not null,
  regime text not null,
  why text not null,
  rule_hint text not null,
  rule_config jsonb not null default '{}'::jsonb,
  priority text not null check (priority in ('high', 'medium')),
  trade_count integer not null default 0,
  pnl_30d_usd numeric not null default 0,
  expectancy_30d_usd numeric not null default 0,
  status text not null default 'candidate' check (status in ('candidate', 'validated', 'canary', 'rejected')),
  source_review_id uuid null references public.lane_policy_reviews(id) on delete set null,
  last_reviewed_at timestamptz not null default now(),
  status_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, label, regime)
);

create index if not exists candidate_lane_policies_user_id_idx
  on public.candidate_lane_policies(user_id);

create index if not exists candidate_lane_policies_status_idx
  on public.candidate_lane_policies(status);

alter table public.candidate_lane_policies enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'candidate_lane_policies'
      and policyname = 'candidate_lane_policies_select_own'
  ) then
    create policy candidate_lane_policies_select_own
      on public.candidate_lane_policies
      for select
      using (auth.uid() = user_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'candidate_lane_policies'
      and policyname = 'candidate_lane_policies_update_own'
  ) then
    create policy candidate_lane_policies_update_own
      on public.candidate_lane_policies
      for update
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;
