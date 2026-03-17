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

## Carry scope

- Strategy: `spot_perp_carry`
- Inputs: same-exchange spot/perp/funding snapshots
- Outputs:
  - carry opens
  - carry closes
  - realized replay pnl
  - pair ranking by exchange/symbol

## Carry command

```bash
pnpm -C apps/web replay:carry -- --fixture fixtures/carry-synthetic-good.json
pnpm -C apps/web replay:carry -- --fixture fixtures/carry-synthetic-bad.json
pnpm -C apps/web export:carry -- --hours 24 --output fixtures/carry-historical-export.json
pnpm -C apps/web replay:carry -- --fixture fixtures/carry-historical-export.json --windows 6,12,24
```
