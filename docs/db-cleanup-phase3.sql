-- Arbiter v2 DB cleanup plan (manual run, no auto migration in this step)
-- Run only after DB backup.

begin;

-- 1) Keep minimal watcher tables
-- keep: market_snapshots, opportunities, system_ticks, opportunity_decisions

-- 2) Drop dependent/legacy tables not needed by watcher-first runtime
-- order matters for FK dependencies.

drop table if exists public.executions cascade;
drop table if exists public.positions cascade;
drop table if exists public.paper_account_settings cascade;
drop table if exists public.paper_accounts cascade;
drop table if exists public.daily_strategy_pnl cascade;
drop table if exists public.strategy_settings cascade;
drop table if exists public.exchange_settings cascade;
drop table if exists public.strategy_policy_events cascade;
drop table if exists public.strategy_policy_rollouts cascade;
drop table if exists public.strategy_policy_proposals cascade;
drop table if exists public.strategy_policy_configs cascade;
drop table if exists public.lane_policy_reviews cascade;
drop table if exists public.candidate_lane_policies cascade;
drop table if exists public.backcheck_runs cascade;
drop table if exists public.news_reaction_snapshots cascade;
drop table if exists public.news_events cascade;
drop table if exists public.ai_usage_daily cascade;

-- optional candidate if not needed by current auth flow:
-- drop table if exists public.profiles cascade;

commit;
