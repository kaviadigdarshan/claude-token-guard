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
    return { action: 'skipped', reason: 'windows — hooks require WSL or Git Bash', files: [] };
  }

  const destDir = path.join(targetDir, '.claude', 'hooks');
  const hookFiles = ['turn-counter.sh', 'session-start.sh'];
  const installedFiles = [];

  if (!opts.dryRun) {
    fs.mkdirSync(destDir, { recursive: true });

    for (const file of hookFiles) {
      const src = path.join(HOOKS_SRC_DIR, file);
      const dest = path.join(destDir, file);
      fs.copyFileSync(src, dest);
      fs.chmodSync(dest, 0o755);
      installedFiles.push(dest);
    }
  } else {
    for (const file of hookFiles) {
      installedFiles.push(path.join(destDir, file));
    }
  }

  return { action: 'installed', files: installedFiles };
}

function updateSettings(targetDir, opts = { dryRun: false }) {
  const settingsPath = path.join(targetDir, '.claude', 'settings.json');
  const turnCounterCmd = path.join('.claude', 'hooks', 'turn-counter.sh');
  const sessionStartCmd = path.join('.claude', 'hooks', 'session-start.sh');

  let settings = {};
  if (fs.existsSync(settingsPath)) {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  }

  if (!settings.hooks) settings.hooks = {};

  function hasCommand(entries, cmd) {
    if (!Array.isArray(entries)) return false;
    return entries.some(e => (typeof e === 'string' ? e : e.command) === cmd);
  }

  const stopAlready = hasCommand(settings.hooks.Stop, turnCounterCmd);
  const startAlready = hasCommand(settings.hooks.SessionStart, sessionStartCmd);

  if (stopAlready && startAlready) {
    return { action: 'already-configured' };
  }

  if (!stopAlready) {
    if (!Array.isArray(settings.hooks.Stop)) settings.hooks.Stop = [];
    settings.hooks.Stop.push({ command: turnCounterCmd });
  }

  if (!startAlready) {
    if (!Array.isArray(settings.hooks.SessionStart)) settings.hooks.SessionStart = [];
    settings.hooks.SessionStart.push({ command: sessionStartCmd });
  }

  if (!opts.dryRun) {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  }

  return { action: 'updated' };
}

function createClaudeIgnore(targetDir, opts = { dryRun: false }) {
  const claudeIgnorePath = path.join(targetDir, '.claudeignore');
  const gitIgnorePath = path.join(targetDir, '.gitignore');
  const templatePath = path.join(TEMPLATES_DIR, 'default-claudeignore');

  function parseEntries(content) {
    return content
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'));
  }

  function normalizeEntry(e) {
    return e.replace(/\/$/, '');
  }

  const gitignoreEntries = fs.existsSync(gitIgnorePath)
    ? new Set(parseEntries(fs.readFileSync(gitIgnorePath, 'utf8')).map(normalizeEntry))
    : new Set();

  if (!fs.existsSync(claudeIgnorePath)) {
    const templateContent = fs.readFileSync(templatePath, 'utf8');
    const templateLines = templateContent.split('\n');

    const filteredLines = [];
    let skipped = 0;

    for (const line of templateLines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && gitignoreEntries.has(normalizeEntry(trimmed))) {
        skipped++;
      } else {
        filteredLines.push(line);
      }
    }

    const written = filteredLines.filter(l => { const t = l.trim(); return t && !t.startsWith('#'); }).length;
    const preview = filteredLines.join('\n');

    process.stdout.write(`[P7 FIX] ${written} entries written (${skipped} skipped — already in .gitignore)\n`);

    if (opts.dryRun) {
      return { action: 'would-create', preview, skipped };
    }

    fs.writeFileSync(claudeIgnorePath, preview, 'utf8');
    return { action: 'created', added: written, skipped };
  } else {
    const existing = fs.readFileSync(claudeIgnorePath, 'utf8');
    const existingEntries = new Set(parseEntries(existing).map(normalizeEntry));
    const required = ['node_modules', 'dist', '.git', 'build'];

    const missing = required.filter(
      e => !existingEntries.has(e) && !gitignoreEntries.has(e)
    );

    if (missing.length === 0) {
      process.stdout.write(`[P7 FIX] 0 entries added (${required.length} skipped — already in .gitignore)\n`);
      return { action: 'skipped', added: 0, skipped: required.length };
    }

    const toAppend = '\n# Added by claude-token-guard\n' + missing.join('\n') + '\n';
    const skipped = required.length - missing.length;

    process.stdout.write(`[P7 FIX] ${missing.length} entries added (${skipped} skipped — already in .gitignore)\n`);

    if (opts.dryRun) {
      return { action: 'would-append', preview: toAppend, skipped };
    }

    fs.appendFileSync(claudeIgnorePath, toAppend, 'utf8');
    return { action: 'appended', added: missing.length, skipped };
  }
}

module.exports = { injectClaudeMd, resetClaudeMd, installHooks, updateSettings, createClaudeIgnore };
