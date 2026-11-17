#!/usr/bin/env bash
# Run SQL against the Supabase DB using SUPABASE_DB_URL from member-app/.env
#   scripts/sql.sh "select count(*) from profiles"
#   scripts/sql.sh -f supabase/migrations/0034_service_access.sql
set -euo pipefail
cd "$(dirname "$0")/.."
PSQL=$(command -v psql || echo /opt/homebrew/opt/libpq/bin/psql)
URL=$(grep -E '^SUPABASE_DB_URL=' .env | cut -d= -f2- | tr -d '"' || true)
[ -z "$URL" ] && { echo "SUPABASE_DB_URL is empty in member-app/.env" >&2; exit 1; }
if [ "${1:-}" = "-f" ]; then
  exec "$PSQL" "$URL" -v ON_ERROR_STOP=1 -f "$2"
else
  exec "$PSQL" "$URL" -v ON_ERROR_STOP=1 -P pager=off -c "$*"
fi
