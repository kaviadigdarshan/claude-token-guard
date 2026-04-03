#!/usr/bin/env bash
set -euo pipefail
PAYLOAD=$(cat)

# Extract session_id from JSON payload
SESSION_ID=$(printf '%s' "$PAYLOAD" | node -e \
  "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{" \
  "try{process.stdout.write(JSON.parse(d).session_id||'')}catch{}}" 2>/dev/null)

# Fallback with explicit warning (Gap 9 fix)
if [ -z "$SESSION_ID" ] || [ "$SESSION_ID" = "null" ]; then
  echo 'CTG WARN: session_id extraction failed, using shared counter' >&2
  SESSION_ID='default'
fi

THRESHOLD=${CLAUDE_TURN_THRESHOLD:-30}
SESSION_FILE="${TMPDIR:-/tmp}/ctg-turns-${SESSION_ID}"
CURRENT=$(( $(cat "$SESSION_FILE" 2>/dev/null || echo 0) + 1 ))
echo "$CURRENT" > "$SESSION_FILE"

if [ "$CURRENT" -eq "$THRESHOLD" ]; then
  echo "TOKEN GUARD: Turn ${CURRENT} reached. Run /clear before your next task." >&2
fi
if [ "$CURRENT" -gt "$((THRESHOLD + 5))" ]; then
  echo "TOKEN GUARD: Turn ${CURRENT} — context filling up. Run /clear NOW." >&2
fi
