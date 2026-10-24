#!/bin/sh
# Database backup (decision.md D-080): a compressed pg_dump, keeping the newest 14. Run from the repo root
# (see production.md for the cron line):  deploy/backup.sh
# Restore:  gunzip -c backups/<file>.sql.gz | docker compose -f docker-compose.prod.yml --env-file .env.production exec -T postgres psql -U thegrave -d thegrave
set -eu
cd "$(dirname "$0")/.."
DIR="${BACKUP_DIR:-backups}"
mkdir -p "$DIR"
FILE="$DIR/thegrave-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
docker compose -f docker-compose.prod.yml --env-file .env.production exec -T postgres \
  pg_dump -U thegrave -d thegrave --no-owner --clean --if-exists | gzip > "$FILE"
# An empty or truncated dump is worse than none: refuse it instead of rotating good backups away.
[ "$(gzip -dc "$FILE" | wc -c)" -gt 1000 ] || { rm -f "$FILE"; echo "backup failed: dump too small" >&2; exit 1; }
ls -1t "$DIR"/thegrave-*.sql.gz | tail -n +15 | xargs -r rm --
echo "backup written: $FILE"
