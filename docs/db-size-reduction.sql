-- DB size reduction for Arbiter v2 watcher-first runtime.
-- Run manually in an off-peak window after backup.
--
-- Policy:
-- - Remove pre-v2 runtime data.
-- - Keep up to 14 days of Arbiter v2 data for analysis.
-- - Keep the core watcher tables only; legacy table drops live in db-cleanup-phase3.sql.
--
-- Adjust timestamp '2026-04-16 00:00:00+00' only if the Arbiter v2 production baseline moved.

-- 1) Retention deletes in a transaction
begin;

delete from public.market_snapshots
where ts < greatest(now() - interval '14 days', timestamptz '2026-04-16 00:00:00+00');

delete from public.opportunities
where ts < greatest(now() - interval '14 days', timestamptz '2026-04-16 00:00:00+00');

delete from public.system_ticks
where ts < greatest(now() - interval '14 days', timestamptz '2026-04-16 00:00:00+00');

delete from public.opportunity_decisions
where ts < greatest(now() - interval '14 days', timestamptz '2026-04-16 00:00:00+00');

commit;

-- 2) Reclaim space OUTSIDE transaction
vacuum (analyze) public.market_snapshots;
vacuum (analyze) public.opportunities;
vacuum (analyze) public.system_ticks;
vacuum (analyze) public.opportunity_decisions;

-- 3) Optional index compaction.
-- Run these one-by-one outside a transaction if index bloat remains high.
-- They can take time, but CONCURRENTLY avoids a hard write lock.
--
-- reindex index concurrently public.market_snapshots_ts_desc_idx;
-- reindex index concurrently public.market_snapshots_exchange_symbol_ts_desc_idx;
-- reindex index concurrently public.opportunities_ts_desc_idx;
-- reindex index concurrently public.opportunities_exchange_symbol_ts_desc_idx;
-- reindex index concurrently public.system_ticks_ts_desc_idx;
-- reindex index concurrently public.opportunity_decisions_ts_desc_idx;
-- reindex index concurrently public.opportunity_decisions_user_ts_desc_idx;
-- reindex index concurrently public.opportunity_decisions_opportunity_idx;
-- reindex index concurrently public.opportunity_decisions_reject_reason_idx;
