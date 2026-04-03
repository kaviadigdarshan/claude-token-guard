## Project
- Root: current directory. Source: src/  CLI entry: bin/ctg.js
- Hooks: hooks/  Templates: templates/  Fixtures: test/fixtures/


## Code Rules
- Node.js 18+ builtins only. Never require() any npm package.
- "use strict" in every .js file.
- Surgical edits only. Never rewrite entire files.
- Never use cat ~/, grep -r, or ls ~/ to read or browse files.


## Anti-Pattern Definitions (P1-P10)


P1  CRITICAL  File discovery commands
    Detection: Regex on *.md files
    Regex: /\b(cat\s+[~\/]|grep\s+-[a-zA-Z]*r[a-zA-Z]*\s|ls\s+[~\/]|##\s+STEP\s+\d+:\s+READ)/i


P2  CRITICAL  Resume-after-rate-limit (no prevention rule in CLAUDE.md)
    Detection: Absence — CLAUDE.md missing /resume.{0,40}rate.limit|continue.{0,40}where.{0,40}left/i


P3  HIGH  Long sessions — Stop hook absent in .claude/settings.json
    Detection: Absence — hooks.Stop missing turn-counter entry


P4  HIGH  Verbose verification checklists (6+ items in ## Checklist sections)
    Detection: 6+ consecutive /^\s*([-x]|\-\s*\[[ x]\])\s/ lines in ## Checklist/TODO/Verify
    Threshold: P4_CHECKLIST_THRESHOLD = 6


P5  MEDIUM  Repeated boilerplate — no stable-context section in CLAUDE.md
    Detection: Absence — CLAUDE.md missing /##\s+(stable.context|project.reminders)/i


P6  MEDIUM  No /clear discipline rule in CLAUDE.md
    Detection: Absence — CLAUDE.md missing /compact|clear between tasks|run \/clear/i


P7  CRITICAL  Missing .claudeignore
    Detection: fs.existsSync('.claudeignore') + entries audit
    Required entries: node_modules, dist, .git, build, *.log


P8  HIGH  Always-on MCP servers (count > threshold)
    Detection: settings.json mcpServers key count > P8_MCP_THRESHOLD
    Threshold: P8_MCP_THRESHOLD = 3  (overridable via --mcp-threshold=N)


P9  MEDIUM  Bloated CLAUDE.md (>150 lines)
    Detection: Line count > 150 = MEDIUM severity; > 300 = HIGH severity
    narrativeHeuristic: advisory flag only — does NOT change detected or severity


P10 HIGH  Correction loops — same user message repeated in session
    Detection: JSONL runtime only (Phase 2 monitor). Static audit always returns detected:false
    Min message length for loop detection: P10_MSG_MIN_CHARS = 30


## Token Hygiene Rules
- Never say 'continue where you left off' after a rate limit.
- Run /clear between unrelated tasks and at turn 30.
- Run /compact before resuming long sessions.


## Verification
Compile: node --check <file>
Audit self-test: node src/audit.js --self-test test/fixtures/bad-claude.md
<!-- claude-token-guard-start -->
## Token Hygiene (managed by claude-token-guard)
Project root: /home/priyanka_palawat/claude-token-guard
Language: Node.js


- Never say 'continue where you left off' after a rate limit (P2).
  Instead: start fresh with a one-paragraph summary of last completed file.
- Run /clear between unrelated tasks and at turn 30 (P3/P6).
- Run /compact before resuming sessions longer than 20 turns.
- Keep .claudeignore updated — node_modules/, dist/, .git/, build/ must be excluded (P7).
- Only connect MCP servers you need for this task. Disconnect others (P8).
<!-- claude-token-guard-end -->

## Stable Context

<!-- stable-context: do not remove this section -->
### Project
This is **claude-token-guard** — a CLI tool that audits Claude Code projects
for token hygiene anti-patterns and provides real-time monitoring via
`ctg watch` and `ctg dashboard`.

### Key Commands
- `ctg audit` — scan for anti-patterns
- `ctg fix --auto` — apply all safe fixes
- `ctg watch` — live token monitoring (terminal)
- `ctg dashboard` — live browser dashboard
- `ctg test` — run anti-pattern test scenarios

### Architecture
- `bin/ctg.js` — CLI entry point
- `src/audit.js` — pattern detection (P1–P10)
- `src/fixer.js` — auto-fix implementations
- `src/monitor.js` — JSONL tail + spike detection
- `src/dashboard.js` — SSE server + browser UI
- `src/reporter.js` — formatted audit output
