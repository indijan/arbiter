#!/bin/zsh -l
set -euo pipefail

ROOT_DIR="/Users/indijanmac/Projects/arbiter"

cd "$ROOT_DIR"

export NODE_ENV="production"

exec pnpm runner

