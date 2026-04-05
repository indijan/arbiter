#!/usr/bin/env bash
set -euo pipefail

# Sync local env files to the home server (MacBook Air / Mac mini).
# This avoids manual scp commands and keeps web+runner env in sync.
#
# Usage:
#   ./scripts/envsync.sh indijan@192.168.1.182
#   ./scripts/envsync.sh indijan@indijan.local
#
# Optional:
#   ARBITER_ROOT=/Users/indijan/Projects/arbiter ./scripts/envsync.sh indijan@192.168.1.182
#   RESTART=1 ./scripts/envsync.sh indijan@192.168.1.182

HOST="${1:-}"
if [[ -z "$HOST" ]]; then
  echo "Usage: $0 <user@host>"
  exit 2
fi

ROOT="${ARBITER_ROOT:-/Users/indijan/Projects/arbiter}"

LOCAL_WEB_ENV="apps/web/.env.local"
LOCAL_RUNNER_ENV="apps/runner/.env.local"

if [[ ! -f "$LOCAL_WEB_ENV" ]]; then
  echo "Missing: $LOCAL_WEB_ENV"
  exit 1
fi
if [[ ! -f "$LOCAL_RUNNER_ENV" ]]; then
  echo "Missing: $LOCAL_RUNNER_ENV"
  exit 1
fi

echo "Syncing env files to $HOST ..."
scp "$LOCAL_WEB_ENV" "$HOST:$ROOT/apps/web/.env.local"
scp "$LOCAL_RUNNER_ENV" "$HOST:$ROOT/apps/runner/.env.local"

echo "OK: env files uploaded."

if [[ "${RESTART:-0}" == "1" ]]; then
  echo "Restarting services via mba.sh ..."
  ssh "$HOST" "cd '$ROOT' && ./scripts/mba.sh stop && ./scripts/mba.sh start && ./scripts/mba.sh status"
fi

echo "done"

