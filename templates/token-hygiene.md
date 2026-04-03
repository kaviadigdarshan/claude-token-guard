<!-- claude-token-guard-start -->
## Token Hygiene (managed by claude-token-guard)
Project root: [CTG_FILLS_THIS_AT_INJECT_TIME:projectRoot]
Language: [CTG_FILLS_THIS_AT_INJECT_TIME:language]


- Never say 'continue where you left off' after a rate limit (P2).
  Instead: start fresh with a one-paragraph summary of last completed file.
- Run /clear between unrelated tasks and at turn 30 (P3/P6).
- Run /compact before resuming sessions longer than 20 turns.
- Keep .claudeignore updated — node_modules/, dist/, .git/, build/ must be excluded (P7).
- Only connect MCP servers you need for this task. Disconnect others (P8).
<!-- claude-token-guard-end -->
