#!/usr/bin/env bash
set -euo pipefail

source .env
: "${DEPLOY_TARGET:?}" "${DEPLOY_DEST:?}"

ssh "$DEPLOY_TARGET" "mkdir -p '$DEPLOY_DEST'"

rsync -az --delete \
  --exclude node_modules --exclude .git --exclude .env --exclude logs --exclude '*.session' \
  ./ "$DEPLOY_TARGET:$DEPLOY_DEST/"

ssh "$DEPLOY_TARGET" "cd '$DEPLOY_DEST' && npm ci --prefer-offline --production && pm2 startOrReload ecosystem.config.cjs && pm2 save"
