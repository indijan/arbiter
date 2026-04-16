-- DB size reduction for watcher-first runtime
-- Run manually in off-peak window.

-- 1) Retention deletes in a transaction
begin;

delete from public.market_snapshots
where ts < now() - interval '14 days';

delete from public.opportunities
where ts < now() - interval '30 days';

delete from public.system_ticks
where ts < now() - interval '30 days';

delete from public.opportunity_decisions
where ts < now() - interval '30 days';

commit;

-- 2) Reclaim space OUTSIDE transaction
vacuum (analyze) public.market_snapshots;
vacuum (analyze) public.opportunities;
vacuum (analyze) public.system_ticks;
vacuum (analyze) public.opportunity_decisions;
