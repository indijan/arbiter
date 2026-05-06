import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const root = path.resolve(process.cwd(), '../..');
const envPath = path.resolve(process.cwd(), '.env.local');
const outPath = path.resolve(root, '.local-data/bps-spike-analysis.json');

function loadEnv(file) {
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] ??= value;
  }
}

loadEnv(envPath);
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const num = (v, fallback = 0) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };
const round = (n, digits = 4) => Number(n.toFixed(digits));
const t = (row) => new Date(row.ts).getTime();
const avg = (values) => values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
function detailNum(details, keys, fallback = null) { for (const key of keys) if (details?.[key] !== undefined && details?.[key] !== null) return num(details[key], fallback ?? 0); return fallback; }
function maker(row) { return detailNum(row.details, ['maker_net_edge_bps', 'maker_edge_bps', 'net_maker_bps'], num(row.net_edge_bps)); }
function taker(row) { return detailNum(row.details, ['taker_net_edge_bps', 'taker_edge_bps', 'net_taker_bps', 'taker_net_bps'], null) ?? (maker(row) - detailNum(row.details, ['taker_fee_bps', 'estimated_taker_cost_bps'], 3.5)); }
function keyOf(row) { return `${row.exchange}:${row.symbol}`; }
function summarize(rows) { const total = rows.reduce((s, r) => s + r.pnl_bps, 0); const wins = rows.filter((r) => r.pnl_bps > 0).length; const losses = rows.filter((r) => r.pnl_bps < 0).length; return { trials: rows.length, wins, losses, flat: rows.length - wins - losses, total_pnl_bps: round(total), avg_pnl_bps: rows.length ? round(total / rows.length) : 0, win_rate: rows.length ? round(wins / rows.length, 4) : 0, best_pnl_bps: rows.length ? round(Math.max(...rows.map((r) => r.pnl_bps))) : 0, worst_pnl_bps: rows.length ? round(Math.min(...rows.map((r) => r.pnl_bps))) : 0 }; }
function groupBy(rows, field) { const m = new Map(); for (const r of rows) { const k = r[field]; const a = m.get(k) ?? []; a.push(r); m.set(k, a); } return [...m.entries()].map(([key, arr]) => ({ key, ...summarize(arr) })).sort((a, b) => b.total_pnl_bps - a.total_pnl_bps); }
async function fetchRows(days) { const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(); const all = []; for (let from = 0; ; from += 1000) { const { data, error } = await supabase.from('opportunities').select('id, ts, exchange, symbol, type, net_edge_bps, details').eq('type', 'xarb_spot').gte('ts', since).order('ts', { ascending: true }).range(from, from + 999); if (error) throw error; all.push(...(data ?? [])); if (!data || data.length < 1000) break; } return all; }
function runLowerThresholdSearch(rows) {
  const grouped = new Map();
  for (const row of rows) { const k = keyOf(row); const a = grouped.get(k) ?? []; a.push(row); grouped.set(k, a); }
  const trials = [];
  const thresholds = [1, 2, 3, 4, 5, 8];
  for (const [pair, raw] of grouped.entries()) {
    const timeline = raw.slice().sort((a, b) => t(a) - t(b));
    const persistence = timeline.length;
    for (const entry of timeline) {
      const entryNet = taker(entry);
      const post = timeline.filter((r) => t(r) >= t(entry));
      for (const threshold of thresholds) {
        if (entryNet < threshold || persistence < 3) continue;
        for (const [tp, sl] of [[1, 1], [2, 2], [3, 3], [5, 5], [8, 5]]) {
          const tpRow = post.find((r) => entryNet - taker(r) >= tp);
          const slRow = post.find((r) => entryNet - taker(r) <= -sl);
          const tpTs = tpRow ? t(tpRow) : Infinity;
          const slTs = slRow ? t(slRow) : Infinity;
          const exit = tpTs <= slTs ? tpRow : slRow;
          const finalExit = exit ?? post.at(-1) ?? entry;
          trials.push({
            threshold_bps: threshold,
            model: `mr_tp${tp}_sl${sl}`,
            symbol: entry.symbol,
            exchange: entry.exchange,
            pair,
            ts: entry.ts,
            entry_taker_bps: round(entryNet),
            exit_taker_bps: round(taker(finalExit)),
            pnl_bps: round(entryNet - taker(finalExit))
          });
        }
      }
    }
  }
  const byThresholdModel = [];
  for (const threshold of thresholds) {
    const rowsForThreshold = trials.filter((r) => r.threshold_bps === threshold);
    for (const row of groupBy(rowsForThreshold, 'model')) byThresholdModel.push({ threshold_bps: threshold, model: row.key, ...row });
  }
  return { trials, by_threshold_model: byThresholdModel.sort((a, b) => b.total_pnl_bps - a.total_pnl_bps), by_symbol: groupBy(trials, 'symbol'), by_pair: groupBy(trials, 'pair') };
}
function volatilityAround(rows, spike) {
  const window = rows.filter((row) => row.symbol === spike.symbol && Math.abs(t(row) - t(spike)) <= 60 * 60 * 1000).sort((a, b) => t(a) - t(b));
  const values = window.map(taker);
  return {
    rows_in_60m_same_symbol: window.length,
    taker_min_60m: values.length ? round(Math.min(...values)) : null,
    taker_max_60m: values.length ? round(Math.max(...values)) : null,
    taker_range_60m: values.length ? round(Math.max(...values) - Math.min(...values)) : null,
    nearby_pairs: [...new Set(window.map((row) => keyOf(row)))].slice(0, 8)
  };
}
const rows = await fetchRows(30);
const topSpikes = rows.slice().sort((a, b) => taker(b) - taker(a)).slice(0, 12).map((row) => ({
  ts: row.ts,
  symbol: row.symbol,
  exchange: row.exchange,
  pair: keyOf(row),
  taker_bps: round(taker(row)),
  maker_bps: round(maker(row)),
  net_edge_bps: round(num(row.net_edge_bps)),
  buy_exchange: row.details?.buy_exchange ?? null,
  sell_exchange: row.details?.sell_exchange ?? null,
  buy_ask: row.details?.buy_ask ?? null,
  sell_bid: row.details?.sell_bid ?? null,
  gross_edge_bps: row.details?.gross_edge_bps ?? null,
  detail_keys: Object.keys(row.details ?? {}).sort(),
  context: volatilityAround(rows, row)
}));
const lower = runLowerThresholdSearch(rows);
const result = {
  generated_at: new Date().toISOString(),
  source_rows: rows.length,
  top_spikes: topSpikes,
  lower_threshold_summary: lower.by_threshold_model.slice(0, 40),
  lower_threshold_by_symbol: lower.by_symbol.slice(0, 20),
  lower_threshold_by_pair: lower.by_pair.slice(0, 20)
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
console.log('source rows:', result.source_rows);
console.log('\nTop spikes:');
console.log(result.top_spikes.slice(0, 8));
console.log('\nLower threshold top models:');
console.log(result.lower_threshold_summary.slice(0, 20));
console.log('\nLower threshold by symbol:');
console.log(result.lower_threshold_by_symbol.slice(0, 12));
console.log(`\nSaved ${outPath}`);
