#!/usr/bin/env bash
set -euo pipefail
PAYLOAD=$(cat)

SESSION_ID=$(printf '%s' "$PAYLOAD" | node -e \
  "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{" \
  "try{process.stdout.write(JSON.parse(d).session_id||'')}catch{}}" 2>/dev/null)

if [ -z "$SESSION_ID" ] || [ "$SESSION_ID" = "null" ]; then
  echo 'CTG WARN: session_id extraction failed, using shared counter' >&2
  SESSION_ID='default'
fi

SOURCE=$(printf '%s' "$PAYLOAD" | node -e \
  "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{" \
  "try{process.stdout.write(JSON.parse(d).source||'')}catch{}}" 2>/dev/null)

SESSION_FILE="${TMPDIR:-/tmp}/ctg-turns-${SESSION_ID}"
if [ "$SOURCE" = 'startup' ] || [ "$SOURCE" = 'clear' ]; then
  rm -f "$SESSION_FILE"
fi
