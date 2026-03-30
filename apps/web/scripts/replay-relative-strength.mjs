import fs from "node:fs";
import path from "node:path";

const CONFIG = {
  exchange: "coinbase",
  entryLookbackHours: 6,
  holdHours: 4,
  entryThresholdBps: 50,
  exitThresholdBps: 25,
  notionalUsd: 100,
  allowlist: new Set(["XRPUSD", "AVAXUSD", "SOLUSD"]),
  denylist: new Set(["LTCUSD", "DOTUSD", "BCHUSD"]),
  directionRules: {
    XRPUSD: "short",
    AVAXUSD: "short",
    SOLUSD: "short"
  },
  btcFilters: {
    XRPUSD: "btc_neg",
    AVAXUSD: "btc_pos",
    SOLUSD: "btc_neg"
  },
  xrpShortMinBtcMomentum6hBps: -100,
  avaxShortMinBtcMomentum6hBps: 150,
  avaxShortMinSpreadBps: 60,
  solShortMaxBtcMomentum6hBps: -100,
  solShortMinSpreadBps: 0,
  solShortMaxAltMomentum6hBps: -100
};

function strategyVariantForSymbol(symbol) {
  if (symbol === "XRPUSD") return "xrp_shadow_short_core";
  if (symbol === "AVAXUSD") return "avax_shadow_short_canary";
  if (symbol === "SOLUSD") return "sol_shadow_short_canary";
  return "relative_strength";
}

function parseArgs(argv) {
  const args = { fixture: "fixtures/xarb-historical-export.json", windows: [] };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--fixture" && argv[i + 1]) args.fixture = argv[++i];
    else if (arg === "--windows" && argv[i + 1]) {
      args.windows = argv[++i].split(",").map(Number).filter((n) => Number.isFinite(n) && n > 0);
    }
  }
  return args;
}

function canonicalSymbol(symbol) {
  return symbol.endsWith("USDT") ? symbol.replace(/USDT$/, "USD") : symbol;
}

function loadFixture(fixturePath) {
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), fixturePath), "utf8"));
}

function bucketHour(ts) {
  return new Date(Math.floor(Date.parse(ts) / 3600000) * 3600000).toISOString();
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function buildHours(snapshots) {
  const byHour = new Map();
  for (const snap of snapshots) {
    if (snap.exchange !== CONFIG.exchange || !(snap.ask > snap.bid)) continue;
    const hour = bucketHour(snap.ts);
    const row = byHour.get(hour) ?? new Map();
    row.set(canonicalSymbol(snap.symbol), (snap.bid + snap.ask) / 2);
    byHour.set(hour, row);
  }
  return byHour;
}

function simulate(snapshots) {
  const byHour = buildHours(snapshots);
  const hours = Array.from(byHour.keys()).sort();
  const opens = [];
  for (let i = CONFIG.entryLookbackHours; i + CONFIG.holdHours < hours.length; i += 1) {
    const current = byHour.get(hours[i]);
    const entry = byHour.get(hours[i - CONFIG.entryLookbackHours]);
    if (!current || !entry) continue;
    const allRows = Array.from(current.keys())
      .map((symbol) => {
        const c = current.get(symbol);
        const e = entry.get(symbol);
        if (!c || !e) return null;
        return { symbol, momentum: ((c - e) / e) * 10000, current: c };
      })
      .filter(Boolean);
    if (allRows.length < 4) continue;
    const tradableRows = allRows.filter((row) => CONFIG.allowlist.has(row.symbol) && !CONFIG.denylist.has(row.symbol));
    if (tradableRows.length === 0) continue;
    const basketMean = median(allRows.map((r) => r.momentum));
    const btcRow = allRows.find((r) => r.symbol === "BTCUSD");
    const ranked = tradableRows
      .map((r) => ({ ...r, spread: r.momentum - basketMean }))
      .sort((a, b) => Math.abs(b.spread) - Math.abs(a.spread));
    const exitHour = byHour.get(hours[i + CONFIG.holdHours]);
    if (!exitHour) continue;
    let insertedThisHour = 0;
    for (const candidate of ranked) {
      if (insertedThisHour >= CONFIG.allowlist.size) break;
      if (Math.abs(candidate.spread) < CONFIG.entryThresholdBps) continue;
      const direction = candidate.spread > 0 ? "short" : "long";
      if (CONFIG.directionRules[candidate.symbol] && CONFIG.directionRules[candidate.symbol] !== direction) continue;
      if (CONFIG.btcFilters[candidate.symbol] === "btc_neg" && !(btcRow && btcRow.momentum < 0)) continue;
      if (CONFIG.btcFilters[candidate.symbol] === "btc_pos" && !(btcRow && btcRow.momentum > 0)) continue;
      if (
        candidate.symbol === "XRPUSD" &&
        direction === "short" &&
        !(btcRow && btcRow.momentum < CONFIG.xrpShortMinBtcMomentum6hBps)
      ) {
        continue;
      }
      if (
        candidate.symbol === "AVAXUSD" &&
        direction === "short" &&
        (
          !(btcRow && btcRow.momentum >= CONFIG.avaxShortMinBtcMomentum6hBps) ||
          candidate.spread < CONFIG.avaxShortMinSpreadBps
        )
      ) {
        continue;
      }
      if (
        candidate.symbol === "SOLUSD" &&
        direction === "short" &&
        (
          !(btcRow && btcRow.momentum <= CONFIG.solShortMaxBtcMomentum6hBps) ||
          !(candidate.spread >= CONFIG.solShortMinSpreadBps) ||
          !(candidate.momentum <= CONFIG.solShortMaxAltMomentum6hBps)
        )
      ) {
        continue;
      }
      const exitPrice = exitHour.get(candidate.symbol);
      if (!exitPrice) continue;
      const qty = CONFIG.notionalUsd / candidate.current;
      const pnl =
        direction === "short"
          ? qty * (candidate.current - exitPrice)
          : qty * (exitPrice - candidate.current);
      opens.push({
        opened_at: hours[i],
        closed_at: hours[i + CONFIG.holdHours],
        symbol: candidate.symbol,
        direction,
        strategy_variant: strategyVariantForSymbol(candidate.symbol),
        spread_bps: Number(candidate.spread.toFixed(4)),
        pnl_usd: Number(pnl.toFixed(4))
      });
      insertedThisHour += 1;
    }
  }
  const pnlTotal = opens.reduce((sum, row) => sum + row.pnl_usd, 0);
  return {
    opens,
    summary: {
      open_count: opens.length,
      pnl_total_usd: Number(pnlTotal.toFixed(4)),
      expectancy_usd: Number((opens.length ? pnlTotal / opens.length : 0).toFixed(4))
    }
  };
}

function filterSnapshotsByHours(snapshots, hours) {
  if (!hours) return snapshots;
  const latestTs = Math.max(...snapshots.map((snapshot) => Date.parse(snapshot.ts)));
  const sinceMs = latestTs - hours * 3600000;
  return snapshots.filter((snapshot) => Date.parse(snapshot.ts) >= sinceMs);
}

function normalizeSnapshots(snapshots) {
  return snapshots
    .map((snapshot) => ({
      ...snapshot,
      bid: snapshot.bid ?? snapshot.spot_bid ?? null,
      ask: snapshot.ask ?? snapshot.spot_ask ?? null
    }))
    .filter((snapshot) => snapshot.bid && snapshot.ask);
}

function main() {
  const args = parseArgs(process.argv);
  const fixture = loadFixture(args.fixture);
  const windows = args.windows.length ? args.windows : [24];
  const results = windows.map((windowHours) => {
    const snapshots = normalizeSnapshots(filterSnapshotsByHours(fixture.snapshots, windowHours));
    const result = simulate(snapshots);
    return {
      window_hours: windowHours,
      snapshot_count: snapshots.length,
      summary: result.summary,
      sample_opens: result.opens.slice(0, 10)
    };
  });
  console.log(JSON.stringify({ fixture: args.fixture, windows: results }, null, 2));
}

main();
