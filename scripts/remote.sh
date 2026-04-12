#!/usr/bin/env bash
set -euo pipefail

# Remote control for the home server (MacBook Air / Mac mini) via SSH.
# Requires SSH key auth already set up (so no password prompts).
#
# Usage (recommended: set ARBITER_HOST once):
#   export ARBITER_HOST=indijan@192.168.1.182
#   ./scripts/remote.sh status
#   ./scripts/remote.sh quick
#
# Or pass host explicitly:
#   ./scripts/remote.sh indijan@192.168.1.182 status
#   ./scripts/remote.sh indijan@192.168.1.182 quick
#
# Optional:
#   ARBITER_ROOT=/Users/indijan/Projects/arbiter ./scripts/remote.sh indijan@192.168.1.182 status

HOST="${ARBITER_HOST:-}"
CMD=""

if [[ "${1:-}" == *@* ]]; then
  HOST="$1"
  CMD="${2:-}"
else
  CMD="${1:-}"
fi

if [[ -z "${HOST}" || -z "${CMD}" ]]; then
  echo "Usage:"
  echo "  ARBITER_HOST=user@host $0 <status|logs|envcheck|restart|update|pull|quick|ping>"
  echo "  $0 <user@host> <status|logs|envcheck|restart|update|pull|quick|ping>"
  exit 2
fi

ROOT="${ARBITER_ROOT:-/Users/indijan/Projects/arbiter}"

IDENTITY_OPT=()
if [[ -n "${ARBITER_SSH_IDENTITY:-}" ]]; then
  IDENTITY_OPT=(-i "$ARBITER_SSH_IDENTITY")
fi

run() {
  # BatchMode avoids password prompts; if this fails, your key isn't accepted for this host/user.
  if [[ -n "${ARBITER_SSH_IDENTITY:-}" ]]; then
    ssh -o BatchMode=yes -i "$ARBITER_SSH_IDENTITY" "$HOST" "$@"
  else
    ssh -o BatchMode=yes "$HOST" "$@"
  fi
}

die_ssh() {
  echo "SSH failed. Likely causes:"
  echo "- wrong user/host ($HOST)"
  echo "- SSH key not installed on the server (authorized_keys)"
  echo "- using a different key than expected (set ARBITER_SSH_IDENTITY=~/.ssh/<key>)"
  echo
  echo "Quick test:"
  echo "  ssh $HOST 'echo ok'"
  exit 1
}

case "$CMD" in
  ping)
    run "echo ok" || die_ssh
    ;;
  status)
    run "cd '$ROOT' && ./scripts/mba.sh status" || die_ssh
    ;;
  logs)
    run "cd '$ROOT' && ./scripts/mba.sh logs" || die_ssh
    ;;
  envcheck)
    run "cd '$ROOT' && ./scripts/mba.sh envcheck" || die_ssh
    ;;
  restart)
    run "cd '$ROOT' && ./scripts/mba.sh stop && ./scripts/mba.sh start && ./scripts/mba.sh status" || die_ssh
    ;;
  pull)
    run "cd '$ROOT' && git pull" || die_ssh
    ;;
  update)
    run "cd '$ROOT' && ./scripts/mba.sh update" || die_ssh
    ;;
  quick)
    run "cd '$ROOT' && ./scripts/mba.sh status && echo && ./scripts/mba.sh envcheck && echo && ./scripts/mba.sh logs" || die_ssh
    ;;
  *)
    echo "Unknown command: $CMD"
    echo "Usage:"
    echo "  ARBITER_HOST=user@host $0 <status|logs|envcheck|restart|update|pull|quick|ping>"
    echo "  $0 <user@host> <status|logs|envcheck|restart|update|pull|quick|ping>"
    exit 2
    ;;
esac
