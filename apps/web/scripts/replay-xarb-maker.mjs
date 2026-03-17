import fs from "node:fs";
import path from "node:path";

const DEFAULT_CONFIG = {
  minSnapshotsPerOpportunity: 2,
  minDetectorNetEdgeBps: 0,
  maxSnapshotSkewSeconds: 20,
  timeBucketSeconds: 30,
  makerFeeBps: 1,
  takerFeeBps: 4,
  takerSlippageBps: 1,
  inventoryBufferBps: 1.5,
  decayToleranceBps: 2,
  entryNetBps: {
    core: 1.25,
    alt: 0.5
  },
  entryGrossBps: {
    core: 8,
    alt: 5
  },
  notionalUsd: 100
};

const CORE_SYMBOLS = new Set(["BTCUSD", "ETHUSD"]);

function parseArgs(argv) {
  const args = {
    fixture: "fixtures/xarb-synthetic-good.json",
    minSnapshots: DEFAULT_CONFIG.minSnapshotsPerOpportunity,
    windows: []
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--fixture" && argv[i + 1]) {
      args.fixture = argv[++i];
    } else if (arg === "--min-snapshots" && argv[i + 1]) {
      args.minSnapshots = Number(argv[++i]);
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

function makerCostsBps(config) {
  return (
    config.makerFeeBps +
    config.takerFeeBps +
    config.takerSlippageBps +
    config.inventoryBufferBps
  );
}

function detectMakerCandidates(snapshots, config) {
  const grouped = new Map();
  for (const snapshot of snapshots) {
    const bucketStartMs =
      Math.floor(Date.parse(snapshot.ts) / (config.timeBucketSeconds * 1000)) *
      config.timeBucketSeconds *
      1000;
    const key = `${new Date(bucketStartMs).toISOString()}__${canonicalSymbol(snapshot.symbol)}`;
    const row = grouped.get(key) ?? [];
    row.push(snapshot);
    grouped.set(key, row);
  }

  const opportunities = [];
  for (const [key, rows] of grouped.entries()) {
    const [ts, symbol] = key.split("__");
    const validRows = rows.filter(
      (row) =>
        Number.isFinite(row.bid) &&
        Number.isFinite(row.ask) &&
        row.bid > 0 &&
        row.ask > row.bid
    );

    if (validRows.length < 2) continue;

    const times = validRows.map((row) => Date.parse(row.ts) / 1000);
    const ageSpread = Math.max(...times) - Math.min(...times);
    if (ageSpread > config.maxSnapshotSkewSeconds) continue;

    const buy = validRows.reduce((min, row) => (row.ask < min.ask ? row : min));
    const sell = validRows.reduce((max, row) => (row.bid > max.bid ? row : max));
    if (buy.exchange === sell.exchange) continue;

    const grossEdgeBps = ((sell.bid - buy.ask) / buy.ask) * 10000;
    const netEdgeBps = grossEdgeBps - makerCostsBps(config);
    if (netEdgeBps < config.minDetectorNetEdgeBps) continue;

    opportunities.push({
      ts,
      symbol,
      exchange: [buy.exchange, sell.exchange].sort().join("_"),
      buy_exchange: buy.exchange,
      sell_exchange: sell.exchange,
      gross_edge_bps: Number(grossEdgeBps.toFixed(4)),
      net_edge_bps: Number(netEdgeBps.toFixed(4))
    });
  }

  return opportunities.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}

function executeMakerXarb(opportunities, config) {
  const persistence = new Map();
  const opens = [];
  let rejected = 0;

  for (const opportunity of opportunities) {
    const key = `${opportunity.symbol}:${opportunity.exchange}:${opportunity.buy_exchange}:${opportunity.sell_exchange}`;
    const history = persistence.get(key) ?? [];
    history.push(opportunity);
    if (history.length > config.minSnapshotsPerOpportunity) history.shift();
    persistence.set(key, history);

    const isCore = CORE_SYMBOLS.has(opportunity.symbol);
    const minNet = isCore ? config.entryNetBps.core : config.entryNetBps.alt;
    const minGross = isCore ? config.entryGrossBps.core : config.entryGrossBps.alt;

    if (history.length < config.minSnapshotsPerOpportunity) {
      rejected += 1;
      continue;
    }

    const avgNet =
      history.reduce((sum, item) => sum + item.net_edge_bps, 0) / history.length;
    const avgGross =
      history.reduce((sum, item) => sum + item.gross_edge_bps, 0) / history.length;
    const grossDecay = avgGross - opportunity.gross_edge_bps;
    const netDecay = avgNet - opportunity.net_edge_bps;

    if (
      avgNet < minNet ||
      avgGross < minGross ||
      grossDecay > config.decayToleranceBps ||
      netDecay > config.decayToleranceBps
    ) {
      rejected += 1;
      continue;
    }

    const pnlUsd = (avgNet / 10000) * config.notionalUsd;
    opens.push({
      opened_at: opportunity.ts,
      symbol: opportunity.symbol,
      exchange: opportunity.exchange,
      mode: "maker_assisted",
      avg_net_edge_bps: Number(avgNet.toFixed(4)),
      avg_gross_edge_bps: Number(avgGross.toFixed(4)),
      notional_usd: config.notionalUsd,
      expected_pnl_usd: Number(pnlUsd.toFixed(4))
    });
    persistence.delete(key);
  }

  const pnlTotal = opens.reduce((sum, open) => sum + open.expected_pnl_usd, 0);
  const pairStats = new Map();

  for (const open of opens) {
    const key = `${open.symbol}:${open.exchange}`;
    const row = pairStats.get(key) ?? {
      symbol: open.symbol,
      exchange: open.exchange,
      open_count: 0,
      pnl_total_usd: 0
    };
    row.open_count += 1;
    row.pnl_total_usd += open.expected_pnl_usd;
    pairStats.set(key, row);
  }

  const pair_ranking = Array.from(pairStats.values())
    .map((row) => ({
      ...row,
      pnl_total_usd: Number(row.pnl_total_usd.toFixed(4)),
      expectancy_usd: Number((row.pnl_total_usd / row.open_count).toFixed(4))
    }))
    .sort((a, b) => {
      if (b.pnl_total_usd !== a.pnl_total_usd) return b.pnl_total_usd - a.pnl_total_usd;
      return b.open_count - a.open_count;
    });

  return {
    opens,
    pair_ranking,
    summary: {
      candidate_count: opportunities.length,
      rejected_count: rejected,
      open_count: opens.length,
      pnl_total_usd: Number(pnlTotal.toFixed(4)),
      expectancy_usd: Number((opens.length > 0 ? pnlTotal / opens.length : 0).toFixed(4))
    }
  };
}

function scoreGoLive(summary) {
  if (summary.open_count === 0) return 0;
  let score = 40;
  if (summary.pnl_total_usd > 0) score += 20;
  if (summary.expectancy_usd > 0.02) score += 20;
  if (summary.open_count >= 3) score += 10;
  if (summary.open_count >= 5) score += 10;
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
  const config = {
    ...DEFAULT_CONFIG,
    minSnapshotsPerOpportunity: args.minSnapshots
  };

  const windows = args.windows.length > 0 ? args.windows : [null];
  const results = windows.map((windowHours) => {
    const snapshots = filterSnapshotsByHours(fixture.snapshots, windowHours);
    const opportunities = detectMakerCandidates(snapshots, config);
    const result = executeMakerXarb(opportunities, config);
    return {
      window_hours: windowHours,
      snapshot_count: snapshots.length,
      go_live_score: scoreGoLive(result.summary),
      summary: result.summary,
      pair_ranking: result.pair_ranking,
      sample_opportunities: opportunities.slice(0, 10),
      opens: result.opens
    };
  });

  console.log(
    JSON.stringify(
      {
        fixture: args.fixture,
        config,
        results
      },
      null,
      2
    )
  );
}

main();
