"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const P1_LIVE_REGEX = /\b(cat\s+[~\/]|grep\s+-r)/i;
const P10_MSG_MIN_CHARS = 30;
const P10_WINDOW_SIZE = 5;
const SPIKE_TURN_THRESHOLD = 200_000;
const SPIKE_SESSION_THRESHOLD = 1_000_000;
const SPIKE_TREND_THRESHOLD = 150_000;
const CACHE_MISS_THRESHOLD = 50_000;
const TREND_WINDOW = 3;
const MCP_REFINED_MIN_TURNS = 20;

let _historyLogged = false;

function resolveSessionFile(targetDir) {
  // Claude Code encodes project path by replacing all / with -
  const encoded = path.resolve(targetDir).replace(/[\/\_]/g, '-');

  // Check both new (v1.0.30+) and legacy locations
  const candidates = [
    path.join(os.homedir(), '.config', 'claude', 'projects', encoded),
    path.join(os.homedir(), '.claude', 'projects', encoded),
  ];

  // Also honour explicit overrides
  if (process.env.CTG_TRANSCRIPT_PATH) return process.env.CTG_TRANSCRIPT_PATH;

  for (const dir of candidates) {
    if (!fs.existsSync(dir)) continue;
    // Pick the most recently modified .jsonl in this project's dir
    // Skip agent-*.jsonl (sub-agent sidechains) — watch main session only
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.jsonl') && !f.startsWith('agent-'))
      .map(f => ({ f, mt: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mt - a.mt);
    if (files.length) return path.join(dir, files[0].f);
  }
  return null;
}

/**
 * Normalize a user message for P10 loop detection.
 * @param {string} text
 * @returns {string}
 */
function normalizeMsg(text) {
  return text.toLowerCase().trim().replace(/\s+/g, " ").substring(0, 200);
}

/**
 * Extract plain text from a content field (string or array of blocks).
 * @param {string|Array} content
 * @returns {string}
 */
function extractText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b && b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join(" ");
  }
  return "";
}

/**
 * Write one session record to ~/.ctg/sessions/history.jsonl
 * @param {object} record
 * @param {boolean} noHistory
 */
function appendHistory(record, noHistory) {
  if (noHistory) return;
  const histDir = path.join(os.homedir(), ".ctg", "sessions");
  try {
    fs.mkdirSync(histDir, { recursive: true });
    const histFile = path.join(histDir, "history.jsonl");
    const line = JSON.stringify(record) + "\n";
    fs.appendFileSync(histFile, line, "utf8");
    if (!_historyLogged) {
      _historyLogged = true;
      console.log("CTG: session logged to ~/.ctg/sessions/ (--no-history to disable)");
    }
  } catch {
    // best-effort
  }
}

/**
 * Start monitoring a Claude Code JSONL session file.
 *
 * @param {object} opts
 * @param {string} [opts.sessionFile]   Explicit path to .jsonl file
 * @param {string} [opts.dir]           Unused (reserved for future use)
 * @param {boolean} [opts.notify]       Reserved
 * @param {Function} [opts.onSpike]     Callback fired on each alert
 * @param {boolean} [opts.noHistory]    Skip ~/.ctg/sessions writes
 * @param {number} [opts.mcpThreshold]  Override default P8 threshold (3)
 * @returns {{ stop: Function, getStats: Function }}
 */
function getMostRecentSessionFile(projectDir) {
  const encoded = path.resolve(projectDir).replace(/[\/\_]/g, '-');
  const sessionDir = path.join(os.homedir(), '.claude', 'projects', encoded);
  try {
    const files = fs.readdirSync(sessionDir)
      .filter(f => f.endsWith('.jsonl') && !f.includes('agent'))
      .map(f => ({
        file: path.join(sessionDir, f),
        mtime: fs.statSync(path.join(sessionDir, f)).mtimeMs
      }))
      .sort((a, b) => b.mtime - a.mtime);
    return files[0]?.file || null;
  } catch(e) { return null; }
}

function startMonitor(opts = {}) {
  let sessionFile = opts.sessionFile || resolveSessionFile(opts.dir || process.cwd());
  if (!sessionFile) {
    console.error('CTG: No Claude Code session found for', opts.dir || process.cwd());
    console.error('CTG: Start a Claude Code session first, or set CTG_TRANSCRIPT_PATH=<path>');
    process.exit(1);
  }
  const onSpike = typeof opts.onSpike === "function" ? opts.onSpike : null;

  let lastByteOffset = 0;
  let sessionTotal = 0;
  let tokensThisTurn = 0;
  let turnCount = 0;
  const turnHistory = []; // last TREND_WINDOW turn totals
  const userMsgWindow = []; // last P10_WINDOW_SIZE normalized user messages
  let spikesDetected = 0;
  let correctionLoopsDetected = 0;
  let lastMilestoneReported = 0;

  // For getP8RefinedResult
  const recentToolUseServers = new Set();
  let processedLineCount = 0;

  function fireAlert(alertObj) {
    spikesDetected++;
    process.stderr.write("CTG ALERT: " + alertObj.message + "\n");
    if (onSpike) onSpike(alertObj);
  }

  function processLine(line) {
    processedLineCount++;
    const ts = Date.now();

    // ── Token accounting ──────────────────────────────────────────────
    const u = line.message?.usage || {};
    const t = (u.input_tokens||0) + (u.output_tokens||0)
            + (u.cache_read_input_tokens||0)
            + (u.cache_creation_input_tokens||0);
    tokensThisTurn += t;
    sessionTotal += t;

    // FIX 3 — Per-turn token display
    if (t > 0) {
	const rawModel = line.message?.model?.replace('claude-', '') || 'unknown';
	const model = rawModel.replace(/-(\d+)-(\d+)$/, '-$1.$2');
      console.log(`[TURN] +${(t/1000).toFixed(1)}k tokens (${model}) | session total: ${(sessionTotal/1000).toFixed(1)}k`);
      opts.onSpike?.({
        rule: 0,
        type: 'turn',
        tokens: t,
        sessionTotal,
        turnCount,
        model,
        timestamp: Date.now()
      });
    }

    // ── Rule 5 — P1 live detection ────────────────────────────────────
    const toolUse = line.message?.content?.find(c => c.type === 'tool_use');
    const cmd = toolUse?.input?.command || '';
    const toolName = toolUse?.name || 'Bash';
    if (cmd && /\b(cat\s+[~\/]|grep\s+-[a-zA-Z]*r[a-zA-Z]*\s+[~\/]|ls\s+-[a-zA-Z]*\s+[~\/])/i.test(cmd)) {
      const preview = cmd.length > 80 ? cmd.substring(0, 80) + '...' : cmd;
      const msg = `P1 LIVE [${toolName}]: dangerous file-discovery command detected.\n  CMD: ${preview}`;
      opts.onSpike?.({ rule: 5, message: msg, tokens: 0, timestamp: Date.now() });
      console.error('CTG ALERT:', msg);
    }

    // ── Rule 6 — P10 correction loop ──────────────────────────────────
    const isUserMsg = line.type === "human" || line.role === "user";
    if (isUserMsg) {
      const raw = extractText(line.content);
      const norm = normalizeMsg(raw);
      if (norm.length >= P10_MSG_MIN_CHARS) {
        if (userMsgWindow.includes(norm)) {
          correctionLoopsDetected++;
          const count = userMsgWindow.filter((m) => m === norm).length + 1;
          const normalizedText = norm;
          const alert = {
            rule: 6,
            message: `P10 CORRECTION LOOP: same instruction seen ${count} times.\n  PROMPT: "${normalizedText.substring(0, 60)}..."\n  → Run /clear and rewrite the initial prompt.`,
            tokens: 0,
            timestamp: ts,
          };
          process.stderr.write("CTG ALERT: " + alert.message + "\n");
          if (onSpike) onSpike(alert);
        }
        userMsgWindow.push(norm);
        if (userMsgWindow.length > P10_WINDOW_SIZE) userMsgWindow.shift();
      }
    }

    // ── MCP server tracking (for getP8RefinedResult) ──────────────────
    if (line.type === "tool_use" && typeof line.name === "string") {
      // server name is the prefix before the first "__" (Claude Code convention)
      const serverName = line.name.includes("__")
        ? line.name.split("__")[0]
        : line.name;
      recentToolUseServers.add(serverName);
    }

    // ── End-of-turn boundary: assistant messages close a turn ─────────
    const isAssistant = line.type === "assistant" || line.role === "assistant";
    if (isAssistant && tokensThisTurn > 0) {
      turnCount++;
      const turnTokens = tokensThisTurn;

      // Rule 1 — Single turn spike
      if (turnTokens > SPIKE_TURN_THRESHOLD) {
        fireAlert({
          rule: 1,
          message: `SPIKE Rule 1: turn used ${(tokensThisTurn/1000).toFixed(1)}k tokens`,
          tokens: turnTokens,
          timestamp: ts,
        });
      }

      // Rule 2 — Session total (milestone-based, fires every 100k above 1M)
      const milestone = Math.floor(sessionTotal / 100_000) * 100_000;
      if (milestone > lastMilestoneReported && milestone >= 1_000_000) {
        lastMilestoneReported = milestone;
        fireAlert({
          rule: 2,
          message: `SESSION crossed ${(milestone/1_000_000).toFixed(1)}M tokens total`,
          tokens: sessionTotal,
          timestamp: ts,
        });
      }

      // Rule 3 — 3-turn trend
      turnHistory.push(turnTokens);
      if (turnHistory.length > TREND_WINDOW) turnHistory.shift();
      if (turnHistory.length === TREND_WINDOW) {
        const avg = turnHistory.reduce((a, b) => a + b, 0) / TREND_WINDOW;
        if (avg > SPIKE_TREND_THRESHOLD) {
          fireAlert({
            rule: 3,
            message: `TREND: 3-turn avg ${(avg/1000).toFixed(1)}k tokens — context growing fast`,
            tokens: avg,
            timestamp: ts,
          });
        }
      }

      // Rule 4 — Cache miss on large turn
      if ((u.cache_read_input_tokens||0)===0 && t>50_000) {
        fireAlert({
          rule: 4,
          message: `CACHE MISS on large turn (${(tokensThisTurn/1000).toFixed(1)}k tokens) — prompt caching not active`,
          tokens: turnTokens,
          timestamp: ts,
        });
      }

      tokensThisTurn = 0;
    }
  }

  function readNewBytes() {
    let stat;
    try {
      stat = fs.statSync(sessionFile);
    } catch {
      return;
    }

    if (stat.size <= lastByteOffset) return;

    const fd = fs.openSync(sessionFile, "r");
    const len = stat.size - lastByteOffset;
    const buf = Buffer.allocUnsafe(len);
    const bytesRead = fs.readSync(fd, buf, 0, len, lastByteOffset);
    fs.closeSync(fd);

    if (bytesRead === 0) return;
    lastByteOffset += bytesRead;

    const chunk = buf.slice(0, bytesRead).toString("utf8");
    const rawLines = chunk.split("\n").filter((l) => l.trim().length > 0);

    if (bytesRead >= 50 && rawLines.length === 0) {
      process.stderr.write(
        "CTG: JSONL format unrecognised. Validate Claude Code version.\n"
      );
      process.exit(1);
    }

    let parsedCount = 0;
    for (const raw of rawLines) {
      try {
        const parsed = JSON.parse(raw);
        processLine(parsed);
        parsedCount++;
      } catch {
        // skip malformed lines silently
      }
    }

    if (bytesRead >= 50 && parsedCount === 0) {
      process.stderr.write(
        "CTG: JSONL format unrecognised. Validate Claude Code version.\n"
      );
      process.exit(1);
    }
  }

  // Seed offset from current file size (skip history unless noHistory=false)
  try {
    const stat = fs.statSync(sessionFile);
    lastByteOffset = opts.noHistory ? stat.size : 0;
  } catch {
    lastByteOffset = 0;
  }

  // Read any existing content first
  if (lastByteOffset === 0) readNewBytes();

  function pollFile() {
    try {
      const stat = fs.statSync(sessionFile);
      if (stat.size <= lastByteOffset) return;
      const fd = fs.openSync(sessionFile, 'r');
      const newBytes = stat.size - lastByteOffset;
      const buf = Buffer.alloc(newBytes);
      fs.readSync(fd, buf, 0, newBytes, lastByteOffset);
      fs.closeSync(fd);
      lastByteOffset = stat.size;
      const lines = buf.toString('utf8').split('\n').filter(l => l.trim());
      for (const line of lines) {
        try { processLine(JSON.parse(line)); } catch(e) {}
      }
    } catch(e) {}
  }
  console.log('CTG: watching', sessionFile);
  const _pollInterval = setInterval(pollFile, 500);

  // Session change watcher — runs every 3 seconds
  const _sessionWatcher = setInterval(() => {
    if (process.env.CTG_TRANSCRIPT_PATH || opts.sessionFile) return;
    const latest = getMostRecentSessionFile(opts.dir || process.cwd());
    if (latest && latest !== sessionFile) {
      sessionFile = latest;
      lastByteOffset = 0;
      sessionTotal = 0;
      turnCount = 0;
      lastMilestoneReported = 0;

      console.log('\n─────────────────────────────────────');
      console.log(`CTG: /clear detected — new session started`);
      console.log(`CTG: watching ${sessionFile}`);
      console.log('─────────────────────────────────────\n');

      opts.onSpike?.({
        rule: 0,
        type: 'session-reset',
        sessionFile: sessionFile,
        timestamp: Date.now()
      });
    }
  }, 3000);

  function stop() {
    clearInterval(_pollInterval);
    clearInterval(_sessionWatcher);
    appendHistory(
      {
        date: new Date().toISOString(),
        sessionFile,
        totalTokens: sessionTotal,
        spikesDetected,
        correctionLoopsDetected,
      },
      opts.noHistory
    );
  }

  process.on("exit", stop);
  process.on("SIGINT", () => {
    stop();
    process.exit(0);
  });

  function getStats() {
    return { sessionTotal, turnCount, spikesDetected, correctionLoopsDetected };
  }

  // Attach getP8RefinedResult to the returned handle so callers can use it
  // without needing a separate import path.
  function getP8RefinedResultBound(auditOpts = {}) {
    return getP8RefinedResult({ recentToolUseServers, processedLineCount, auditOpts });
  }

  return { stop, getStats, getP8RefinedResult: getP8RefinedResultBound };
}

/**
 * Compute a refined P8 result by cross-referencing settings.json mcpServers
 * against actual tool_use calls seen in the last 20 turns of the session.
 *
 * @param {object} internal  Internal state passed from startMonitor
 * @returns {{ uncalledServers: string[], calledServers: string[], refinedDetected: boolean }}
 */
function getP8RefinedResult({ recentToolUseServers, processedLineCount, auditOpts = {} }) {
  const settingsPath = path.join(process.cwd(), ".claude", "settings.json");
  let mcpServers = {};

  if (fs.existsSync(settingsPath)) {
    try {
      const raw = fs.readFileSync(settingsPath, "utf8");
      const parsed = JSON.parse(raw);
      mcpServers = parsed.mcpServers || {};
    } catch {
      // ignore parse errors
    }
  }

  const allKeys = Object.keys(mcpServers);
  const calledServers = allKeys.filter((k) => recentToolUseServers.has(k));
  const uncalledServers = allKeys.filter((k) => !recentToolUseServers.has(k));
  const threshold = auditOpts.mcpThreshold != null ? auditOpts.mcpThreshold : 3;
  const refinedDetected = processedLineCount >= MCP_REFINED_MIN_TURNS
    ? uncalledServers.length > threshold
    : false;

  return { uncalledServers, calledServers, refinedDetected };
}

module.exports = { startMonitor, getP8RefinedResult };
