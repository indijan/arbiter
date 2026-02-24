create table if not exists public.strategy_policy_configs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users(id) on delete cascade,
  source text not null default 'manual',
  reason text,
  config jsonb not null,
  status text not null default 'approved',
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  superseded_at timestamptz,
  constraint strategy_policy_configs_status_chk
    check (status in ('draft', 'approved', 'rejected', 'archived'))
);

create table if not exists public.strategy_policy_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users(id) on delete cascade,
  model text,
  input_summary jsonb not null default '{}'::jsonb,
  proposed_config jsonb not null,
  decision text not null default 'pending',
  decision_reason text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  constraint strategy_policy_proposals_decision_chk
    check (decision in ('pending', 'approved', 'rejected', 'failed'))
);

create table if not exists public.strategy_policy_rollouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users(id) on delete cascade,
  config_id uuid not null references public.strategy_policy_configs(id) on delete cascade,
  status text not null default 'canary',
  canary_ratio numeric not null default 0.2,
  guardrails jsonb not null default '{}'::jsonb,
  start_ts timestamptz not null default now(),
  end_ts timestamptz,
  metrics jsonb not null default '{}'::jsonb,
  rollback_config_id uuid null references public.strategy_policy_configs(id) on delete set null,
  constraint strategy_policy_rollouts_status_chk
    check (status in ('canary', 'active', 'rolled_back', 'failed')),
  constraint strategy_policy_rollouts_canary_ratio_chk
    check (canary_ratio >= 0 and canary_ratio <= 1)
);

create table if not exists public.strategy_policy_events (
  id bigserial primary key,
  ts timestamptz not null default now(),
  user_id uuid null references auth.users(id) on delete cascade,
  rollout_id uuid null references public.strategy_policy_rollouts(id) on delete cascade,
  proposal_id uuid null references public.strategy_policy_proposals(id) on delete cascade,
  event_type text not null,
  details jsonb not null default '{}'::jsonb
);

create index if not exists strategy_policy_configs_user_created_idx
  on public.strategy_policy_configs (user_id, created_at desc);
create index if not exists strategy_policy_configs_status_idx
  on public.strategy_policy_configs (status, created_at desc);

create index if not exists strategy_policy_proposals_user_created_idx
  on public.strategy_policy_proposals (user_id, created_at desc);
create index if not exists strategy_policy_proposals_decision_idx
  on public.strategy_policy_proposals (decision, created_at desc);

create index if not exists strategy_policy_rollouts_user_start_idx
  on public.strategy_policy_rollouts (user_id, start_ts desc);
create index if not exists strategy_policy_rollouts_status_idx
  on public.strategy_policy_rollouts (status, start_ts desc);

create index if not exists strategy_policy_rollouts_live_idx
  on public.strategy_policy_rollouts (user_id, status, start_ts desc)
  where status in ('canary', 'active');

create index if not exists strategy_policy_events_user_ts_idx
  on public.strategy_policy_events (user_id, ts desc);
create index if not exists strategy_policy_events_type_ts_idx
  on public.strategy_policy_events (event_type, ts desc);

alter table public.strategy_policy_configs enable row level security;
alter table public.strategy_policy_proposals enable row level security;
alter table public.strategy_policy_rollouts enable row level security;
alter table public.strategy_policy_events enable row level security;

create policy "strategy_policy_configs_select_auth"
  on public.strategy_policy_configs
  for select
  to authenticated
  using (true);

create policy "strategy_policy_proposals_select_auth"
  on public.strategy_policy_proposals
  for select
  to authenticated
  using (true);

create policy "strategy_policy_rollouts_select_auth"
  on public.strategy_policy_rollouts
  for select
  to authenticated
  using (true);

create policy "strategy_policy_events_select_auth"
  on public.strategy_policy_events
  for select
  to authenticated
  using (true);
