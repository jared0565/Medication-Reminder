#!/usr/bin/env bash
# Poll the worker's cron heartbeat and exit non-zero if it has gone stale.
#
# Why this endpoint and not /api/health: fetch and scheduled fail
# independently, so the worker can serve every request perfectly while the
# scheduled handler throws on every run. That is not hypothetical -- it is
# exactly what was happening before the heartbeat existed. See docs/MONITORING.md.
#
# Retries before giving up, so one slow tick does not raise an incident. Only a
# sustained failure exits 1.
set -uo pipefail

URL="${CRON_HEALTH_URL:-https://medication.bytesfx.com/api/health/cron}"
ATTEMPTS="${CRON_HEALTH_ATTEMPTS:-3}"
INTERVAL="${CRON_HEALTH_INTERVAL:-60}"

body_file="$(mktemp)"
trap 'rm -f "$body_file"' EXIT

code=000
body=''
attempt=1
while [ "$attempt" -le "$ATTEMPTS" ]; do
  # curl prints 000 via -w when it cannot connect at all; the || is belt and braces.
  code="$(curl -sS -m 15 -o "$body_file" -w '%{http_code}' "$URL")" || code=000
  body="$(tr -d '\r\n' < "$body_file" 2>/dev/null || true)"
  printf 'attempt %s/%s: HTTP %s %s\n' "$attempt" "$ATTEMPTS" "$code" "$body"

  if [ "$code" = "200" ]; then
    echo 'cron heartbeat healthy'
    exit 0
  fi

  if [ "$attempt" -lt "$ATTEMPTS" ]; then
    sleep "$INTERVAL"
  fi
  attempt=$((attempt + 1))
done

printf 'cron heartbeat UNHEALTHY after %s attempts: HTTP %s %s\n' "$ATTEMPTS" "$code" "$body" >&2
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  printf 'detail=HTTP %s %s\n' "$code" "$body" >> "$GITHUB_OUTPUT"
fi
exit 1
