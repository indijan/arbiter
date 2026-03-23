# Shadow Maneuver

## Thesis

BTC likely acts as the market's dominant regime anchor, but the current 10-minute snapshot tests did not prove a clean, fixed BTC-leads-alt lag.

So the working rule is:

- do not trade a naive BTC lead-lag model yet
- do use BTC as a regime gate where historical evidence supports it

## Current Actionable Rules

### Relative Strength Lane

- `ETHUSD`
  - direction: `long`
  - BTC gate: none for now
  - reason: historical replay remained positive, but BTC sign gating did not clearly improve it

- `XRPUSD`
  - direction: `short`
  - BTC gate: `BTCUSD 6h momentum < 0`
  - reason: historical replay only produced usable XRP short setups in BTC-negative regime

- `BCHUSD`
  - disabled
  - reason: live losses were dominated by BCH shorts, while historical edge was weak

## Detector Logic

1. Pull `coinbase` spot snapshots
2. Build 6-hour momentum per symbol
3. Compute basket median momentum
4. Compute spread vs basket median
5. Apply:
   - symbol allowlist
   - direction rule
   - BTC regime rule if configured
   - spread threshold
6. Create opportunity

## Current Parameters

- entry threshold: `50 bps`
- hold time: `4h`
- symbols:
  - `ETHUSD long`
  - `XRPUSD short` only when `BTC 6h momentum < 0`

## What Still Needs Separate Research

If we want to test the stronger original idea, we should build a separate replay around:

1. BTC trigger event definition
2. alt response delay distribution
3. per-symbol lag windows
4. profitability after fees/slippage

That is a different lane from the current relative-strength model.
