# Troubleshooting: "It Doesn't Open Anything"

If the runner tick completes but there are no new paper positions:

## 1) Confirm: it's not even attempting

Query the latest tick:

```sql
select
  ts,
  detect_summary->'auto_execute' as auto_execute
from public.system_ticks
order by ts desc
limit 1;
```

Key fields:
- `attempted`: how many opportunities the executor considered
- `passed_filters`: how many survived prefilters
- `created`: how many positions were opened
- `prefilter_reasons`: why opportunities got rejected

### Typical pattern: attempted=0 and passed_filters=0

This means every opportunity was rejected in prefiltering.

## 2) Inspect latest opportunities (24h)

```sql
select
  ts, exchange, symbol, type, net_edge_bps, confidence::numeric as confidence, status, details
from public.opportunities
where ts >= now() - interval '24 hours'
order by ts desc
limit 200;
```

And aggregate:

```sql
select
  type,
  count(*) as n,
  round(max(net_edge_bps)::numeric, 4) as max_net_edge_bps,
  round(avg(net_edge_bps)::numeric, 4) as avg_net_edge_bps,
  round(max((confidence::numeric))::numeric, 4) as max_conf,
  round(avg((confidence::numeric))::numeric, 4) as avg_conf,
  max(ts) as latest_ts
from public.opportunities
where ts >= now() - interval '24 hours'
group by 1
order by n desc;
```

## 3) If prefilter_reasons says "*_auto_open_disabled"

Example reasons:
- `xarb_auto_open_disabled`
- `spread_reversion_auto_open_disabled`
- `tri_arb_auto_open_disabled`

Then you need to ensure the corresponding strategy key is ACTIVE in `strategy_settings` for the user:
- `xarb_spot`
- `spread_reversion`
- `tri_arb`
- `spot_perp_carry`
- `relative_strength` (for lanes)

If these are PAUSED/STANDBY, the evaluator rejects their opportunities before ranking/execution.

## 3b) If prefilter_reasons says "symbol_not_allowed"

This means `PAPER_ALLOWED_SYMBOLS` is set and the opportunity symbol is not on the allowlist.
This is intentional: it prevents "random new symbols" (eg `DOTUSD`) from opening without an explicit lane/plan.

## 4) No open positions but "reserved capital" shows non-zero

This usually means:
- stale reserved value in `paper_accounts.reserved_usd`, or
- a position closed without releasing reserved, or
- UI reading a different account/user than the runner.

We debug by:
- checking latest `paper_accounts` row for the runner user,
- validating `positions` status counts by user_id and mode.
