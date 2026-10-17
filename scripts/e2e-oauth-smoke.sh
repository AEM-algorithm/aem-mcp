#!/usr/bin/env bash
# E2E smoke for the OAuth device flow (Phase 10).
#
# Walks the full agent-side flow:
#   1. POST /oauth/device  -> device_code + user_code
#   2. POST /oauth/authorize (form) — must be done in a browser, not here.
#   3. POST /oauth/token  -> access_token (polls until approved)
#   4. /api/agents with Bearer -> list pairings
#   5. DELETE /api/agents/:jti -> revoke (caller is the user; we use the
#      Bearer here too as a sanity check that revocation propagates).
#
# Usage:
#   BASE=http://localhost:3000 ./scripts/e2e-oauth-smoke.sh
#
# Requirements: bash, curl, jq.
#
# The script writes a per-run log to
# `.ai-dlc/evidence/dev-4154-mcp/e2e-<UTC-timestamp>.log` so a reviewer
# can audit the run. The script exits non-zero on the first failure.

set -euo pipefail

BASE="${BASE:-http://localhost:3000}"
EVIDENCE_DIR=".ai-dlc/evidence/dev-4154-mcp"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$EVIDENCE_DIR/e2e-$TS.log"

mkdir -p "$EVIDENCE_DIR"

log() {
  local msg="$1"
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$msg" | tee -a "$LOG"
}

require() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing required tool: $1" >&2
    exit 2
  }
}

require curl
require jq

log "e2e smoke starting (base=$BASE, log=$LOG)"

# 1. Issue a device code
log "1) POST /oauth/device"
DEVICE_JSON=$(curl -fsS -X POST "$BASE/oauth/device" \
  -H 'content-type: application/json' \
  -d '{"client_id":"claude-code","scope":"aem-mcp:read"}')
DEVICE_CODE=$(echo "$DEVICE_JSON" | jq -r .device_code)
USER_CODE=$(echo "$DEVICE_JSON" | jq -r .user_code)
VERIFICATION_URI=$(echo "$DEVICE_JSON" | jq -r .verification_uri)
EXPIRES_IN=$(echo "$DEVICE_JSON" | jq -r .expires_in)
log "  device_code (hash only) = sha256:$(printf %s "$DEVICE_CODE" | shasum -a 256 | cut -d' ' -f1)"
log "  user_code     = $USER_CODE"
log "  verification_uri = $VERIFICATION_URI"
log "  expires_in    = $EXPIRES_IN"

# 2. Authorize (must happen in a browser by a human user)
log "2) open $VERIFICATION_URI in a browser, enter code $USER_CODE, and sign in"
log "   (this script does not automate the form; the operator does this step manually)"

# 3. Poll for the token
log "3) POST /oauth/token (polling every 2s until approved or expired)"
TOKEN=""
DEADLINE=$(( $(date +%s) + EXPIRES_IN ))
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  RESP=$(curl -sS -X POST "$BASE/oauth/token" \
    -H 'content-type: application/json' \
    -d "{\"grant_type\":\"urn:ietf:params:oauth:grant-type:device_code\",\"device_code\":\"$DEVICE_CODE\"}" \
    -w '\n%{http_code}')
  BODY=$(printf '%s' "$RESP" | head -n -1)
  STATUS=$(printf '%s' "$RESP" | tail -n 1)

  if [ "$STATUS" = "200" ]; then
    TOKEN=$(echo "$BODY" | jq -r .access_token)
    log "  token received (length=${#TOKEN})"
    break
  fi

  ERROR=$(echo "$BODY" | jq -r .error 2>/dev/null || echo "$BODY")
  log "  poll: status=$STATUS error=$ERROR"
  if [ "$ERROR" = "expired_token" ] || [ "$ERROR" = "access_denied" ]; then
    log "aborting: $ERROR"
    exit 1
  fi
  sleep 2
done

if [ -z "$TOKEN" ]; then
  log "FAIL: token was not issued within $EXPIRES_IN seconds"
  exit 1
fi

# 4. List pairings via the Bearer path
log "4) GET /api/agents with Bearer"
LIST=$(curl -fsS -H "authorization: Bearer $TOKEN" "$BASE/api/agents")
COUNT=$(echo "$LIST" | jq -r '.data.agents | length')
log "  pairings count = $COUNT"
JTI=$(echo "$LIST" | jq -r --arg uc "$USER_CODE" '.data.agents[] | select(.userCode == $uc) | .jti')
if [ -z "$JTI" ]; then
  log "FAIL: no pairing found for user_code=$USER_CODE"
  exit 1
fi
log "  jti = $JTI"

# 5. Revoke
log "5) DELETE /api/agents/$JTI"
DEL=$(curl -fsS -X DELETE -H "authorization: Bearer $TOKEN" "$BASE/api/agents/$JTI")
log "  response: $DEL"

# 6. Re-list with the now-revoked token (expect 401)
log "6) GET /api/agents (expect 401 because the token is revoked)"
STATUS=$(curl -sS -o /dev/null -w '%{http_code}' -H "authorization: Bearer $TOKEN" "$BASE/api/agents")
log "  status = $STATUS"
if [ "$STATUS" != "401" ]; then
  log "FAIL: expected 401 after revoke, got $STATUS"
  exit 1
fi

log "e2e smoke complete — OK"
