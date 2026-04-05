# Runbook: Dedicated MacBook (Air) Runner + Web

This is the minimal, repeatable setup we converged on (so you don't have to remember it).

## What Runs Where

- `localhost` always means **the machine you're currently on**.
- If the web runs on the MacBook Air at port 3000, you open it from your main machine at:
  - `http://192.168.1.182:3000` (replace with the MacBook Air IP)
  - or `http://indijan.local:3000` (if mDNS works)

## One-Time Setup (MacBook Air)

1. Enable SSH:
   - System Settings -> General -> Sharing -> Remote Login: ON
2. Install Command Line Tools:
   - `xcode-select --install` (may require GUI confirmation)
3. Install Homebrew:
   - `brew` install (standard Homebrew install command)
4. Install Node + pnpm:
   - `brew install node pnpm`
5. Clone + install:
   - `git clone https://github.com/indijan/arbiter.git ~/Projects/arbiter`
   - `cd ~/Projects/arbiter && pnpm install`
6. Approve pnpm build scripts (important):
   - `pnpm approve-builds`
   - enable at least: `esbuild`, `unrs-resolver` (and any `@next/swc-*` if shown)

## Env Files (copy from main machine)

Copy these two files to the MacBook Air:

- `apps/web/.env.local`
- `apps/runner/.env.local`

From your main machine (repo root):

```bash
scp apps/web/.env.local indijan@192.168.1.182:/Users/indijan/Projects/arbiter/apps/web/.env.local
scp apps/runner/.env.local indijan@192.168.1.182:/Users/indijan/Projects/arbiter/apps/runner/.env.local
```

## Start (3 terminals/tabs on MacBook Air)

### 1) Web (Next.js)

Important: `pnpm` argument forwarding can be confusing; this is the reliable command:

```bash
cd /Users/indijan/Projects/arbiter/apps/web
./node_modules/.bin/next dev -p 3000
```

Health check (MacBook Air):

```bash
curl -i http://localhost:3000/health
```

### 2) Runner (calls cron endpoints internally)

```bash
cd /Users/indijan/Projects/arbiter
pnpm -C apps/runner start
```

Note: calling cron manually will usually return 401:

- `curl http://localhost:3000/api/cron/tick` -> `401 Unauthorized` is normal.
- The runner has the secret and will show `cron.*: ok` in logs.

### 3) Prevent sleep

```bash
caffeinate -dimsu
pmset -g assertions | grep -i caffeinate
```

If you see multiple caffeinate PIDs, it's fine but redundant:

```bash
pkill caffeinate
caffeinate -dimsu
```

## Update Code on MacBook Air (safe routine)

When you changed code on your main machine and pushed it:

```bash
cd /Users/indijan/Projects/arbiter
git pull
pnpm install
```

Then restart the processes (web + runner). If you're running them in foreground terminals:
- Ctrl+C and run the start commands again.

## Common Errors

- Next.js started on 3001:
  - something else is on 3000. Find it: `lsof -nP -iTCP:3000 -sTCP:LISTEN`
- `Invalid project directory ... /-p`:
  - happens when passing args through pnpm incorrectly; use `./node_modules/.bin/next dev -p 3000`.

