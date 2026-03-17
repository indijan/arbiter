import fs from "node:fs";
import path from "node:path";

const DEFAULT_CONFIG = {
  holdingHours: 24,
  minFundingDailyBps: 4,
  minNetEdgeBps: 6,
  feeBpsTotal: 6,
  slippageBpsTotal: 4,
  latencyBufferBps: 2,
  liveCarryBufferBps: 3,
  minHoldHours: 4,
  takeProfitPct: 0.008,
  stopLossPct: 0.006,
  notionalUsd: 100,
  timeBucketSeconds: 60
};

function parseArgs(argv) {
  const args = {
    fixture: "fixtures/carry-synthetic-good.json",
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

function loadFixture(fixturePath) {
  const fullPath = path.resolve(process.cwd(), fixturePath);
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

function costsBps(config) {
  return config.feeBpsTotal + config.slippageBpsTotal + config.latencyBufferBps;
}

function bucketSnapshots(snapshots, config) {
  const grouped = new Map();
  for (const snapshot of snapshots) {
    const bucketStartMs =
      Math.floor(Date.parse(snapshot.ts) / (config.timeBucketSeconds * 1000)) *
      config.timeBucketSeconds *
      1000;
    const ts = new Date(bucketStartMs).toISOString();
    const key = `${ts}:${snapshot.exchange}:${snapshot.symbol}`;
    grouped.set(key, { ...snapshot, ts });
  }

  return Array.from(grouped.values()).sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}

function detectCarry(snapshot, config) {
  const basisBps = ((snapshot.perp_bid - snapshot.spot_ask) / snapshot.spot_ask) * 10000;
  const fundingDailyBps = snapshot.funding_rate * 3 * 10000;
  const expectedHoldingBps = fundingDailyBps * (config.holdingHours / 24);
  const grossEdgeBps = basisBps + expectedHoldingBps;
  const netEdgeBps = grossEdgeBps - costsBps(config);

  if (fundingDailyBps <= 0) {
    return { decision: "skip", reason: "non_positive_funding", basisBps, fundingDailyBps, netEdgeBps };
  }
  if (fundingDailyBps < config.minFundingDailyBps) {
    return { decision: "skip", reason: "funding_too_low", basisBps, fundingDailyBps, netEdgeBps };
  }
  if (netEdgeBps < config.minNetEdgeBps) {
    return { decision: "skip", reason: "below_net_edge", basisBps, fundingDailyBps, netEdgeBps };
  }

  return {
    decision: "open",
    reason: "open",
    basisBps: Number(basisBps.toFixed(4)),
    fundingDailyBps: Number(fundingDailyBps.toFixed(4)),
    expectedHoldingBps: Number(expectedHoldingBps.toFixed(4)),
    grossEdgeBps: Number(grossEdgeBps.toFixed(4)),
    netEdgeBps: Number(netEdgeBps.toFixed(4))
  };
}

function evaluateClose(position, snapshot, config) {
  const spotMid = (snapshot.spot_bid + snapshot.spot_ask) / 2;
  const perpMid = (snapshot.perp_bid + snapshot.perp_ask) / 2;
  const liveBasisBps = ((perpMid - spotMid) / spotMid) * 10000;
  const fundingDailyBps = snapshot.funding_rate * 3 * 10000;
  const expectedHoldingBps = fundingDailyBps * (config.holdingHours / 24);
  const liveNetEdgeBps = liveBasisBps + expectedHoldingBps - costsBps(config) - config.liveCarryBufferBps;

  const spotPnl = position.spotQty * (snapshot.spot_bid - position.entrySpotPrice);
  const perpPnl = position.perpQty * (snapshot.perp_ask - position.entryPerpPrice);
  const unrealizedPnlUsd = spotPnl + perpPnl;
  const holdHours = (Date.parse(snapshot.ts) - Date.parse(position.entryTs)) / (60 * 60 * 1000);
  const pnlPct = unrealizedPnlUsd / position.notionalUsd;

  const shouldClose =
    holdHours >= config.minHoldHours &&
    (
      pnlPct >= config.takeProfitPct ||
      pnlPct <= -config.stopLossPct ||
      fundingDailyBps <= 0 ||
      liveNetEdgeBps < 0
    );

  return {
    holdHours: Number(holdHours.toFixed(4)),
    liveBasisBps: Number(liveBasisBps.toFixed(4)),
    fundingDailyBps: Number(fundingDailyBps.toFixed(4)),
    liveNetEdgeBps: Number(liveNetEdgeBps.toFixed(4)),
    unrealizedPnlUsd: Number(unrealizedPnlUsd.toFixed(4)),
    shouldClose
  };
}

function replayCarry(snapshots, config) {
  const opens = [];
  const closes = [];
  const rejections = [];
  const openPositions = new Map();

  for (const snapshot of snapshots) {
    const key = `${snapshot.exchange}:${snapshot.symbol}`;
    const existing = openPositions.get(key);

    if (existing) {
      const closeEval = evaluateClose(existing, snapshot, config);
      if (closeEval.shouldClose) {
        closes.push({
          exchange: snapshot.exchange,
          symbol: snapshot.symbol,
          entry_ts: existing.entryTs,
          exit_ts: snapshot.ts,
          hold_hours: closeEval.holdHours,
          realized_pnl_usd: closeEval.unrealizedPnlUsd,
          live_net_edge_bps: closeEval.liveNetEdgeBps
        });
        openPositions.delete(key);
      }
      continue;
    }

    const detection = detectCarry(snapshot, config);
    if (detection.decision !== "open") {
      rejections.push({
        ts: snapshot.ts,
        exchange: snapshot.exchange,
        symbol: snapshot.symbol,
        reason: detection.reason,
        funding_daily_bps: Number(detection.fundingDailyBps?.toFixed?.(4) ?? detection.fundingDailyBps ?? 0),
        net_edge_bps: Number(detection.netEdgeBps?.toFixed?.(4) ?? detection.netEdgeBps ?? 0)
      });
      continue;
    }

    const spotQty = config.notionalUsd / snapshot.spot_ask;
    const perpQty = -(config.notionalUsd / snapshot.perp_bid);
    const openPosition = {
      entryTs: snapshot.ts,
      exchange: snapshot.exchange,
      symbol: snapshot.symbol,
      entrySpotPrice: snapshot.spot_ask,
      entryPerpPrice: snapshot.perp_bid,
      spotQty,
      perpQty,
      notionalUsd: config.notionalUsd,
      netEdgeBps: detection.netEdgeBps,
      fundingDailyBps: detection.fundingDailyBps
    };
    openPositions.set(key, openPosition);
    opens.push({
      ts: snapshot.ts,
      exchange: snapshot.exchange,
      symbol: snapshot.symbol,
      net_edge_bps: detection.netEdgeBps,
      funding_daily_bps: detection.fundingDailyBps,
      basis_bps: detection.basisBps
    });
  }

  const pairStats = new Map();
  for (const close of closes) {
    const key = `${close.exchange}:${close.symbol}`;
    const row = pairStats.get(key) ?? {
      exchange: close.exchange,
      symbol: close.symbol,
      closed_count: 0,
      pnl_total_usd: 0
    };
    row.closed_count += 1;
    row.pnl_total_usd += close.realized_pnl_usd;
    pairStats.set(key, row);
  }

  const pairRanking = Array.from(pairStats.values())
    .map((row) => ({
      ...row,
      pnl_total_usd: Number(row.pnl_total_usd.toFixed(4)),
      expectancy_usd: Number((row.pnl_total_usd / row.closed_count).toFixed(4))
    }))
    .sort((a, b) => {
      if (b.expectancy_usd !== a.expectancy_usd) return b.expectancy_usd - a.expectancy_usd;
      return b.closed_count - a.closed_count;
    });

  const rejectionCounts = rejections.reduce((acc, item) => {
    acc[item.reason] = (acc[item.reason] ?? 0) + 1;
    return acc;
  }, {});

  const pnlTotal = closes.reduce((sum, row) => sum + row.realized_pnl_usd, 0);

  return {
    opens,
    closes,
    pair_ranking: pairRanking,
    summary: {
      snapshot_count: snapshots.length,
      open_count: opens.length,
      closed_count: closes.length,
      open_positions: openPositions.size,
      pnl_total_usd: Number(pnlTotal.toFixed(4)),
      expectancy_usd: Number((closes.length > 0 ? pnlTotal / closes.length : 0).toFixed(4)),
      rejection_counts: rejectionCounts
    }
  };
}

function scoreGoLive(summary) {
  if (summary.closed_count === 0) return 0;
  let score = 35;
  if (summary.pnl_total_usd > 0) score += 25;
  if (summary.expectancy_usd > 0.02) score += 20;
  if (summary.closed_count >= 2) score += 10;
  if (summary.closed_count >= 5) score += 10;
  return Math.max(0, Math.min(100, score));
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
    const filtered = filterSnapshotsByHours(fixture.snapshots, windowHours);
    const bucketed = bucketSnapshots(filtered, DEFAULT_CONFIG);
    const result = replayCarry(bucketed, DEFAULT_CONFIG);
    return {
      window_hours: windowHours,
      go_live_score: scoreGoLive(result.summary),
      summary: result.summary,
      pair_ranking: result.pair_ranking,
      sample_opens: result.opens.slice(0, 10),
      sample_closes: result.closes.slice(0, 10)
    };
  });

  console.log(
    JSON.stringify(
      {
        fixture: args.fixture,
        config: DEFAULT_CONFIG,
        results
      },
      null,
      2
    )
  );
}

main();
