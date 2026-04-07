#!/usr/bin/env bash
set -euo pipefail

# MacBook Air helper for running arbiter "headless" without keeping SSH tabs open.
# Uses nohup + PID files under ~/.arbiter.

ROOT_DIR="${ROOT_DIR:-/Users/indijan/Projects/arbiter}"
STATE_DIR="${STATE_DIR:-$HOME/.arbiter}"
PID_DIR="$STATE_DIR/pids"
LOG_DIR="$STATE_DIR/logs"

ensure_path() {
  # When started via nohup / non-login shells, macOS often misses Homebrew paths.
  # This makes `node`, `pnpm`, etc. reliably available.
  export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
}

WEB_PID="$PID_DIR/web.pid"
RUNNER_PID="$PID_DIR/runner.pid"
CAFF_PID="$PID_DIR/caffeinate.pid"

WEB_LOG_OUT="$LOG_DIR/web.out.log"
WEB_LOG_ERR="$LOG_DIR/web.err.log"
RUNNER_LOG_OUT="$LOG_DIR/runner.out.log"
RUNNER_LOG_ERR="$LOG_DIR/runner.err.log"

mkdir -p "$PID_DIR" "$LOG_DIR"

is_running() {
  local pid="$1"
  if [[ -z "${pid}" ]]; then return 1; fi
  kill -0 "$pid" >/dev/null 2>&1
}

read_pid() {
  local file="$1"
  if [[ -f "$file" ]]; then cat "$file" 2>/dev/null || true; fi
}

write_pid() {
  local file="$1" pid="$2"
  printf "%s" "$pid" >"$file"
}

start_web() {
  ensure_path
  local pid
  pid="$(read_pid "$WEB_PID")"
  if is_running "$pid"; then
    echo "web already running pid=$pid"
    return 0
  fi
  echo "starting web..."
  (
    cd "$ROOT_DIR/apps/web"
    nohup ./node_modules/.bin/next start -H 0.0.0.0 -p 3000 >"$WEB_LOG_OUT" 2>"$WEB_LOG_ERR" &
    local p="$!"
    write_pid "$WEB_PID" "$p"
    sleep 1
    if ! kill -0 "$p" >/dev/null 2>&1; then
      rm -f "$WEB_PID" 2>/dev/null || true
      echo "web failed to start (see $WEB_LOG_ERR)"
      exit 1
    fi
  )
  echo "web started pid=$(read_pid "$WEB_PID")"
}

start_runner() {
  ensure_path
  local pid
  pid="$(read_pid "$RUNNER_PID")"
  if is_running "$pid"; then
    echo "runner already running pid=$pid"
    return 0
  fi
  echo "starting runner..."
  (
    cd "$ROOT_DIR/apps/runner"
    nohup node --experimental-strip-types src/index.ts >"$RUNNER_LOG_OUT" 2>"$RUNNER_LOG_ERR" &
    local p="$!"
    write_pid "$RUNNER_PID" "$p"
    sleep 0.5
    if ! kill -0 "$p" >/dev/null 2>&1; then
      rm -f "$RUNNER_PID" 2>/dev/null || true
      echo "runner failed to start (see $RUNNER_LOG_ERR)"
      exit 1
    fi
  )
  echo "runner started pid=$(read_pid "$RUNNER_PID")"
}

start_caffeinate() {
  ensure_path
  local pid
  pid="$(read_pid "$CAFF_PID")"
  if is_running "$pid"; then
    echo "caffeinate already running pid=$pid"
    return 0
  fi
  echo "starting caffeinate..."
  nohup caffeinate -dimsu >/dev/null 2>&1 &
  write_pid "$CAFF_PID" "$!"
  echo "caffeinate started pid=$(read_pid "$CAFF_PID")"
}

stop_one() {
  local name="$1" file="$2"
  local pid
  pid="$(read_pid "$file")"
  if ! is_running "$pid"; then
    echo "$name not running"
    rm -f "$file" 2>/dev/null || true
    return 0
  fi
  echo "stopping $name pid=$pid"
  kill "$pid" >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if ! is_running "$pid"; then break; fi
    sleep 0.2
  done
  if is_running "$pid"; then
    echo "$name still running, sending SIGKILL"
    kill -9 "$pid" >/dev/null 2>&1 || true
  fi
  rm -f "$file" 2>/dev/null || true
}

cmd_start() {
  start_caffeinate
  start_web
  start_runner
  echo "ok"
}

cmd_stop() {
  stop_one "runner" "$RUNNER_PID"
  stop_one "web" "$WEB_PID"
  stop_one "caffeinate" "$CAFF_PID"
  echo "ok"
}

cmd_stop_services() {
  stop_one "runner" "$RUNNER_PID"
  stop_one "web" "$WEB_PID"
}

cmd_start_services() {
  start_web
  start_runner
}

cmd_status() {
  local wp rp cp
  wp="$(read_pid "$WEB_PID")"
  rp="$(read_pid "$RUNNER_PID")"
  cp="$(read_pid "$CAFF_PID")"

  if is_running "$wp"; then echo "web: running pid=$wp"; else echo "web: stopped"; fi
  if is_running "$rp"; then echo "runner: running pid=$rp"; else echo "runner: stopped"; fi
  if is_running "$cp"; then echo "caffeinate: running pid=$cp"; else echo "caffeinate: stopped"; fi

  echo "logs:"
  echo "  $WEB_LOG_ERR"
  echo "  $RUNNER_LOG_OUT"
}

cmd_update() {
  ensure_path
  echo "updating repo (safe)..."
  cd "$ROOT_DIR"
  local prev_rev
  prev_rev="$(git rev-parse HEAD 2>/dev/null || true)"

  # Only restart if update succeeded.
  git pull --ff-only
  pnpm install
  pnpm -C apps/web build

  echo "restarting services..."
  cmd_stop_services || true
  set +e
  cmd_start_services
  local start_rc=$?
  set -e

  if [[ "$start_rc" -ne 0 ]]; then
    echo "start failed after update; retrying once..."
    set +e
    cmd_start_services
    start_rc=$?
    set -e
  fi

  # Quick health check so we don't silently end up "stopped".
  sleep 0.5
  local wp rp
  wp="$(read_pid "$WEB_PID")"
  rp="$(read_pid "$RUNNER_PID")"
  if ! is_running "$wp" || ! is_running "$rp"; then
    echo "update finished but services did not come up cleanly"
    echo "previous git rev was: ${prev_rev}"
    echo "check logs: $WEB_LOG_ERR , $RUNNER_LOG_ERR"
    # Best-effort: try to bring them back up so UI doesn't stay dead.
    set +e
    cmd_start_services
    set -e
    exit 1
  fi
}

cmd_logs() {
  echo "web.err (tail):"
  tail -n 40 "$WEB_LOG_ERR" 2>/dev/null || true
  echo
  echo "runner.out (tail):"
  tail -n 60 "$RUNNER_LOG_OUT" 2>/dev/null || true
}

required_vars() {
  cat <<'EOF'
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
CRON_SECRET
EOF
}

check_env_file() {
  local file="$1" label="$2"
  echo "$label: $file"
  if [[ ! -f "$file" ]]; then
    echo "  MISSING"
    return 1
  fi

  local missing=0
  while IFS= read -r key; do
    [[ -z "$key" ]] && continue
    if ! grep -Eq "^${key}=" "$file"; then
      echo "  missing: $key"
      missing=1
    fi
  done < <(required_vars)

  if ! grep -Eq "^PAPER_ALLOWED_SYMBOLS=" "$file"; then
    echo "  missing: PAPER_ALLOWED_SYMBOLS (recommended)"
  fi

  if [[ "$missing" -eq 0 ]]; then
    echo "  OK (required keys present)"
  fi
}

cmd_envcheck() {
  echo "envcheck (does not print secret values)"
  check_env_file "$ROOT_DIR/apps/web/.env.local" "web"
  check_env_file "$ROOT_DIR/apps/runner/.env.local" "runner"
  echo "done"
}

usage() {
  cat <<EOF
Usage: $0 <start|stop|status|update|logs|envcheck>

Env:
  ROOT_DIR=/Users/indijan/Projects/arbiter   (override if your repo is elsewhere)
EOF
}

case "${1:-}" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  status) cmd_status ;;
  update) cmd_update ;;
  logs) cmd_logs ;;
  envcheck) cmd_envcheck ;;
  *) usage; exit 2 ;;
esac
