alter table if exists public.opportunity_decisions
  add column if not exists reject_reason text,
  add column if not exists reject_meta jsonb not null default '{}'::jsonb;

create index if not exists opportunity_decisions_reject_reason_idx
  on public.opportunity_decisions (reject_reason);
