#!/bin/sh

set -eu

ADMIN_PASSWORD_FILE="/tmp/generated_admin_password.txt"
API_URL="${API_URL:-http://localhost:8000}"
DOCKER_BIN="${DOCKER_BIN:-$(command -v docker 2>/dev/null || printf /usr/local/bin/docker)}"

echo "Checking backend availability..."
until curl -fsS "${API_URL}/health" >/dev/null 2>&1; do
  sleep 2
done

echo "Reading generated admin password from container..."
ADMIN_PASSWORD="$("${DOCKER_BIN}" compose exec -T backend cat "${ADMIN_PASSWORD_FILE}")"

echo "Authenticating as admin..."
TOKEN="$(
  curl -fsS "${API_URL}/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"admin\",\"password\":\"${ADMIN_PASSWORD}\"}" |
    python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])'
)"

echo "Triggering sample data load..."
curl -fsS -X POST "${API_URL}/api/sample-data/load" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json"

echo
echo "Sample data load requested."
