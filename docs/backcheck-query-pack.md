# Backcheck Query Pack (1d / 7d / 30d)

This is the query pack we keep running manually in Supabase SQL Editor.
Goal: in 2-3 minutes you can answer:
- "Is the system attempting to trade?"
- "Why didn't it open?"
- "Which strategy family is producing signals?"
- "Which lanes (relative_strength variants) are profitable in 1/7/30d?"

Notes about the schema (important):
- `positions` does **not** have a `variant` column. Strategy/lane info is stored in `positions.meta`.
  - `positions.meta->>'type'` is the strategy family (`xarb_spot`, `spread_reversion`, `relative_strength`, `tri_arb`, etc.)
  - `positions.meta->>'strategy_variant'` exists for lane trades (`type=relative_strength`)
- `system_ticks.detect_summary` is JSONB and contains `auto_execute` diagnostics (attempted/passed_filters/created/reasons).

## 0) Latest executor diagnostics (single source of truth)

```sql
select
  ts,
  detect_summary->'auto_execute' as auto_execute
from public.system_ticks
order by ts desc
limit 1;
```

## 1) Opportunities produced in the last N days (signals in)

Replace `N days` with `1 day`, `7 days`, `30 days`.

```sql
select
  type,
  count(*) as n,
  round(max(net_edge_bps)::numeric, 4) as max_net_edge_bps,
  round(avg(net_edge_bps)::numeric, 4) as avg_net_edge_bps,
  round(max(confidence::numeric)::numeric, 4) as max_conf,
  round(avg(confidence::numeric)::numeric, 4) as avg_conf,
  max(ts) as latest_ts
from public.opportunities
where ts >= now() - interval '7 days'
group by 1
order by n desc;
```

## 2) Open/closed positions summary in the last N days (what actually happened)

Replace `N days`.

```sql
select
  (meta->>'type') as type,
  count(*) filter (where status = 'open') as open_n,
  count(*) filter (where status = 'closed') as closed_n,
  round(sum(realized_pnl_usd)::numeric, 4) as total_pnl_usd,
  round(avg(realized_pnl_usd)::numeric, 4) as avg_pnl_usd,
  round(min(realized_pnl_usd)::numeric, 4) as worst_trade_usd
from public.positions
where mode = 'paper'
  and entry_ts >= now() - interval '7 days'
group by 1
order by total_pnl_usd asc;
```

## 3) Lane performance (relative_strength variants) in the last N days

This is the "lane" backcheck (only `type=relative_strength` positions).

Replace `N days`.

```sql
select
  coalesce(meta->>'strategy_variant', '(none)') as lane,
  count(*) filter (where status = 'closed') as closed_trades,
  round(sum(realized_pnl_usd)::numeric, 4) as total_pnl_usd,
  round(avg(realized_pnl_usd)::numeric, 4) as avg_pnl_usd,
  round(min(realized_pnl_usd)::numeric, 4) as worst_trade_usd
from public.positions
where mode = 'paper'
  and (meta->>'type') = 'relative_strength'
  and entry_ts >= now() - interval '7 days'
group by 1
order by total_pnl_usd asc;
```

## 4) New/unexpected symbols opened (guardrail check)

This is how you spot "DOTUSD happened" fast.

Replace `N days`.

```sql
select
  symbol,
  count(*) filter (where status = 'closed') as closed_n,
  round(sum(realized_pnl_usd)::numeric, 4) as total_pnl_usd,
  min(entry_ts) as first_seen,
  max(entry_ts) as last_seen
from public.positions
where mode = 'paper'
  and entry_ts >= now() - interval '7 days'
group by 1
order by last_seen desc;
```

## 5) Inspect the last 10 closes (compact, for quick reading)

```sql
select
  exit_ts,
  symbol,
  status,
  realized_pnl_usd,
  meta->>'type' as type,
  meta->>'strategy_variant' as lane
from public.positions
where mode = 'paper'
  and status = 'closed'
order by exit_ts desc
limit 10;
```

