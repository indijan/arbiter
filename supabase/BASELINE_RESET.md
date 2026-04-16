# Supabase Baseline Reset (Watcher-First)

This repo now uses a single schema baseline migration:

- `supabase/migrations/20260416000100_watcher_baseline.sql`

## Safe reset order

1. Backup production DB.
2. Run cleanup SQL manually if the DB still contains legacy tables:
   - `docs/db-cleanup-phase3.sql`
3. Apply baseline migration on a clean database (or after cleanup).
4. Trigger one cron tick (`/api/cron/tick`) and verify:
   - `system_ticks` has a fresh row
   - `market_snapshots` receives ingest data
   - `opportunities` receives strategy outputs

## Notes

- No additional migration is required for the current watcher-first architecture.
- If schema changes later, add new incremental migration files after this baseline.
