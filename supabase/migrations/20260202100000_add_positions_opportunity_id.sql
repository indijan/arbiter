alter table public.positions
  add column if not exists opportunity_id bigint null;

create index if not exists positions_user_opportunity_entry_ts_idx
  on public.positions (user_id, opportunity_id, entry_ts desc);
