# Arbiter Engine Architecture (Data -> Strategy -> Evaluation -> Execution)

Goal: keep the trading system modular and testable by separating:

- **Data**: ingestion + storage of market snapshots and signals
- **Strategy**: produces *opportunities* (not orders)
- **Evaluation**: filters + ranks opportunities (quality > quantity)
- **Execution**: opens/closes positions (paper/live), independent of strategies

This matches the patterns seen in Hummingbot/OctoBot-style systems: strategies are plugins, execution is an adapter, and a central evaluator orchestrates decisions.

## Current Folder Map

All engine code lives under:

- `apps/web/src/server/engine`

### Strategy layer (plugins)

- `apps/web/src/server/engine/strategies/plugins.ts`
  - Strategy plugin registry.
  - Each plugin runs a *detect* job and writes opportunities to the DB.
- `apps/web/src/server/engine/orchestrator/detect.ts`
  - Runs all strategy plugins and returns a single summary.

Strategy detect jobs (DB writers):

- `apps/web/src/server/jobs/detect*.ts`

### Evaluation layer (opportunity selection)

Central selection/ranking for paper execution:

- `apps/web/src/server/engine/evaluator/selectPaperOpportunities.ts`
  - Takes raw opportunities from DB and produces a ranked list.
  - Owns: per-opportunity filtering, feature building, learned scoring, optional LLM re-ranking.

### Execution layer

Paper execution helpers:

- `apps/web/src/server/engine/execution/paper/*`

Jobs that orchestrate paper execution/closing:

- `apps/web/src/server/jobs/autoExecutePaper.ts`
- `apps/web/src/server/jobs/autoClosePaper.ts`

## Invariants (what each layer must not do)

- **Strategy** must not open/close positions. It only emits opportunities.
- **Evaluation** must not fetch exchange APIs or write market snapshots. It only evaluates opportunities.
- **Execution** must not implement strategy logic. It only executes an already-chosen opportunity.

## Next steps (when we extend)

1. Make strategy plugins return `Opportunity[]` in-memory (in addition to DB insert), to enable:
   - unit tests without Supabase
   - deterministic replays
2. Introduce a single evaluator interface per execution mode:
   - `evaluateForPaper(...)`
   - `evaluateForLive(...)`

