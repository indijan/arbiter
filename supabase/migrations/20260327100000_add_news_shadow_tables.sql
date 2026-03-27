create table if not exists public.news_events (
  id bigserial primary key,
  source text not null,
  url text not null unique,
  title text not null,
  published_at timestamptz not null,
  raw_summary text,
  raw_content text,
  affected_assets text[] not null default '{}',
  event_type text,
  sentiment text,
  action_bias text,
  impact_horizon text,
  confidence numeric,
  novelty_score numeric,
  risk_gate boolean not null default false,
  risk_gate_reason text,
  risk_gate_hours integer,
  classification_status text not null default 'pending',
  classification_model text,
  classification_json jsonb,
  classified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists news_events_published_at_idx
  on public.news_events (published_at desc);

create index if not exists news_events_classification_status_idx
  on public.news_events (classification_status, published_at desc);

create table if not exists public.news_reaction_snapshots (
  id bigserial primary key,
  news_event_id bigint not null references public.news_events(id) on delete cascade,
  asset text not null,
  horizon_minutes integer not null,
  exchange text not null default 'coinbase',
  start_ts timestamptz,
  end_ts timestamptz,
  start_mid numeric,
  end_mid numeric,
  price_change_bps numeric,
  relative_to_btc_bps numeric,
  created_at timestamptz not null default now(),
  unique (news_event_id, asset, horizon_minutes, exchange)
);

create index if not exists news_reaction_snapshots_news_event_id_idx
  on public.news_reaction_snapshots (news_event_id);
