# Arbiter Local Runner

Runs the ingest/detect/execute/close pipeline locally, without Vercel crons.

## Setup (What You Need To Configure)

1. Install deps:
```bash
pnpm install
```

2. Create `apps/runner/.env.local` (or reuse `apps/web/.env.local`) with at least:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET` (optional; runner calls jobs directly, but some jobs may still read it)

If you use OpenAI/news features:
- `OPENAI_API_KEY`

3. Run once (good for debugging):
```bash
pnpm runner:once
```

4. Run continuously (10-minute cadence):
```bash
pnpm runner
```

## Notes

- Your machine must stay awake (no sleep/hibernate). Display off is fine.
- To reduce Vercel GB-Hrs, disable Vercel crons in `apps/web/vercel.json` and redeploy.

