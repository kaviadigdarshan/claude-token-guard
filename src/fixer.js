'use strict';

const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');
const HOOKS_SRC_DIR = path.join(__dirname, '..', 'hooks');

function detectLanguage(targetDir) {
  if (fs.existsSync(path.join(targetDir, 'package.json'))) return 'Node.js';
  if (fs.existsSync(path.join(targetDir, 'pyproject.toml')) ||
      fs.existsSync(path.join(targetDir, 'requirements.txt'))) return 'Python';
  if (fs.existsSync(path.join(targetDir, 'Gemfile'))) return 'Ruby';
  if (fs.existsSync(path.join(targetDir, 'go.mod'))) return 'Go';
  if (fs.existsSync(path.join(targetDir, 'pom.xml')) ||
      fs.existsSync(path.join(targetDir, 'build.gradle'))) return 'Java';
  return 'Unknown';
}

function injectClaudeMd(targetDir, opts = { dryRun: false }) {
  const claudeMdPath = path.join(targetDir, 'CLAUDE.md');
  const templatePath = path.join(TEMPLATES_DIR, 'token-hygiene.md');

  const template = fs.readFileSync(templatePath, 'utf8');
  const language = detectLanguage(targetDir);

  const filled = template
    .replace('[CTG_FILLS_THIS_AT_INJECT_TIME:projectRoot]', targetDir)
    .replace('[CTG_FILLS_THIS_AT_INJECT_TIME:language]', language);

  const existing = fs.existsSync(claudeMdPath) ? fs.readFileSync(claudeMdPath, 'utf8') : '';

  if (existing.includes('<!-- claude-token-guard-start -->')) {
    return { action: 'skipped', path: claudeMdPath, language };
  }

  if (!opts.dryRun) {
    fs.writeFileSync(claudeMdPath, existing + (existing.endsWith('\n') ? '' : '\n') + filled, 'utf8');
  }

  return { action: 'injected', path: claudeMdPath, language };
}

function resetClaudeMd(targetDir) {
  const claudeMdPath = path.join(targetDir, 'CLAUDE.md');

  if (!fs.existsSync(claudeMdPath)) {
    return { action: 'nothing-to-reset', path: claudeMdPath };
  }

  const content = fs.readFileSync(claudeMdPath, 'utf8');
  const updated = content.replace(
    /\n?<!-- claude-token-guard-start -->[\s\S]*?<!-- claude-token-guard-end -->\n?/,
    ''
  );

  if (updated === content) {
    return { action: 'nothing-to-reset', path: claudeMdPath };
  }

  fs.writeFileSync(claudeMdPath, updated, 'utf8');
  return { action: 'reset', path: claudeMdPath };
}

function installHooks(targetDir, opts = { dryRun: false }) {
  if (process.platform === 'win32') {
    return { action: 'skipped', reason: 'windows — hooks require WSL or Git Bash' };
  }

  const hooksDir = path.join(targetDir, '.claude', 'hooks');
  const turnCounterPath = path.join(hooksDir, 'turn-counter.sh');
  const sessionStartPath = path.join(hooksDir, 'session-start.sh');

  const TURN_COUNTER = `#!/usr/bin/env bash
set -euo pipefail
PAYLOAD=$(cat)
SESSION_ID=$(printf '%s' "$PAYLOAD" | node -e \\
  "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{process.stdout.write(JSON.parse(d).session_id||'')}catch{}})" 2>/dev/null)
if [ -z "$SESSION_ID" ] || [ "$SESSION_ID" = "null" ]; then
  echo 'CTG WARN: session_id extraction failed, using shared counter' >&2
  SESSION_ID='default'
fi
THRESHOLD=\${CLAUDE_TURN_THRESHOLD:-30}
SESSION_FILE="\${TMPDIR:-/tmp}/ctg-turns-\${SESSION_ID}"
CURRENT=$(( $(cat "$SESSION_FILE" 2>/dev/null || echo 0) + 1 ))
echo "$CURRENT" > "$SESSION_FILE"
if [ "$CURRENT" -eq "$THRESHOLD" ]; then
  echo "TOKEN GUARD: Turn \${CURRENT} reached. Run /clear before your next task." >&2
fi
if [ "$CURRENT" -gt "$(($THRESHOLD + 5))" ]; then
  echo "TOKEN GUARD: Turn \${CURRENT} — context filling up. Run /clear NOW." >&2
fi
`;

  const SESSION_START = `#!/usr/bin/env bash
set -euo pipefail
PAYLOAD=$(cat)
SESSION_ID=$(printf '%s' "$PAYLOAD" | node -e \\
  "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{process.stdout.write(JSON.parse(d).session_id||'')}catch{}})" 2>/dev/null)
if [ -z "$SESSION_ID" ] || [ "$SESSION_ID" = "null" ]; then
  echo 'CTG WARN: session_id extraction failed, using shared counter' >&2
  SESSION_ID='default'
fi
SOURCE=$(printf '%s' "$PAYLOAD" | node -e \\
  "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{process.stdout.write(JSON.parse(d).source||'')}catch{}})" 2>/dev/null)
SESSION_FILE="\${TMPDIR:-/tmp}/ctg-turns-\${SESSION_ID}"
if [ "$SOURCE" = 'startup' ] || [ "$SOURCE" = 'clear' ]; then
  rm -f "$SESSION_FILE"
fi
`;

  if (opts.dryRun) {
    return { action: 'would-install', files: [turnCounterPath, sessionStartPath] };
  }

  fs.mkdirSync(hooksDir, { recursive: true });
  fs.writeFileSync(turnCounterPath, TURN_COUNTER, { mode: 0o755 });
  fs.writeFileSync(sessionStartPath, SESSION_START, { mode: 0o755 });

  return { action: 'installed', files: [turnCounterPath, sessionStartPath] };
}

function updateSettings(targetDir, opts = { dryRun: false }) {
  const settingsPath = path.join(targetDir, '.claude', 'settings.json');
  const hooksDir = path.resolve(targetDir, '.claude', 'hooks');
  const turnCounterCmd = path.join(hooksDir, 'turn-counter.sh');
  const sessionStartCmd = path.join(hooksDir, 'session-start.sh');

  let settings = {};
  if (fs.existsSync(settingsPath)) {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  }

  if (!settings.hooks) settings.hooks = {};

  function isBareOld(entry, ...keywords) {
    return typeof entry.command === 'string' &&
      !Array.isArray(entry.hooks) &&
      keywords.some(k => entry.command.includes(k));
  }

  function hasCorrect(entries, cmd) {
    if (!Array.isArray(entries)) return false;
    return entries.some(e =>
      Array.isArray(e.hooks) && e.hooks[0] && e.hooks[0].command === cmd
    );
  }

  function cleanAndCheck(hookArray, cmd, keywords) {
    if (!Array.isArray(hookArray)) return { arr: [], already: false };
    const arr = hookArray.filter(e => !isBareOld(e, ...keywords));
    const already = arr.some(e =>
      Array.isArray(e.hooks) && e.hooks[0] && e.hooks[0].command === cmd
    );
    return { arr, already };
  }

  const { arr: stopArr, already: stopAlready } =
    cleanAndCheck(settings.hooks.Stop, turnCounterCmd, ['turn-counter', 'session-start']);
  const { arr: startArr, already: startAlready } =
    cleanAndCheck(settings.hooks.SessionStart, sessionStartCmd, ['turn-counter', 'session-start']);

  if (stopAlready && startAlready &&
      stopArr.length === (settings.hooks.Stop || []).length &&
      startArr.length === (settings.hooks.SessionStart || []).length) {
    return { action: 'already-configured' };
  }

  settings.hooks.Stop = stopArr;
  if (!stopAlready) {
    settings.hooks.Stop.push({ matcher: '', hooks: [{ type: 'command', command: turnCounterCmd }] });
  }

  settings.hooks.SessionStart = startArr;
  if (!startAlready) {
    settings.hooks.SessionStart.push({ matcher: '', hooks: [{ type: 'command', command: sessionStartCmd }] });
  }

  if (!opts.dryRun) {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  }

  return { action: 'updated' };
}

function createClaudeIgnore(targetDir, opts = { dryRun: false }) {
  const REQUIRED = [
    'node_modules/', 'dist/', '.git/', 'build/', 'coverage/', '*.log',
    '.venv/', '__pycache__/', '.env', '*.key', '*.pem'
  ];

  const filePath = path.join(targetDir, '.claudeignore');
  const existing = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, 'utf8') : '';

  // Check each required entry — match with and without trailing slash
  const missing = REQUIRED.filter(entry => {
    const base = entry.replace(/\/$/, '');
    return !existing.includes(entry) && !existing.includes(base);
  });

  if (missing.length === 0) {
    console.log('[P7 FIX] all required entries already present');
    return { action: 'skipped', added: 0, skipped: REQUIRED.length };
  }

  if (opts.dryRun) {
    console.log(`[P7 FIX] would add: ${missing.join(', ')}`);
    return { action: 'would-add', missing };
  }

  const toAppend = '\n# Added by claude-token-guard\n' +
    missing.join('\n') + '\n';
  fs.appendFileSync(filePath, toAppend);
  console.log(`[P7 FIX] added ${missing.length} entries: ${missing.join(', ')}`);
  return { action: 'added', added: missing.length, skipped: 0 };
}

function injectStableContext(claudeMdPath, opts = {}) {
  const content = fs.existsSync(claudeMdPath)
    ? fs.readFileSync(claudeMdPath, 'utf8') : '';

  if (content.includes('<!-- stable-context') ||
      content.includes('## Stable Context')) {
    return { action: 'skipped', reason: 'already present' };
  }

  const section = `
## Stable Context

<!-- stable-context: do not remove this section -->
### Project
This is **claude-token-guard** — a CLI tool that audits Claude Code projects
for token hygiene anti-patterns and provides real-time monitoring via
\`ctg watch\` and \`ctg dashboard\`.

### Key Commands
- \`ctg audit\` — scan for anti-patterns
- \`ctg fix --auto\` — apply all safe fixes
- \`ctg watch\` — live token monitoring (terminal)
- \`ctg dashboard\` — live browser dashboard
- \`ctg test\` — run anti-pattern test scenarios

### Architecture
- \`bin/ctg.js\` — CLI entry point
- \`src/audit.js\` — pattern detection (P1–P10)
- \`src/fixer.js\` — auto-fix implementations
- \`src/monitor.js\` — JSONL tail + spike detection
- \`src/dashboard.js\` — SSE server + browser UI
- \`src/reporter.js\` — formatted audit output
`;

  if (opts.dryRun) return { action: 'would-add' };
  fs.writeFileSync(claudeMdPath, content + section);
  return { action: 'added' };
}

module.exports = { injectClaudeMd, resetClaudeMd, installHooks, updateSettings, createClaudeIgnore, injectStableContext };
