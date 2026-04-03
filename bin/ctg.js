#!/usr/bin/env node
"use strict";

const args = process.argv.slice(2);

// --version
if (args.includes('--version')) {
  console.log('1.0.0');
  process.exit(0);
}

// --help
if (args.includes('--help')) {
  console.log(`
Usage: ctg <subcommand> [flags]

Subcommands:
  audit       Scan project for token-waste anti-patterns
  fix         Apply auto-fixes for detected anti-patterns
  watch       Monitor session JSONL for runtime patterns
  dashboard   Display token usage summary

Flags:
  --auto              Run all fixers without prompting
  --reset             Remove injected CLAUDE.md block only
  --notify            Enable desktop notifications (Phase 3)
  --dir=<path>        Target directory (default: cwd)
  --dry-run           Preview changes, write nothing
  --mcp-threshold=N   P8 server count threshold (default: 3)
  --no-history        Skip writing to ~/.ctg/sessions/history.jsonl
  --version           Print version and exit
  --help              Print this usage summary and exit
`.trim());
  process.exit(0);
}

const subcommand = args[0];

const dirFlag = args.find(a => a.startsWith('--dir='));
const targetDir = (dirFlag ? dirFlag.split('=')[1] : null) || process.cwd();

const mcpFlag = args.find(a => a.startsWith('--mcp-threshold='));
const mcpThreshold = mcpFlag ? parseInt(mcpFlag.split('=')[1], 10) : 3;

const flags = {
  auto: args.includes('--auto'),
  reset: args.includes('--reset'),
  notify: args.includes('--notify'),
  dryRun: args.includes('--dry-run'),
  noHistory: args.includes('--no-history'),
};

const SUBCOMMANDS = ['audit', 'fix', 'watch', 'dashboard'];

if (!subcommand || !SUBCOMMANDS.includes(subcommand)) {
  console.error(`Unknown or missing subcommand: ${subcommand || '(none)'}`);
  console.error(`Valid subcommands: ${SUBCOMMANDS.join(', ')}`);
  console.error('Run ctg --help for usage.');
  process.exit(1);
}

const { dryRun, auto, reset } = flags;

// ── audit ─────────────────────────────────────────────────────────────────
if (subcommand === 'audit') {
  const { runAudit } = require('../src/audit');
  const { printReport } = require('../src/reporter');

  const result = runAudit(targetDir, { mcpThreshold });

  // Windows P3 exception
  if (process.platform === 'win32' && result.patterns.P3.detected) {
    result.patterns.P3.windowsSkipped = true;
    result.patterns.P3.detected = false;
    // recompute summary
    const s = result.summary;
    s.high = Math.max(0, s.high - 1);
    s.passed = Math.min(10, s.passed + 1);
    // total stays the same (10 patterns)
  }

  printReport(result);

  const s = result.summary;
  process.exit(s.critical > 0 ? 2 : (s.high > 0 || s.medium > 0 ? 1 : 0));
}

// ── fix ───────────────────────────────────────────────────────────────────
if (subcommand === 'fix') {
  const { runAudit } = require('../src/audit');
  const { printReport } = require('../src/reporter');
  const { injectClaudeMd, installHooks, updateSettings, createClaudeIgnore, resetClaudeMd } = require('../src/fixer');

  // --reset: strip injected block only
  if (reset) {
    const r = resetClaudeMd(targetDir);
    console.log(r.action === 'reset' ? 'CLAUDE.md block removed.' : 'Nothing to reset.');
    process.exit(0);
  }

  function applyFixes(dr) {
    const opts = { dryRun: dr };
    const r1 = injectClaudeMd(targetDir, opts);
    const r2 = installHooks(targetDir, opts);
    const r3 = updateSettings(targetDir, opts);
    const r4 = createClaudeIgnore(targetDir, opts);
    console.log('[1]', r1.action, r1.language || '');
    console.log('[2]', r2.action, r2.reason || '');
    console.log('[3]', r3.action);
    console.log('[P7 FIX]', r4.action, `added:${r4.added || 0} skipped:${r4.skipped || 0}`);
    return { r1, r2, r3, r4 };
  }

  // --auto: apply immediately
  if (auto) {
    if (dryRun) {
      console.log('[DRY RUN] No files will be written — showing preview only');
    }
    applyFixes(dryRun);
    if (!dryRun) {
      const after = runAudit(targetDir, { mcpThreshold });
      console.log('\n--- Post-fix audit ---');
      printReport(after);
    }
    process.exit(0);
  }

  // interactive: preview first, then prompt
  console.log('[DRY RUN] No files will be written — showing preview only');
  applyFixes(true);

  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('\nApply all? (y/n) ', (answer) => {
    rl.close();
    if (answer.trim().toLowerCase() === 'y') {
      applyFixes(false);
      const after = runAudit(targetDir, { mcpThreshold });
      console.log('\n--- Post-fix audit ---');
      printReport(after);
    } else {
      console.log('Aborted — no files written.');
    }
    process.exit(0);
  });
}

// ── watch ─────────────────────────────────────────────────────────────────
if (subcommand === 'watch') {
  const { startMonitor } = require('../src/monitor');
  console.log(`CTG Monitor watching ${targetDir}`);
  console.log('P10 correction loop detection active (min 30 chars)');
  console.log('Ctrl+C to stop');
  startMonitor({ dir: targetDir, notify: flags.notify, noHistory: flags.noHistory });
}

// ── dashboard ─────────────────────────────────────────────────────────────
if (subcommand === 'dashboard') {
  console.error(`dashboard: Phase 3 — not yet implemented.`);
  process.exit(1);
}
