<!-- Expected audit: All patterns PASS -->
## Project
Root: current directory. Source in src/.
## Stable Context
- Platform: Claude Code. Language: Node.js 18+
- Edit style: surgical only. Never rewrite entire files.
## Token Hygiene
- Never say 'continue where you left off' after a rate limit.
- Run /clear between unrelated tasks. Run /compact before resuming long sessions.
