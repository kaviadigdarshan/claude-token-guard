# Token Estimate Methodology

Version: claude-token-guard v1.0.0 (April 2026)


## Disclaimer

All estimates are rough approximations based on median pattern severity x
average observed occurrences. Real savings depend on project size, session
length, model version, and individual usage patterns. Recalibrate after
collecting real session data with `ctg watch`.


## Per-Pattern Basis

| Pattern | Estimate | Basis |
|---------|----------|-------|
| P1 | 2,400,000 tokens/occurrence | cold file read ~800K x 3 avg tool calls |
| P2 | 3,500,000 tokens/session | resume prompt reloads full context |
| P3 | 1,800,000 tokens/session | ~20 extra turns x avg 90K tokens/turn |
| P4 | 120,000 tokens/checklist | 8 checks x 15K tokens each |
| P5 | 400,000 tokens/session | boilerplate repeated in every prompt |
| P6 | 600,000 tokens/occurrence | vague prompt triggers 20-60 extra tool calls |
| P7 | 4,000,000 tokens/session | node_modules/dist in context = massive overhead |
| P8 | 3,000 tokens/server/turn | each MCP server injects tool defs every turn |
| P9 | 350,000 tokens/session | bloated CLAUDE.md loaded at startup + every turn |
| P10 | 2,500,000 tokens/session | correction loops = ~10 wasted turns x 250K/turn |


## P8 Formula

```
P8 savings = 3,000 x mcpServerCount x estimatedTurns
estimatedTurns defaults to 50 in the reporter (noted in output).
```
