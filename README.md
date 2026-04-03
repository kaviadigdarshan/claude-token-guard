# claude-token-guard

Token efficiency auditor and auto-fixer for Claude Code.


## Installation

```sh
npx claude-token-guard@latest audit
# or install globally:
npm install -g claude-token-guard
```


## Usage

```sh
ctg audit                  # scan current directory for token anti-patterns
ctg fix --auto             # apply all fixes automatically
ctg fix --dry-run          # preview changes without writing
ctg watch                  # monitor JSONL in real time (Phase 2)
ctg dashboard              # open SSE browser dashboard (Phase 3)
```


## Flags

| Flag | Description |
|------|-------------|
| `--auto` | apply all fixes without prompting |
| `--dry-run` | preview all changes, write nothing |
| `--mcp-threshold=N` | P8 server count threshold (default: 3) |
| `--no-history` | do not write to ~/.ctg/sessions/history.jsonl |
| `--dir=<path>` | target directory (default: current directory) |


## 10 Token Anti-Patterns Detected

| Pattern | Severity | What it detects |
|---------|----------|-----------------|
| P1 | CRITICAL | File discovery commands (cat ~/, grep -r, ls ~/) in .md files |
| P2 | CRITICAL | No 'resume after rate limit' prevention rule in CLAUDE.md |
| P3 | HIGH     | Session turn counter hook not installed |
| P4 | HIGH     | Verbose checklists with 6+ items in Checklist sections |
| P5 | MEDIUM   | No stable-context section in CLAUDE.md |
| P6 | MEDIUM   | No /clear discipline rule in CLAUDE.md |
| P7 | CRITICAL | Missing .claudeignore (node_modules/dist visible to Claude) |
| P8 | HIGH     | More than 3 MCP servers always connected |
| P9 | MEDIUM   | CLAUDE.md longer than 150 lines |
| P10| HIGH     | Correction loop: same instruction sent 3+ times (Phase 2) |


## Token Estimate Methodology

Estimates are rough: median pattern severity x average occurrences.
See METHODOLOGY.md for per-pattern sources and formulas.
Real savings depend on project size, session length, and usage patterns.
