#!/bin/zsh -l
set -euo pipefail

ROOT_DIR="/Users/indijanmac/Projects/arbiter"

cd "$ROOT_DIR"

# Start the Next.js app in production mode (requires a prior build).
export NODE_ENV="production"
export PORT="${PORT:-3000}"
export NEXT_TELEMETRY_DISABLED="1"

# Some environments set NODE_OPTIONS=--disallow-code-generation-from-strings which breaks Next middleware.
unset NODE_OPTIONS || true

exec pnpm -C apps/web start
