# Vercel Live Checklist (arbiter-web)

Project:
- team: `indijans-projects`
- project: `arbiter-web`

## Required env vars

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET`

## Cron

Configured in `apps/web/vercel.json`:
- `*/10 * * * *` -> `/api/cron/tick`

Route auth behavior:
- Vercel cron user-agent is accepted automatically.
- Manual trigger requires `x-cron-secret` header (or `?secret=`) matching `CRON_SECRET`.

## Post-deploy quick test

1. Open `/dashboard`
2. Open `/api/report/export?type=latest`
3. Trigger tick manually once with secret and verify new row in `system_ticks`
