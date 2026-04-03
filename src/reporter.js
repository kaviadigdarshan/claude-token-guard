"use strict";

// rough estimate — median severity x avg occurrences. See METHODOLOGY.md.
const WEIGHTS = {
  P1: 2_400_000,   // per occurrence: file read ~800K x 3 avg tool calls
  P2: 3_500_000,   // per session: resume prompt reloads full context
  P3: 1_800_000,   // per session: 20 extra turns x 90K tokens/turn
  P4: 120_000,     // per checklist: 8 checks x 15K tokens
  P5: 400_000,     // per session: boilerplate repeated every prompt
  P6: 600_000,     // per occurrence: vague prompt triggers 20-60 extra tool calls
  P7: 4_000_000,   // per session: node_modules/dist in context = massive overhead
  P8: 3_000,       // per server per turn: each MCP server injects tool defs
  P9: 350_000,     // per session: bloated CLAUDE.md loaded at startup+every turn
  P10: 2_500_000   // per session: 10+ wasted correction turns x 250K/turn
};

const ANSI = {
  reset:   "\x1b[0m",
  bold:    "\x1b[1m",
  red:     "\x1b[31m",
  yellow:  "\x1b[33m",
  cyan:    "\x1b[36m",
  green:   "\x1b[32m",
  magenta: "\x1b[35m",
  gray:    "\x1b[90m",
  white:   "\x1b[37m",
};

function c(color, text) {
  return `${ANSI[color]}${text}${ANSI.reset}`;
}

function bold(text) {
  return `${ANSI.bold}${text}${ANSI.reset}`;
}

function severityColor(severity) {
  if (severity === "CRITICAL") return "red";
  if (severity === "HIGH")     return "yellow";
  if (severity === "MEDIUM")   return "cyan";
  return "green";
}

function badge(severity) {
  return c(severityColor(severity), `[${severity}]`);
}

function pad(str, width) {
  return str.length >= width ? str : str + " ".repeat(width - str.length);
}

/**
 * Format a token count as a human-readable string (e.g. 5.4M, 800K).
 * @param {number} n
 * @returns {string}
 */
function formatTokens(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(0) + "K";
  return String(n);
}

/**
 * Compute total estimated token savings from detected patterns.
 * @param {object} patterns
 * @returns {number}
 */
function computeSavings(patterns) {
  let total = 0;

  const { P1, P2, P3, P4, P5, P6, P7, P8, P9 } = patterns;

  if (P1.detected) total += WEIGHTS.P1 * (P1.occurrences.length || 1);
  if (P2.detected) total += WEIGHTS.P2;
  if (P3.detected) total += WEIGHTS.P3;
  if (P4.detected) total += WEIGHTS.P4 * (P4.occurrences.length || 1);
  if (P5.detected) total += WEIGHTS.P5;
  if (P6.detected) total += WEIGHTS.P6;
  if (P7.detected) total += WEIGHTS.P7;
  if (P8.detected) total += WEIGHTS.P8 * P8.mcpServerCount * 50;
  if (P9.detected) total += WEIGHTS.P9;

  return total;
}

/**
 * Build the display line for a single pattern.
 * @param {string} id        e.g. 'P1'
 * @param {object} pattern
 * @param {object} opts      { mcpThreshold }
 * @returns {string}
 */
function buildPatternLine(id, pattern, opts) {
  const LABELS = {
    P1:  "File discovery commands",
    P2:  "Resume-after-rate-limit rule",
    P3:  "Session turn counter",
    P4:  "Verbose verification checklists",
    P5:  "Stable-context section",
    P6:  "Clear-discipline rule",
    P7:  ".claudeignore coverage",
    P8:  "MCP servers always-on",
    P9:  "CLAUDE.md size",
    P10: "Correction loops",
  };

  const label = LABELS[id] || id;

  if (id === "P10") {
    const passBadge = c("green", "[PASS]");
    return `  ${passBadge}${pad("", 6)}${bold(id)}  ${pad(label, 32)}— active when running: ${c("cyan", "ctg watch")}`;
  }

  const sev = pattern.severity;

  if (!pattern.detected) {
    const passBadge = c("green", "[PASS]");
    const passDetail = buildPassDetail(id, pattern);
    return `  ${passBadge}${pad("", 6)}${bold(id)}  ${pad(label, 32)}${passDetail}`;
  }

  // DETECTED — build detail
  const statusText = buildDetectedDetail(id, pattern, opts);
  const sevBadge = badge(sev);
  const spacing = pad("", 10 - (sev.length + 2)); // "[CRITICAL]" = 10, "[HIGH]" = 6, "[MEDIUM]" = 8
  return `  ${sevBadge}${spacing}${bold(id)}  ${pad(label, 32)}${statusText}`;
}

/**
 * Build the detected detail fragment for a pattern line.
 */
function buildDetectedDetail(id, pattern, opts) {
  const mcpThreshold = (opts && opts.mcpThreshold != null) ? opts.mcpThreshold : 3;

  if (id === "P1") {
    const n = pattern.occurrences.length;
    const first = pattern.occurrences[0];
    const loc = first ? c("gray", `→ ${shortPath(first.file)}:${first.line}`) : "";
    return `${c("red", `DETECTED (${n} occurrence${n !== 1 ? "s" : ""})`)}  ${loc}`;
  }

  if (id === "P2") return c("red", "MISSING — resume-after-rate-limit rule absent");
  if (id === "P3") return c("yellow", "NOT INSTALLED");

  if (id === "P4") {
    const n = pattern.occurrences.length;
    const first = pattern.occurrences[0];
    const loc = first ? c("gray", `→ ${shortPath(first.file)}:${first.line}`) : "";
    return `${c("yellow", `DETECTED (${n} run${n !== 1 ? "s" : ""} ≥ 6 items)`)}  ${loc}`;
  }

  if (id === "P5") return c("cyan", "MISSING — no stable-context section");
  if (id === "P6") return c("cyan", "MISSING — no /clear discipline rule");

  if (id === "P7") {
    const missing = pattern.requiredEntriesMissing;
    if (!pattern.claudeIgnorePresent) {
      return c("red", `.claudeignore missing — ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? " …" : ""} not excluded`);
    }
    return c("red", `incomplete — missing: ${missing.join(", ")}`);
  }

  if (id === "P8") {
    return c("yellow", `${pattern.mcpServerCount} configured (threshold: ${mcpThreshold})`);
  }

  if (id === "P9") {
    let line = c("cyan", `${pattern.lineCount} lines (threshold: 150)`);
    if (pattern.narrativeHeuristic) {
      line += c("gray", " + narrative blocks detected (advisory)");
    }
    return line;
  }

  return c("red", "DETECTED");
}

/**
 * Build the pass detail fragment for a pattern line.
 */
function buildPassDetail(id, pattern) {
  if (id === "P1") return c("green", "No file discovery commands found");
  if (id === "P2") return c("green", "Rule present");
  if (id === "P3") return c("green", "Hook installed");
  if (id === "P4") return c("green", "No oversized checklists");
  if (id === "P5") return c("green", "Present");
  if (id === "P6") return c("green", "Rule present");
  if (id === "P7") return c("green", ".claudeignore present and complete");
  if (id === "P8") return c("green", `${pattern.mcpServerCount} server(s) — within threshold`);
  if (id === "P9") return c("green", `${pattern.lineCount} lines — within limit`);
  return c("green", "OK");
}

/**
 * Shorten an absolute path to the last 2 segments for display.
 * @param {string} filePath
 * @returns {string}
 */
function shortPath(filePath) {
  const parts = filePath.replace(/\\/g, "/").split("/");
  return parts.slice(-2).join("/");
}

/**
 * Print the full audit report to stdout.
 * @param {object} auditResult  — shape as returned by runAudit()
 * @returns {object}            — summary object (for exit code determination in bin/ctg.js)
 */
function printReport(auditResult) {
  const { targetDir, claudeMdPath, settingsPath, summary, patterns, scannedFiles } = auditResult;
  const mcpThreshold = auditResult.mcpThreshold || 3;

  const lines = [];

  // Header
  lines.push("");
  lines.push(bold(`claude-token-guard v1.0.0 — Token Hygiene Audit (10 patterns)`));
  lines.push(`  Scanned: ${c("cyan", targetDir)}`);
  if (claudeMdPath) lines.push(`  CLAUDE.md: ${c("gray", claudeMdPath)}`);
  if (settingsPath) lines.push(`  Settings:  ${c("gray", settingsPath)}`);
  lines.push(`  Markdown files scanned: ${scannedFiles.filter(f => f.endsWith(".md")).length}`);
  lines.push("");

  // Divider
  lines.push(c("gray", "─".repeat(70)));

  // Pattern rows
  const patternIds = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10"];
  for (const id of patternIds) {
    lines.push(buildPatternLine(id, patterns[id], { mcpThreshold }));
  }

  lines.push(c("gray", "─".repeat(70)));
  lines.push("");

  // Summary
  const { total, critical, high, medium, passed } = summary;
  const summaryParts = [];
  if (critical > 0) summaryParts.push(c("red",    `${critical} critical`));
  if (high > 0)     summaryParts.push(c("yellow",  `${high} high`));
  if (medium > 0)   summaryParts.push(c("cyan",    `${medium} medium`));
  if (passed > 0)   summaryParts.push(c("green",   `${passed} passed`));
  lines.push(`  Summary: ${summaryParts.join("  ")}  ${c("gray", `(${total} total)`)}`);
  lines.push("");

  // Token savings
  const savings = computeSavings(patterns);
  if (savings > 0) {
    lines.push(`  Estimated savings: ~${formatTokens(savings)} tokens/session | See METHODOLOGY.md for detail`);
  } else {
    lines.push(`  Estimated savings: none — all patterns pass`);
  }

  lines.push(`  Run: ${c("cyan", "ctg fix --auto")}  to apply all available fixes`);
  lines.push("");

  console.log(lines.join("\n"));

  return summary;
}

module.exports = { printReport };
