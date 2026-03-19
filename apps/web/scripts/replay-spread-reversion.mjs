import fs from "node:fs";
import path from "node:path";

const DEFAULT_CONFIG = {
  timeBucketMinutes: 10,
  minHistoryPoints: 8,
  minCurrentGrossBps: 6,
  minZScore: 1.25,
  minExpectedNetBps: 1.5,
  roundtripCostsBps: 11,
  targetStdFraction: 0.25,
  targetMinBufferBps: 0.5,
  stopStdFraction: 0.75,
  stopMinBufferBps: 2,
  maxHoldBuckets: 6,
  notionalUsd: 100
};

function parseArgs(argv) {
  const args = {
    fixture: "fixtures/xarb-historical-export.json",
    windows: []
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--fixture" && argv[i + 1]) {
      args.fixture = argv[++i];
    } else if (arg === "--windows" && argv[i + 1]) {
      args.windows = argv[++i]
        .split(",")
        .map((item) => Number(item.trim()))
        .filter((item) => Number.isFinite(item) && item > 0)
        .sort((a, b) => a - b);
    }
  }

  return args;
}

function canonicalSymbol(symbol) {
  if (symbol.endsWith("USDT")) return symbol.replace(/USDT$/, "USD");
  return symbol;
}

function loadFixture(fixturePath) {
  const fullPath = path.resolve(process.cwd(), fixturePath);
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

function bucketIso(ts, bucketMinutes) {
  const bucketMs =
    Math.floor(Date.parse(ts) / (bucketMinutes * 60 * 1000)) *
    bucketMinutes *
    60 *
    1000;
  return new Date(bucketMs).toISOString();
}

function stddev(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function buildBuckets(snapshots, config) {
  const bySymbol = new Map();
  for (const snapshot of snapshots) {
    const symbol = canonicalSymbol(snapshot.symbol);
    const bucket = bucketIso(snapshot.ts, config.timeBucketMinutes);
    const symbolBuckets = bySymbol.get(symbol) ?? new Map();
    const quotes = symbolBuckets.get(bucket) ?? new Map();
    const current = quotes.get(snapshot.exchange);
    if (!current || Date.parse(snapshot.ts) > Date.parse(current.ts)) {
      quotes.set(snapshot.exchange, {
        exchange: snapshot.exchange,
        ts: snapshot.ts,
        bid: snapshot.bid,
        ask: snapshot.ask
      });
    }
    symbolBuckets.set(bucket, quotes);
    bySymbol.set(symbol, symbolBuckets);
  }
  return bySymbol;
}

function detectCandidates(snapshots, config) {
  const bucketsBySymbol = buildBuckets(snapshots, config);
  const candidates = [];

  for (const [symbol, symbolBuckets] of bucketsBySymbol.entries()) {
    const bucketEntries = Array.from(symbolBuckets.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    for (let idx = config.minHistoryPoints; idx < bucketEntries.length; idx += 1) {
      const [ts, currentQuotes] = bucketEntries[idx];
      const priorEntries = bucketEntries.slice(0, idx);
      const currentRows = Array.from(currentQuotes.values()).filter((row) => row.ask > row.bid);
      for (const buy of currentRows) {
        for (const sell of currentRows) {
          if (buy.exchange === sell.exchange) continue;
          const currentGross = ((sell.bid - buy.ask) / buy.ask) * 10000;
          if (currentGross < config.minCurrentGrossBps) continue;

          const history = priorEntries
            .map(([, quotes]) => {
              const buyRow = quotes.get(buy.exchange);
              const sellRow = quotes.get(sell.exchange);
              if (!buyRow || !sellRow || buyRow.ask <= buyRow.bid || sellRow.ask <= sellRow.bid) {
                return null;
              }
              return ((sellRow.bid - buyRow.ask) / buyRow.ask) * 10000;
            })
            .filter((value) => value !== null);

          if (history.length < config.minHistoryPoints) continue;

          const mean = history.reduce((sum, value) => sum + value, 0) / history.length;
          const sigma = stddev(history);
          const safeSigma = sigma > 0.01 ? sigma : 0.01;
          const zScore = (currentGross - mean) / safeSigma;
          if (zScore < config.minZScore) continue;

          const targetExitGross = mean + Math.max(config.targetMinBufferBps, sigma * config.targetStdFraction);
          const stopLossGross = currentGross + Math.max(config.stopMinBufferBps, sigma * config.stopStdFraction);
          const expectedNet = currentGross - targetExitGross - config.roundtripCostsBps;
          if (expectedNet < config.minExpectedNetBps) continue;

          candidates.push({
            ts,
            symbol,
            exchange: `${buy.exchange}_${sell.exchange}`,
            buy_exchange: buy.exchange,
            sell_exchange: sell.exchange,
            current_gross_bps: Number(currentGross.toFixed(4)),
            rolling_mean_bps: Number(mean.toFixed(4)),
            rolling_std_bps: Number(sigma.toFixed(4)),
            z_score: Number(zScore.toFixed(4)),
            target_exit_gross_bps: Number(targetExitGross.toFixed(4)),
            stop_loss_gross_bps: Number(stopLossGross.toFixed(4)),
            expected_net_bps: Number(expectedNet.toFixed(4))
          });
        }
      }
    }
  }

  return candidates.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}

function simulate(candidates, snapshots, config) {
  const bucketsBySymbol = buildBuckets(snapshots, config);
  const opens = [];

  for (const candidate of candidates) {
    const bucketEntries = Array.from((bucketsBySymbol.get(candidate.symbol) ?? new Map()).entries())
      .sort((a, b) => a[0].localeCompare(b[0]));
    const startIdx = bucketEntries.findIndex(([ts]) => ts === candidate.ts);
    if (startIdx === -1) continue;

    let exit = null;
    for (
      let idx = startIdx + 1;
      idx < Math.min(bucketEntries.length, startIdx + 1 + config.maxHoldBuckets);
      idx += 1
    ) {
      const [ts, quotes] = bucketEntries[idx];
      const buyRow = quotes.get(candidate.buy_exchange);
      const sellRow = quotes.get(candidate.sell_exchange);
      if (!buyRow || !sellRow || buyRow.ask <= buyRow.bid || sellRow.ask <= sellRow.bid) {
        continue;
      }
      const gross = ((sellRow.bid - buyRow.ask) / buyRow.ask) * 10000;
      const reason =
        gross <= candidate.target_exit_gross_bps
          ? "mean_reverted"
          : gross >= candidate.stop_loss_gross_bps
            ? "stop_loss"
            : null;
      if (reason) {
        exit = { ts, gross, reason };
        break;
      }
      if (idx === Math.min(bucketEntries.length, startIdx + config.maxHoldBuckets) - 1) {
        exit = { ts, gross, reason: "timeout" };
      }
    }

    if (!exit) continue;

    const realizedNetBps = candidate.current_gross_bps - exit.gross - config.roundtripCostsBps;
    const pnlUsd = (realizedNetBps / 10000) * config.notionalUsd;
    opens.push({
      opened_at: candidate.ts,
      closed_at: exit.ts,
      symbol: candidate.symbol,
      exchange: candidate.exchange,
      exit_reason: exit.reason,
      entry_gross_bps: candidate.current_gross_bps,
      exit_gross_bps: Number(exit.gross.toFixed(4)),
      realized_net_bps: Number(realizedNetBps.toFixed(4)),
      pnl_usd: Number(pnlUsd.toFixed(4))
    });
  }

  const pairStats = new Map();
  for (const open of opens) {
    const key = `${open.symbol}:${open.exchange}`;
    const row = pairStats.get(key) ?? { symbol: open.symbol, exchange: open.exchange, open_count: 0, pnl_total_usd: 0 };
    row.open_count += 1;
    row.pnl_total_usd += open.pnl_usd;
    pairStats.set(key, row);
  }

  const pnlTotal = opens.reduce((sum, item) => sum + item.pnl_usd, 0);
  return {
    opens,
    pair_ranking: Array.from(pairStats.values())
      .map((row) => ({
        ...row,
        pnl_total_usd: Number(row.pnl_total_usd.toFixed(4)),
        expectancy_usd: Number((row.pnl_total_usd / row.open_count).toFixed(4))
      }))
      .sort((a, b) => {
        if (b.pnl_total_usd !== a.pnl_total_usd) return b.pnl_total_usd - a.pnl_total_usd;
        return b.open_count - a.open_count;
      }),
    summary: {
      candidate_count: candidates.length,
      open_count: opens.length,
      pnl_total_usd: Number(pnlTotal.toFixed(4)),
      expectancy_usd: Number((opens.length > 0 ? pnlTotal / opens.length : 0).toFixed(4))
    }
  };
}

function filterSnapshotsByHours(snapshots, hours) {
  if (!hours) return snapshots;
  const latestTs = Math.max(...snapshots.map((snapshot) => Date.parse(snapshot.ts)));
  const sinceMs = latestTs - hours * 60 * 60 * 1000;
  return snapshots.filter((snapshot) => Date.parse(snapshot.ts) >= sinceMs);
}

function main() {
  const args = parseArgs(process.argv);
  const fixture = loadFixture(args.fixture);
  const windows = args.windows.length > 0 ? args.windows : [null];

  const results = windows.map((windowHours) => {
    const snapshots = filterSnapshotsByHours(fixture.snapshots, windowHours);
    const candidates = detectCandidates(snapshots, DEFAULT_CONFIG);
    const simulated = simulate(candidates, snapshots, DEFAULT_CONFIG);
    return {
      window_hours: windowHours,
      snapshot_count: snapshots.length,
      summary: simulated.summary,
      pair_ranking: simulated.pair_ranking.slice(0, 10),
      sample_opens: simulated.opens.slice(0, 10)
    };
  });

  console.log(JSON.stringify({ fixture: args.fixture, windows: results }, null, 2));
}

main();
