import fs from "node:fs";
import path from "node:path";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function parseArgs(argv) {
  const args = {
    hours: 6,
    output: "fixtures/xarb-historical-export.json",
    exchanges: ["binance", "bybit", "okx", "coinbase", "kraken"]
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--hours" && argv[i + 1]) {
      args.hours = Number(argv[++i]);
    } else if (arg === "--output" && argv[i + 1]) {
      args.output = argv[++i];
    } else if (arg === "--exchanges" && argv[i + 1]) {
      args.exchanges = argv[++i].split(",").map((item) => item.trim()).filter(Boolean);
    }
  }

  return args;
}

async function fetchRows(hours, exchanges) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const url = new URL(`${SUPABASE_URL}/rest/v1/market_snapshots`);
  url.searchParams.set("select", "ts,exchange,symbol,spot_bid,spot_ask");
  url.searchParams.set("ts", `gte.${since}`);
  url.searchParams.set("exchange", `in.(${exchanges.join(",")})`);
  url.searchParams.set("order", "ts.asc");
  url.searchParams.set("limit", "5000");

  const response = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Supabase export failed: HTTP ${response.status}`);
  }

  return await response.json();
}

async function main() {
  const args = parseArgs(process.argv);
  const rows = await fetchRows(args.hours, args.exchanges);
  const snapshots = rows
    .filter((row) => Number.isFinite(Number(row.spot_bid)) && Number.isFinite(Number(row.spot_ask)))
    .map((row) => ({
      ts: row.ts,
      exchange: row.exchange,
      symbol: row.symbol,
      bid: Number(row.spot_bid),
      ask: Number(row.spot_ask)
    }));

  const output = {
    exported_at: new Date().toISOString(),
    hours: args.hours,
    exchanges: args.exchanges,
    snapshot_count: snapshots.length,
    snapshots
  };

  const fullPath = path.resolve(process.cwd(), args.output);
  fs.writeFileSync(fullPath, JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ output: args.output, snapshot_count: snapshots.length }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
