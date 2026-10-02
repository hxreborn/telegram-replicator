#!/usr/bin/env bash
set -euo pipefail

DEST=/root/telegram-replicator

git archive HEAD | ssh pve "pct exec 200 -- tar -C $DEST -xf -"
ssh pve "pct exec 200 -- sh -c 'cd $DEST && HOME=/root npm ci --omit=dev --prefer-offline && HOME=/root pm2 startOrReload ecosystem.config.cjs && HOME=/root pm2 save'"
