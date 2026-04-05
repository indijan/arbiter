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
- `CRON_SECRET` (required; runner calls the local `/api/cron/*` endpoints)
- `RUNNER_BASE_URL=http://localhost:3000` (optional; defaults to this)

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
- You must run the web server locally in parallel:
```bash
pnpm -C apps/web dev
```
- To reduce Vercel GB-Hrs, disable Vercel crons in `apps/web/vercel.json` and redeploy.

## macOS: Run 24/7 with launchd (Recommended)

1. Build the web app once:
```bash
pnpm -C apps/web build
```

2. Copy the launch agents:
```bash
mkdir -p ~/Library/LaunchAgents
cp apps/runner/launchd/hu.arbiter.web.plist ~/Library/LaunchAgents/
cp apps/runner/launchd/hu.arbiter.runner.plist ~/Library/LaunchAgents/
```

3. Load them (newer macOS):
```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/hu.arbiter.web.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/hu.arbiter.runner.plist
```

4. Logs:
- `~/Library/Logs/arbiter-web.log`
- `~/Library/Logs/arbiter-runner.log`

To stop:
```bash
launchctl bootout gui/$(id -u) hu.arbiter.runner
launchctl bootout gui/$(id -u) hu.arbiter.web
```
