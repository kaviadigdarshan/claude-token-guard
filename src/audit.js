"use strict";

const fs = require("fs");
const path = require("path");

const SKIP_DIRS = new Set([
  "node_modules", ".git", "coverage", ".next", "dist", "build",
  ".venv", "venv", "__pycache__", "site-packages",
  ".tox", ".mypy_cache", ".pytest_cache", ".ruff_cache",
  "fixtures", "__tests__", "test", "tests", "examples", "docs/examples",
  "plugins", "cache",
]);

const P1_REGEX = /\b(cat\s+[~\/]|grep\s+-[a-zA-Z]*r[a-zA-Z]*\s|ls\s+[~\/]|##\s+STEP\s+\d+:\s+READ)/i;
const P4_SECTION_REGEX = /^##\s+(checklist|todo|verify|steps)/i;
const P4_ITEM_REGEX = /^\s*([-x]|\-\s*\[[ x]\])\s/;
const P4_CHECKLIST_THRESHOLD = 6;
const P8_MCP_THRESHOLD_DEFAULT = 3;

const REQUIRED_IGNORE_ENTRIES = ["node_modules", "dist", ".git", "build", "*.log"];

/**
 * Walk directory recursively, returning paths of all .md files.
 * @param {string} dir
 * @param {Set<string>} skipDirs
 * @param {number} depth
 * @param {{ n: number }} fileCount
 * @returns {string[]}
 */
function walkMd(dir, skipDirs = SKIP_DIRS, depth = 0, fileCount = { n: 0 }) {
  if (depth > 8) {
    console.warn("CTG: walkMd maxDepth:", dir);
    return [];
  }
  if (fileCount.n >= 2000) {
    console.warn("CTG: walkMd maxFiles reached");
    return [];
  }

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return [];
  }

  const results = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) continue;
      const sub = walkMd(path.join(dir, entry.name), skipDirs, depth + 1, fileCount);
      results.push(...sub);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      fileCount.n++;
      if (fileCount.n >= 2000) {
        console.warn("CTG: walkMd maxFiles reached");
        return results;
      }
      results.push(path.join(dir, entry.name));
    }
  }
  return results;
}

/**
 * Safely read a file, returning null on error.
 * @param {string} filePath
 * @returns {string|null}
 */
function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (_) {
    return null;
  }
}

/**
 * Safely parse JSON, returning null on error.
 * @param {string} text
 * @returns {object|null}
 */
function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

/**
 * Build the set of directory names to skip during walkMd.
 * Starts from SKIP_DIRS and adds plain directory-name entries from .claudeignore.
 * @param {string} targetDir
 * @returns {Set<string>}
 */
function buildSkipDirs(targetDir) {
  const skip = new Set(SKIP_DIRS);
  const ignoreContent = readFileSafe(path.join(targetDir, ".claudeignore"));
  if (!ignoreContent) return skip;
  for (const raw of ignoreContent.split("\n")) {
    const entry = raw.replace(/#.*$/, "").trim().replace(/\/$/, "");
    // Only plain directory names: no glob characters, no dots, no path separators
    if (entry && !/[*?.\\/]/.test(entry)) {
      skip.add(entry);
    }
  }
  return skip;
}

/**
 * Main audit function.
 * @param {string} targetDir
 * @param {{ mcpThreshold?: number }} opts
 * @returns {object} AuditResult
 */
function runAudit(targetDir, opts = {}) {
  targetDir = targetDir || process.cwd();
  const mcpThreshold = (opts.mcpThreshold != null ? opts.mcpThreshold : P8_MCP_THRESHOLD_DEFAULT);

  const claudeMdPath = resolveClaudeMd(targetDir);
  const settingsPath = resolveSettings(targetDir);

  const claudeMdContent = claudeMdPath ? readFileSafe(claudeMdPath) : null;
  const settingsContent = settingsPath ? readFileSafe(settingsPath) : null;
  const settingsJson = settingsContent ? parseJsonSafe(settingsContent) : null;

  const walkSkipDirs = buildSkipDirs(targetDir);
  const mdFiles = walkMd(targetDir, walkSkipDirs);
  const scannedFiles = [...mdFiles];
  if (claudeMdPath && !scannedFiles.includes(claudeMdPath)) scannedFiles.push(claudeMdPath);

  // ── P1 ──────────────────────────────────────────────────────────────────
  const p1ExemptHeading = /bad|avoid|anti-pattern|example|don't|detected/i;
  const p1Occurrences = [];
  for (const file of mdFiles) {
    // Skip fixture/methodology documentation files entirely
    const normalizedFilePath = file.replace(/\\/g, "/");
    if (/fixture|METHODOLOGY/i.test(normalizedFilePath)) continue;

    const content = readFileSafe(file);
    if (!content) continue;
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!P1_REGEX.test(lines[i])) continue;
      // Check if any heading within the preceding 5 lines marks this as documentation
      let exempt = false;
      for (let j = Math.max(0, i - 5); j < i; j++) {
        if (/^#+\s/.test(lines[j]) && p1ExemptHeading.test(lines[j])) {
          exempt = true;
          break;
        }
      }
      if (!exempt) {
        const NEGATION_PHRASES = [
          /never use/i, /do not use/i, /don't use/i, /avoid/i,
          /not allowed/i, /prohibited/i
        ];
        const isNegated = NEGATION_PHRASES.some(re => re.test(lines[i]));
        if (!isNegated) {
          p1Occurrences.push({ file, line: i + 1, text: lines[i] });
        }
      }
    }
  }
  const P1 = {
    severity: "CRITICAL",
    detected: p1Occurrences.length > 0,
    occurrences: p1Occurrences,
  };

  // ── P2 ──────────────────────────────────────────────────────────────────
  const p2Regex = /resume.{0,40}rate.limit|rate.limit.{0,40}resume|continue.{0,40}where.{0,40}left/i;
  const p2RulePresent = claudeMdContent != null && p2Regex.test(claudeMdContent);
  const P2 = {
    severity: "CRITICAL",
    detected: !p2RulePresent,
    rulePresent: p2RulePresent,
  };

  // ── P3 ──────────────────────────────────────────────────────────────────
  const p3HookInstalled = checkStopHookInstalled(settingsJson);
  const P3 = {
    severity: "HIGH",
    detected: !p3HookInstalled,
    hookInstalled: p3HookInstalled,
  };

  // ── P4 ──────────────────────────────────────────────────────────────────
  const p4Occurrences = [];
  for (const file of mdFiles) {
    const content = readFileSafe(file);
    if (!content) continue;
    const lines = content.split("\n");
    let inSection = false;
    let runCount = 0;
    let runStartLine = -1;
    let runStartText = "";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^##\s/.test(line)) {
        // Flush any open run before switching sections
        if (inSection && runCount >= P4_CHECKLIST_THRESHOLD) {
          p4Occurrences.push({ file, line: runStartLine, text: runStartText });
        }
        runCount = 0;
        runStartLine = -1;
        inSection = P4_SECTION_REGEX.test(line);
        continue;
      }
      if (!inSection) continue;

      if (P4_ITEM_REGEX.test(line)) {
        runCount++;
        if (runCount === 1) {
          runStartLine = i + 1;
          runStartText = line;
        }
      } else {
        if (runCount >= P4_CHECKLIST_THRESHOLD) {
          p4Occurrences.push({ file, line: runStartLine, text: runStartText });
        }
        runCount = 0;
        runStartLine = -1;
      }
    }
    // Flush at EOF
    if (inSection && runCount >= P4_CHECKLIST_THRESHOLD) {
      p4Occurrences.push({ file, line: runStartLine, text: runStartText });
    }
  }
  const P4 = {
    severity: "HIGH",
    detected: p4Occurrences.length > 0,
    occurrences: p4Occurrences,
  };

  // ── P5 ──────────────────────────────────────────────────────────────────
  const p5Regex = /##\s+(stable.context|project.reminders|boilerplate|platform)/i;
  const p5SectionPresent = claudeMdContent != null && p5Regex.test(claudeMdContent);
  const P5 = {
    severity: "MEDIUM",
    detected: !p5SectionPresent,
    sectionPresent: p5SectionPresent,
  };

  // ── P6 ──────────────────────────────────────────────────────────────────
  const p6Regex = /compact|clear between tasks|run \/clear/i;
  const p6RulePresent = claudeMdContent != null && p6Regex.test(claudeMdContent);
  const P6 = {
    severity: "MEDIUM",
    detected: !p6RulePresent,
    rulePresent: p6RulePresent,
  };

  // ── P7 ──────────────────────────────────────────────────────────────────
  const ignoreFilePath = path.join(targetDir, ".claudeignore");
  const claudeIgnorePresent = fs.existsSync(ignoreFilePath);
  let requiredEntriesMissing = [];
  if (claudeIgnorePresent) {
    const ignoreContent = readFileSafe(ignoreFilePath) || "";
    const ignoreLines = new Set(ignoreContent.split("\n").map(l => l.trim()).filter(Boolean));
    // Normalize both sides — strip trailing slash before comparing
    const normalizedLines = new Set([...ignoreLines].map(l => l.replace(/\/$/, '')));
    requiredEntriesMissing = REQUIRED_IGNORE_ENTRIES.filter(entry =>
      !normalizedLines.has(entry.replace(/\/$/, ''))
    );
  } else {
    requiredEntriesMissing = [...REQUIRED_IGNORE_ENTRIES];
  }
  const P7 = {
    severity: "CRITICAL",
    detected: !claudeIgnorePresent || requiredEntriesMissing.length > 0,
    claudeIgnorePresent,
    requiredEntriesMissing,
  };

  // ── P8 ──────────────────────────────────────────────────────────────────
  const mcpServers = (settingsJson && settingsJson.mcpServers) ? settingsJson.mcpServers : {};
  const mcpServerCount = Object.keys(mcpServers).length;
  const uncalledServers = Object.keys(mcpServers);
  const P8 = {
    severity: "HIGH",
    detected: mcpServerCount > mcpThreshold,
    mcpServerCount,
    uncalledServers,
  };

  // ── P9 ──────────────────────────────────────────────────────────────────
  const p9LineCount = claudeMdContent != null ? claudeMdContent.split("\n").length : 0;
  const p9Detected = p9LineCount > 150;
  const p9Severity = p9LineCount > 300 ? "HIGH" : "MEDIUM";
  const p9NarrativeHeuristic = checkNarrativeHeuristic(claudeMdContent);
  const P9 = {
    severity: p9Severity,
    detected: p9Detected,
    lineCount: p9LineCount,
    narrativeHeuristic: p9NarrativeHeuristic,
  };

  // ── P10 ─────────────────────────────────────────────────────────────────
  const P10 = {
    severity: "HIGH",
    detected: false,
    note: "Runtime only - Phase 2 monitor",
  };

  // ── Summary ──────────────────────────────────────────────────────────────
  const patterns = { P1, P2, P3, P4, P5, P6, P7, P8, P9, P10 };
  const summary = computeSummary(patterns);

  return {
    targetDir,
    claudeMdPath,
    settingsPath,
    summary,
    patterns,
    scannedFiles,
  };
}

/**
 * Resolve CLAUDE.md path from targetDir, checking both root and .claude/ subdirectory.
 * @param {string} targetDir
 * @returns {string|null}
 */
function resolveClaudeMd(targetDir) {
  const candidates = [
    path.join(targetDir, "CLAUDE.md"),
    path.join(targetDir, ".claude", "CLAUDE.md"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Resolve .claude/settings.json from targetDir.
 * @param {string} targetDir
 * @returns {string|null}
 */
function resolveSettings(targetDir) {
  const candidate = path.join(targetDir, ".claude", "settings.json");
  return fs.existsSync(candidate) ? candidate : null;
}

/**
 * Check if hooks.Stop has an entry referencing 'turn-counter'.
 * @param {object|null} settingsJson
 * @returns {boolean}
 */
function checkStopHookInstalled(settingsJson) {
  if (!settingsJson || !settingsJson.hooks || !Array.isArray(settingsJson.hooks.Stop)) {
    return false;
  }
  for (const entry of settingsJson.hooks.Stop) {
    if (Array.isArray(entry.hooks) && entry.hooks[0] &&
        typeof entry.hooks[0].command === "string" && entry.hooks[0].command.includes("turn-counter")) {
      return true;
    }
  }
  return false;
}

/**
 * Check if CLAUDE.md content contains 4+ consecutive non-empty prose lines
 * (lines that don't start with -, *, |, or #).
 * @param {string|null} content
 * @returns {boolean}
 */
function checkNarrativeHeuristic(content) {
  if (!content) return false;
  const lines = content.split("\n");
  let run = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      run = 0;
      continue;
    }
    if (/^[-*|#]/.test(trimmed)) {
      run = 0;
    } else {
      run++;
      if (run >= 4) return true;
    }
  }
  return false;
}

/**
 * Compute summary counts from pattern results.
 * @param {object} patterns
 * @returns {{ total:number, critical:number, high:number, medium:number, passed:number }}
 */
function computeSummary(patterns) {
  let critical = 0;
  let high = 0;
  let medium = 0;

  for (const key of Object.keys(patterns)) {
    const p = patterns[key];
    if (!p.detected) continue;
    if (p.severity === "CRITICAL") critical++;
    else if (p.severity === "HIGH") high++;
    else if (p.severity === "MEDIUM") medium++;
  }

  const total = 10;
  const passed = total - (critical + high + medium);
  return { total, critical, high, medium, passed };
}

module.exports = { runAudit };

if (require.main === module && process.argv[2] === "--self-test") {
  const dir = process.argv[3] || process.cwd();
  const result = runAudit(dir);
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}
