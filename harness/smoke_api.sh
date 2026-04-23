#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080}"
AUTH_TOKEN="${AUTH_TOKEN:-}"

auth_args=()
if [[ -n "$AUTH_TOKEN" ]]; then
  auth_args=(-H "Authorization: Bearer ${AUTH_TOKEN}")
fi

check_endpoint() {
  local path="$1"
  local code
  code="$(curl -fsS -o /tmp/sentinel-smoke.out -w "%{http_code}" "${auth_args[@]}" "${BASE_URL}${path}")"
  if [[ "$code" != "200" ]]; then
    echo "Smoke check failed for ${path}: HTTP ${code}" >&2
    cat /tmp/sentinel-smoke.out >&2 || true
    exit 1
  fi
  echo "OK ${path}"
}

check_endpoint "/health"
check_endpoint "/api/summary"
check_endpoint "/api/incidents"
check_endpoint "/api/waste"
