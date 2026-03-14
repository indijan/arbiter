# Replay Plan

## Goal

Move strategy iteration from deploy-and-wait to local replay and synthetic testing.

## First scope

- Strategy: `xarb_spot`
- Inputs: snapshot fixtures
- Outputs:
  - detected opportunities
  - persistent-entry opens
  - expected PnL summary

## Workflow

1. Run a synthetic fixture that should open positive trades.
2. Run a synthetic fixture that should open nothing.
3. Tune thresholds locally.
4. Add DB-exported historical fixtures.
5. Only after replay looks sane, propagate rules back to live paper execution.

## Command

```bash
pnpm -C apps/web replay:xarb -- --fixture fixtures/xarb-synthetic-good.json
pnpm -C apps/web replay:xarb -- --fixture fixtures/xarb-synthetic-bad.json
pnpm -C apps/web export:xarb -- --hours 12 --output fixtures/xarb-historical-export.json
pnpm -C apps/web replay:xarb -- --fixture fixtures/xarb-historical-export.json --min-snapshots 3 --windows 1,3,6,12
```

## Next step

Replay the exported historical fixture locally and compare:

- candidate count
- open count
- expectancy
- symbol/exchange distribution
- pair ranking
- go-live score by time window
