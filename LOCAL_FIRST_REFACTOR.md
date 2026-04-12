# Local-First Refactor Plan

## Goal

Build a simple, local-server-first paper trading system that:

- uses rich historical data only for offline research and replay
- uses a narrow live dataset for online decisions
- keeps strategies independent by lane and regime
- prefers small, positive expectancy over throughput
- avoids expensive hot-path reads from Supabase

This plan is intentionally biased toward removing moving parts.

## Principles

1. Supabase is not the hot path.
2. Live detect should read only recent local data.
3. Historical data belongs to offline analysis, not every 2-minute decision loop.
4. Each lane is its own strategy unit.
5. If a process does not produce measurable value, remove it.
6. Default to small notional and low concurrency.

## Target Architecture

### Local server responsibilities

- ingest market data
- keep a local hot database
- run live detect
- open and close paper positions
- serve the dashboard

### Supabase responsibilities

- optional reporting sink
- optional export/archive
- optional historical research store

Supabase should not be required for the live loop once the local-first migration is complete.

## Minimal Live System

Keep only these parts in the live loop:

- ingest
- relative strength detect
- paper execute
- paper close
- simple dashboard

Everything else is optional and should be off by default.

## Lane Model

### Required lane behavior

- each lane has its own detect rule
- each lane has its own execute guard
- each lane has its own PnL tracking
- each lane can be enabled or disabled independently
- each lane is evaluated per regime, not in a single global competition pool

### Target regime structure

Keep at most 1-2 lanes per regime:

- bull
- soft bull
- flat
- soft bear
- deep bear

Do not carry lanes that are not individually profitable.

## Immediate Cut List

These should be disabled first in the live loop:

- spread reversion
- cross-exchange spot arb
- triangular arb
- news shadow
- adaptive policy review/controller logic that changes thresholds automatically
- candidate lane workflows

Reason:

- they add complexity
- they consume data and compute
- they currently do not justify their cost

## Files To Keep In The First Local-First Core

- `/Users/indijanmac/Projects/arbiter/apps/web/src/server/jobs/ingestBinance.ts`
- `/Users/indijanmac/Projects/arbiter/apps/web/src/server/jobs/ingestBinanceSpot.ts`
- `/Users/indijanmac/Projects/arbiter/apps/web/src/server/jobs/ingestCoinbase.ts`
- `/Users/indijanmac/Projects/arbiter/apps/web/src/server/jobs/ingestKraken.ts`
- `/Users/indijanmac/Projects/arbiter/apps/web/src/server/jobs/detectRelativeStrength.ts`
- `/Users/indijanmac/Projects/arbiter/apps/web/src/server/jobs/autoExecutePaper.ts`
- `/Users/indijanmac/Projects/arbiter/apps/web/src/server/jobs/autoClosePaper.ts`
- `/Users/indijanmac/Projects/arbiter/apps/web/src/server/hotdb/sqlite.ts`
- `/Users/indijanmac/Projects/arbiter/apps/web/src/app/api/cron/ingest/route.ts`
- `/Users/indijanmac/Projects/arbiter/apps/web/src/app/api/cron/detect/route.ts`
- `/Users/indijanmac/Projects/arbiter/apps/web/src/app/api/cron/execute/route.ts`
- `/Users/indijanmac/Projects/arbiter/apps/web/src/app/api/cron/close/route.ts`
- `/Users/indijanmac/Projects/arbiter/apps/runner/src/index.ts`

## Files To Remove From The Default Live Loop

- `/Users/indijanmac/Projects/arbiter/apps/web/src/server/jobs/detectSpreadReversion.ts`
- `/Users/indijanmac/Projects/arbiter/apps/web/src/server/jobs/detectCrossExchangeSpot.ts`
- `/Users/indijanmac/Projects/arbiter/apps/web/src/server/jobs/detectTriangular.ts`
- `/Users/indijanmac/Projects/arbiter/apps/web/src/server/jobs/newsShadow.ts`
- `/Users/indijanmac/Projects/arbiter/apps/web/src/server/jobs/reviewLanePolicies.ts`
- `/Users/indijanmac/Projects/arbiter/apps/web/src/server/policy/controller.ts`
- `/Users/indijanmac/Projects/arbiter/apps/web/src/server/policy/store.ts`
- `/Users/indijanmac/Projects/arbiter/apps/web/src/server/engine/strategies/plugins.ts`
- `/Users/indijanmac/Projects/arbiter/apps/web/src/server/engine/orchestrator/detect.ts`
- `/Users/indijanmac/Projects/arbiter/apps/web/src/server/ai/opportunityScoring.ts`

These files do not all need to be deleted immediately, but they should stop participating in the live loop.

## Local Database Shape

### Phase 1

Use SQLite at:

- `/Users/indijan/.arbiter/data/hot.db`

Tables:

1. `market_snapshots_recent`
- recent raw quotes only
- retention: 6-12 hours

Suggested columns:

- `ts`
- `exchange`
- `symbol`
- `spot_bid`
- `spot_ask`
- `perp_bid`
- `perp_ask`
- `funding_rate`
- `mark_price`
- `index_price`

Suggested indexes:

- `(exchange, symbol, ts)`
- `(ts)`

### Phase 2

Add aggregated bars:

2. `snapshot_bars_10m`
3. `snapshot_bars_1h`

The live detectors should prefer bars over raw snapshots whenever possible.

### Phase 3

Move live state to local DB too:

4. `opportunities_local`
5. `positions_local`
6. `executions_local`
7. `lane_stats_daily`

Supabase then becomes optional export/reporting only.

## Online vs Offline Data Policy

### Online

Use only:

- last 6-12 hours raw snapshots
- last 7 days aggregated bars if needed
- latest open positions
- lane-level recent PnL summaries

### Offline

Use full history for:

- replay
- backcheck
- strategy design
- lane threshold tuning
- regime studies

Offline analysis should not run inside the 2-minute live loop.

## Execution Policy

Target live behavior:

- small notional
- max 1 open per lane
- max 1-2 concurrent positions total at the beginning
- no repeated consumption of the same stale opportunity
- no global greedy ranking across unrelated lanes

If a lane is active, it should be judged on its own rules and its own PnL.

## Concrete Refactor Phases

### Phase 0: Stop The Bleeding

Objective:

- lower egress and moving parts immediately

Actions:

- disable spread reversion detect in live loop
- disable xarb, tri arb, news detect in live loop
- disable adaptive controller/policy jobs in live loop
- keep only ingest + relative strength + execute + close

Primary files:

- `/Users/indijanmac/Projects/arbiter/apps/web/src/server/engine/strategies/plugins.ts`
- `/Users/indijanmac/Projects/arbiter/apps/runner/src/index.ts`

### Phase 1: Local Hot Path

Objective:

- localize all live reads

Actions:

- ingest writes into SQLite hot cache
- relative strength reads from SQLite first
- spread reversion either disabled or migrated to SQLite

Primary files:

- `/Users/indijanmac/Projects/arbiter/apps/web/src/server/hotdb/sqlite.ts`
- `/Users/indijanmac/Projects/arbiter/apps/web/src/server/jobs/ingestBinance.ts`
- `/Users/indijanmac/Projects/arbiter/apps/web/src/server/jobs/ingestBinanceSpot.ts`
- `/Users/indijanmac/Projects/arbiter/apps/web/src/server/jobs/ingestCoinbase.ts`
- `/Users/indijanmac/Projects/arbiter/apps/web/src/server/jobs/ingestKraken.ts`
- `/Users/indijanmac/Projects/arbiter/apps/web/src/server/jobs/detectRelativeStrength.ts`

### Phase 2: Lane Independence

Objective:

- stop global lane coupling

Actions:

- separate lane selection from global score competition
- lane-specific execution caps
- lane-specific PnL and reject reasons
- explicit regime-to-lane mapping

Primary files:

- `/Users/indijanmac/Projects/arbiter/apps/web/src/server/jobs/autoExecutePaper.ts`
- `/Users/indijanmac/Projects/arbiter/apps/web/src/server/jobs/detectRelativeStrength.ts`

### Phase 3: Local Live State

Objective:

- make the live engine independent of Supabase

Actions:

- move paper positions, opportunities, and executions to SQLite
- optionally mirror summaries to Supabase

Primary files:

- `/Users/indijanmac/Projects/arbiter/apps/web/src/server/jobs/autoExecutePaper.ts`
- `/Users/indijanmac/Projects/arbiter/apps/web/src/server/jobs/autoClosePaper.ts`
- `/Users/indijanmac/Projects/arbiter/apps/web/src/app/dashboard/page.tsx`

### Phase 4: Offline Research Split

Objective:

- keep rich history, but out of the live path

Actions:

- make backcheck/replay consume exported historical datasets
- keep historical Supabase access only for offline reports and research jobs

Primary files:

- `/Users/indijanmac/Projects/arbiter/apps/web/src/server/jobs/runBackcheck.ts`
- `/Users/indijanmac/Projects/arbiter/apps/web/src/server/jobs/computeDailyPnl.ts`

## First Concrete Implementation Order

1. remove non-core live detectors from the runner
2. keep only relative strength live
3. finish SQLite migration for live detect reads
4. simplify execute to lane-first, small-notional, max-1-open-per-lane
5. move live positions/executions/opportunities to SQLite
6. trim dashboard to read local state
7. leave Supabase only for offline export/report

## Success Metrics

The refactor is successful when:

- the live loop runs without Supabase hot reads
- egress drops sharply
- live loop is understandable without reading 20 files
- lane-level PnL is visible and independent
- no strategy runs in production unless it is individually justified
- the system produces small, stable, positive paper expectancy

## What We Should Not Do Again

- do not reread long raw history on every 2-minute tick
- do not let unrelated lanes compete in one opaque global pool
- do not let adaptive meta-logic hide the real behavior of a lane
- do not keep expensive live features that do not produce measurable edge
