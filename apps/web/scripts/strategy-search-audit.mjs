import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const root = path.resolve(process.cwd(), '../..');
const envPath = path.resolve(process.cwd(), '.env.local');
const outPath = path.resolve(root, '.local-data/strategy-search-audit.json');

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
const avg = (values) => values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
function detailNum(details, keys, fallback = null) { for (const key of keys) if (details?.[key] !== undefined && details?.[key] !== null) return num(details[key], fallback ?? 0); return fallback; }
function maker(row) { return detailNum(row.details, ['maker_net_edge_bps', 'maker_edge_bps', 'net_maker_bps'], num(row.net_edge_bps)); }
function taker(row) { return detailNum(row.details, ['taker_net_edge_bps', 'taker_edge_bps', 'net_taker_bps', 'taker_net_bps'], null) ?? (maker(row) - detailNum(row.details, ['taker_fee_bps', 'estimated_taker_cost_bps'], 3.5)); }
const keyOf = (row) => `${row.exchange}:${row.symbol}`;
const t = (row) => new Date(row.ts).getTime();
function stability(timeline) { const vals = timeline.map(maker).filter(Number.isFinite); if (!vals.length) return 0; const mean = avg(vals); if (mean <= 0) return 0; const range = Math.max(...vals) - Math.min(...vals); return round(Math.max(0, Math.min(100, 100 - (range / mean) * 20)), 1); }
function bucket(value, cuts, labels) { for (let i = 0; i < cuts.length; i++) if (value >= cuts[i]) return labels[i]; return labels.at(-1); }
function exitAt(post, entry, model) {
  if (!post.length) return { exit: entry, reason: 'single_snapshot' };
  const entryNet = taker(entry);
  if (model === 'exit_on_invalidated') { const invalid = post.find((r) => taker(r) <= 0); return { exit: invalid ?? post.at(-1), reason: invalid ? 'signal_invalidated' : 'window_end' }; }
  const fixed = model.match(/^exit_after_(\d+)m$/);
  if (fixed) { const horizon = t(entry) + Number(fixed[1]) * 60_000; return { exit: post.filter((r) => t(r) <= horizon).at(-1) ?? entry, reason: model }; }
  const bracket = model.match(/^tp(\d+)_sl(\d+)$/);
  if (bracket) {
    const tp = Number(bracket[1]); const sl = Number(bracket[2]);
    const tpRow = post.find((r) => taker(r) - entryNet >= tp); const slRow = post.find((r) => taker(r) - entryNet <= -sl);
    const tpTs = tpRow ? t(tpRow) : Infinity; const slTs = slRow ? t(slRow) : Infinity;
    if (tpTs <= slTs && tpRow) return { exit: tpRow, reason: 'take_profit' };
    if (slRow) return { exit: slRow, reason: 'stop_loss' };
    return { exit: post.at(-1), reason: 'window_end' };
  }
  return { exit: post.at(-1), reason: 'window_end' };
}
function summarize(rows) { const total = rows.reduce((s, r) => s + r.pnl_bps, 0); const wins = rows.filter((r) => r.pnl_bps > 0).length; const losses = rows.filter((r) => r.pnl_bps < 0).length; return { trials: rows.length, wins, losses, flat: rows.length - wins - losses, total_pnl_bps: round(total), avg_pnl_bps: rows.length ? round(total / rows.length) : 0, win_rate: rows.length ? round(wins / rows.length, 4) : 0, best_pnl_bps: rows.length ? round(Math.max(...rows.map((r) => r.pnl_bps))) : 0, worst_pnl_bps: rows.length ? round(Math.min(...rows.map((r) => r.pnl_bps))) : 0 }; }
function groupBy(rows, field) { const m = new Map(); for (const r of rows) { const k = r[field]; const a = m.get(k) ?? []; a.push(r); m.set(k, a); } return [...m.entries()].map(([key, arr]) => ({ key, ...summarize(arr) })).sort((a, b) => b.total_pnl_bps - a.total_pnl_bps); }
async function fetchRows(days) { const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(); const all = []; for (let from = 0; ; from += 1000) { const { data, error } = await supabase.from('opportunities').select('id, ts, exchange, symbol, type, net_edge_bps, details').eq('type', 'xarb_spot').gte('ts', since).order('ts', { ascending: true }).range(from, from + 999); if (error) throw error; all.push(...(data ?? [])); if (!data || data.length < 1000) break; } return all; }
function runSearch(rows, label) {
  const grouped = new Map(); for (const row of rows) { const key = keyOf(row); const arr = grouped.get(key) ?? []; arr.push(row); grouped.set(key, arr); }
  const models = ['exit_on_invalidated', 'exit_after_10m', 'exit_after_30m', 'exit_after_60m', 'exit_after_120m', 'tp3_sl3', 'tp5_sl5']; const trials = [];
  for (const [pairKey, timelineRaw] of grouped.entries()) {
    const timeline = timelineRaw.sort((a, b) => t(a) - t(b)); const st = stability(timeline); const persistence = timeline.length; const lifetimeMin = (t(timeline.at(-1)) - t(timeline[0])) / 60000;
    const policies = [
      { policy: 'execution_ready_probe', ok: (r) => taker(r) > 0 && maker(r) > 0 && persistence >= 3 },
      { policy: 'high_stability_70', ok: (r) => taker(r) > 0 && st >= 70 && persistence >= 3 },
      { policy: 'high_taker_5bps', ok: (r) => taker(r) >= 5 && persistence >= 3 },
      { policy: 'high_edge_and_stability', ok: (r) => taker(r) >= 5 && st >= 60 && persistence >= 3 },
      { policy: 'stability_60_plus_probe', ok: (r) => taker(r) > 0 && st >= 60 && persistence >= 3 },
      { policy: 'no_trx_kraken', ok: (r) => taker(r) > 0 && persistence >= 3 && !(r.symbol === 'TRXUSD' && r.exchange === 'kraken_okx') },
      { policy: 'fast_10m_candidate', ok: (r) => taker(r) > 0 && persistence >= 3 && st >= 45 }
    ];
    for (const entry of timeline) for (const p of policies) { if (!p.ok(entry)) continue; const post = timeline.filter((r) => t(r) >= t(entry)); for (const model of models) { if (p.policy === 'fast_10m_candidate' && model !== 'exit_after_10m') continue; const { exit, reason } = exitAt(post, entry, model); trials.push({ window: label, policy: p.policy, model, symbol: entry.symbol, exchange: entry.exchange, pair: pairKey, ts: entry.ts, maker_bps: round(maker(entry)), taker_bps: round(taker(entry)), stability: st, persistence, lifetime_minutes: round(lifetimeMin, 1), edge_bucket: bucket(taker(entry), [10, 5, 2, 0], ['edge_10_plus', 'edge_5_10', 'edge_2_5', 'edge_0_2', 'edge_non_positive']), stability_bucket: bucket(st, [75, 60, 45, 30], ['stability_75_plus', 'stability_60_75', 'stability_45_60', 'stability_30_45', 'stability_under_30']), exit_reason: reason, pnl_bps: round(taker(exit) - taker(entry)) }); } }
  }
  const byPolicyModel = groupBy(trials, 'policy').flatMap((p) => groupBy(trials.filter((t) => t.policy === p.key), 'model').map((m) => ({ policy: p.key, model: m.key, ...m })));
  const promotion = byPolicyModel.filter((r) => r.trials >= 5 && r.total_pnl_bps > 0 && r.win_rate >= 0.25).sort((a, b) => b.total_pnl_bps - a.total_pnl_bps);
  const quarantine = [...groupBy(trials, 'pair').filter((r) => r.trials >= 5 && r.total_pnl_bps < 0).map((r) => ({ type: 'pair', ...r })), ...groupBy(trials, 'symbol').filter((r) => r.trials >= 5 && r.total_pnl_bps < 0).map((r) => ({ type: 'symbol', ...r })), ...groupBy(trials, 'stability_bucket').filter((r) => r.trials >= 5 && r.total_pnl_bps < 0).map((r) => ({ type: 'stability_bucket', ...r }))].sort((a, b) => a.total_pnl_bps - b.total_pnl_bps);
  return { window: label, source_rows: rows.length, pairs: grouped.size, trial_count: trials.length, summary: summarize(trials), by_policy: groupBy(trials, 'policy'), by_policy_model: byPolicyModel.sort((a, b) => b.total_pnl_bps - a.total_pnl_bps).slice(0, 30), by_symbol: groupBy(trials, 'symbol').slice(0, 20), by_pair: groupBy(trials, 'pair').slice(0, 20), by_stability_bucket: groupBy(trials, 'stability_bucket'), promotion_candidates: promotion.slice(0, 10), quarantine_candidates: quarantine.slice(0, 15) };
}
const results = {}; for (const days of [7, 30]) { const rows = await fetchRows(days); results[`${days}d`] = runSearch(rows, `${days}d`); }
fs.mkdirSync(path.dirname(outPath), { recursive: true }); fs.writeFileSync(outPath, JSON.stringify({ generated_at: new Date().toISOString(), results }, null, 2));
for (const [window, r] of Object.entries(results)) { console.log(`\n=== ${window} ===`); console.log('source rows:', r.source_rows, 'pairs:', r.pairs, 'trials:', r.trial_count); console.log('summary:', r.summary); console.log('top policy/model:', r.by_policy_model.slice(0, 8)); console.log('promotion:', r.promotion_candidates.slice(0, 5)); console.log('quarantine:', r.quarantine_candidates.slice(0, 8)); }
console.log(`\nSaved ${outPath}`);
