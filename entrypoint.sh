#!/bin/sh
set -e

# Sync loop — runs immediately on startup (catch-up after suspend), then every 30m.
# Preferred over crond because crond silently drops missed ticks during host sleep.
# Set DISABLE_SYNC=1 to run only the server (e.g. when GitHub Actions owns the sync).
if [ -z "$DISABLE_SYNC" ]; then
  (
    while true; do
      echo "[sync] $(date -Iseconds): start"
      if cd /app && npm run sync; then
        echo "[sync] $(date -Iseconds): done"
      else
        echo "[sync] $(date -Iseconds): exited (likely rate limit)"
      fi
      sleep 1800
    done
  ) &
else
  echo "[boot] sync disabled via DISABLE_SYNC"
fi

echo "[boot] starting dev server"
exec npm run dev
