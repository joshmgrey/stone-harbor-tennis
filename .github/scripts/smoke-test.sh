#!/usr/bin/env bash
# Black-box check of the live site: DNS -> ALB -> task -> RDS.
#
#   .github/scripts/smoke-test.sh <site-url>
#
# Shared by deploy.yml (after a rollout) and site-check.yml (on a schedule).
# `/api/health` deliberately skips the database, so it can be green while
# every real page 500s — the Sep 2026 outage was exactly that: the RDS
# password drifted from the DATABASE_URL secret with no deploy involved.
# The DB-backed probes below are what catch it.
#
# SMOKE_ATTEMPTS / SMOKE_INTERVAL tune the retry budget per probe.
set -euo pipefail

url="${1:?usage: smoke-test.sh <site-url>}"
attempts="${SMOKE_ATTEMPTS:-20}"
interval="${SMOKE_INTERVAL:-15}"
body=$(mktemp)
echo "smoke-testing $url"

probe() {
  path="$1"; want="$2"
  for i in $(seq 1 "$attempts"); do
    code=$(curl -sS -o "$body" -w '%{http_code}' \
      --max-time 10 "$url$path" || echo 000)
    if [ "$code" = "$want" ]; then
      echo "ok    $path -> $code"
      return 0
    fi
    echo "wait  $path -> $code (attempt $i/$attempts)"
    [ "$i" -lt "$attempts" ] && sleep "$interval"
  done
  echo "::error::$url$path returned $code, expected $want"
  head -c 500 "$body" || true
  return 1
}

# Liveness — must also return the expected body, not just any 200
# (e.g. an ALB fixed-response or a stale cached page).
probe /api/health 200
grep -q '"status":"ok"' "$body" \
  || { echo "::error::unexpected /api/health body"; cat "$body"; exit 1; }

# Real routes: the DB-backed API and the rendered home page. These
# exercise RDS connectivity + credentials and Next SSR, which /api/health
# does not.
probe /api/sessions 200
grep -q '^\[' "$body" \
  || { echo "::error::/api/sessions did not return a JSON array"; head -c 500 "$body"; exit 1; }
probe / 200

echo "smoke test passed"
