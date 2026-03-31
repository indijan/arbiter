create table if not exists public.lane_policy_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  current_btc_regime text not null,
  current_btc_momentum_6h_bps numeric not null default 0,
  review_window_days integer not null default 30,
  model text,
  used_ai boolean not null default false,
  status text not null default 'proposed',
  summary jsonb not null default '{}'::jsonb,
  recommendations jsonb not null default '[]'::jsonb,
  raw text,
  created_at timestamptz not null default now()
);

create index if not exists lane_policy_reviews_user_created_idx
  on public.lane_policy_reviews (user_id, created_at desc);

alter table public.lane_policy_reviews enable row level security;

create policy "lane_policy_reviews_select_own"
  on public.lane_policy_reviews
  for select
  to authenticated
  using (user_id = auth.uid());
