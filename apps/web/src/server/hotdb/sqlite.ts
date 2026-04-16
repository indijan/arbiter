import "server-only";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

type HotSnapshotRow = {
  ts: string;
  exchange: string;
  symbol: string;
  spot_bid: number | null;
  spot_ask: number | null;
  perp_bid?: number | null;
  perp_ask?: number | null;
  funding_rate?: number | null;
  mark_price?: number | null;
  index_price?: number | null;
};

type RecentSpotSnapshotRow = {
  ts: string;
  exchange: string;
  symbol: string;
  spot_bid: number | null;
  spot_ask: number | null;
};

const HOT_DB_RETENTION_HOURS = Number(process.env.HOT_DB_RETENTION_HOURS ?? 12);
const HOT_DB_PATH =
  process.env.ARBITER_HOT_DB_PATH ?? path.join(os.homedir(), ".arbiter", "data", "hot.db");

let dbInstance: DatabaseSync | null = null;
let dbInitFailed = false;

function getDb() {
  if (dbInitFailed) return null;
  if (dbInstance) return dbInstance;

  try {
    fs.mkdirSync(path.dirname(HOT_DB_PATH), { recursive: true });
    const db = new DatabaseSync(HOT_DB_PATH);
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS market_snapshots_recent (
        ts TEXT NOT NULL,
        exchange TEXT NOT NULL,
        symbol TEXT NOT NULL,
        spot_bid REAL,
        spot_ask REAL,
        perp_bid REAL,
        perp_ask REAL,
        funding_rate REAL,
        mark_price REAL,
        index_price REAL
      );
      CREATE INDEX IF NOT EXISTS idx_market_snapshots_recent_exchange_symbol_ts
        ON market_snapshots_recent(exchange, symbol, ts);
      CREATE INDEX IF NOT EXISTS idx_market_snapshots_recent_ts
        ON market_snapshots_recent(ts);
    `);

    dbInstance = db;
    return db;
  } catch {
    dbInitFailed = true;
    return null;
  }
}

export function writeHotSnapshots(rows: HotSnapshotRow[]) {
  if (rows.length === 0) return;

  const db = getDb();
  if (!db) return;
  const insert = db.prepare(`
    INSERT INTO market_snapshots_recent (
      ts, exchange, symbol, spot_bid, spot_ask, perp_bid, perp_ask, funding_rate, mark_price, index_price
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const purge = db.prepare(`DELETE FROM market_snapshots_recent WHERE ts < ?`);
  const retentionFloor = new Date(Date.now() - HOT_DB_RETENTION_HOURS * 60 * 60 * 1000).toISOString();

  db.exec("BEGIN");
  try {
    for (const row of rows) {
      insert.run(
        row.ts,
        row.exchange,
        row.symbol,
        row.spot_bid,
        row.spot_ask,
        row.perp_bid ?? null,
        row.perp_ask ?? null,
        row.funding_rate ?? null,
        row.mark_price ?? null,
        row.index_price ?? null
      );
    }
    purge.run(retentionFloor);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function readRecentSpotSnapshots(args: {
  exchange: string;
  symbols: string[];
  since: string;
}): RecentSpotSnapshotRow[] {
  if (args.symbols.length === 0) return [];

  const db = getDb();
  if (!db) return [];
  const placeholders = args.symbols.map(() => "?").join(", ");
  const stmt = db.prepare(`
    SELECT ts, exchange, symbol, spot_bid, spot_ask
    FROM market_snapshots_recent
    WHERE exchange = ?
      AND symbol IN (${placeholders})
      AND ts >= ?
    ORDER BY ts ASC
  `);

  return stmt.all(args.exchange, ...args.symbols, args.since) as RecentSpotSnapshotRow[];
}

export function getHotDbPath() {
  return HOT_DB_PATH;
}
