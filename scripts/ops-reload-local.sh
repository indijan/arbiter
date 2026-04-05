#!/bin/zsh -l
set -euo pipefail

ROOT_DIR="/Users/indijanmac/Projects/arbiter"
WEB_PLIST="$HOME/Library/LaunchAgents/hu.arbiter.web.plist"
RUNNER_PLIST="$HOME/Library/LaunchAgents/hu.arbiter.runner.plist"

cd "$ROOT_DIR"

uid="$(id -u)"

echo "[ops] stopping launch agents (ignore errors if not loaded)..."
launchctl bootout "gui/${uid}" "$RUNNER_PLIST" 2>/dev/null || true
launchctl bootout "gui/${uid}" "$WEB_PLIST" 2>/dev/null || true

echo "[ops] rebuilding web..."
rm -rf apps/web/.next apps/web/.turbo || true
pnpm -C apps/web build

echo "[ops] starting launch agents..."
launchctl bootstrap "gui/${uid}" "$WEB_PLIST"
launchctl bootstrap "gui/${uid}" "$RUNNER_PLIST"

echo "[ops] done."

