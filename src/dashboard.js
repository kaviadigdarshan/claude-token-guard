const path = require('path');
"use strict";

const http = require("http");
const { EventEmitter } = require("events");
const { spawn } = require("child_process");
const { startMonitor } = require("./monitor");

function buildHTML(projectName, projectPath) {
return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>CTG \u2014 ${projectName}</title>
<style>
:root {
  --bg-primary: #0d0d0d;
  --bg-secondary: #1a1a1a;
  --bg-card: #141414;
  --bg-entry: #1e1e1e;
  --border: #2a2a2a;
  --border-strong: #333;
  --text-primary: #e5e5e5;
  --text-secondary: #a0a0a0;
  --text-muted: #666666;
  --text-label: #7a7aff;
  --text-turn: #888888;
  --turn-border: #2a2a2a;
  --toggle-track: #222;
  --header-bg: #0a0a0a;
  --header-border: #1f1f1f;
  --stat-value: #ffffff;
  --live-dot: #22c55e;
}
[data-theme="light"] {
  --bg-primary: #f5f5f5;
  --bg-secondary: #ffffff;
  --bg-card: #ffffff;
  --bg-entry: #f9f9f9;
  --border: #e0e0e0;
  --border-strong: #d0d0d0;
  --text-primary: #111111;
  --text-secondary: #444444;
  --text-muted: #777777;
  --text-label: #4444cc;
  --text-turn: #666666;
  --turn-border: #e0e0e0;
  --toggle-track: #e0e0e0;
  --header-bg: #ffffff;
  --header-border: #e5e5e5;
  --stat-value: #111111;
  --live-dot: #16a34a;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: var(--bg-primary); color: var(--text-primary); font-family: monospace; font-size: 14px; padding: 20px; }
h1 { color: var(--text-label); margin-bottom: 16px; font-size: 18px; letter-spacing: 1px; }
.ticker { background: var(--bg-secondary); border: 1px solid var(--border-strong); border-radius: 6px; padding: 14px 18px; margin-bottom: 16px; display: flex; gap: 32px; align-items: center; }
.metric { display: flex; flex-direction: column; }
.metric-label { color: var(--text-secondary); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
.metric-value { color: var(--stat-value); font-size: 22px; font-weight: bold; margin-top: 2px; }
#status { font-size: 11px; color: var(--live-dot); margin-left: auto; }
.log-wrap { background: var(--bg-secondary); border: 1px solid var(--border-strong); border-radius: 6px; overflow: hidden; }
#alert-log { height: 380px; overflow-y: auto; padding: 8px 0; }
.entry { padding: 5px 14px; border-bottom: 1px solid var(--header-bg); display: flex; gap: 10px; align-items: baseline; }
.entry:last-child { border-bottom: none; }
.ts { color: var(--text-muted); font-size: 11px; flex-shrink: 0; }
.badge { font-size: 10px; font-weight: bold; padding: 1px 6px; border-radius: 3px; flex-shrink: 0; }
.r1, .r2, .r3 { background: #4d2600; color: #f0883e; }
.r4, .r5 { background: #4d3800; color: #d29922; }
.r6 { background: #2d1f4e; color: #bc8cff; }
.msg { color: var(--text-primary); }
.empty { padding: 16px 14px; color: var(--text-muted); font-style: italic; }
</style>
</head>
<body>
<h1>
  <span style="color:var(--text-label);font-weight:700;font-family:monospace;font-size:16px;letter-spacing:1px">CTG</span>
  <span style="color:var(--text-secondary);font-size:14px;margin-left:6px">\u2014</span>
  <span style="color:var(--text-primary);font-size:14px;margin-left:6px">${projectName}</span>
</h1>
<div class="ticker">
  <div class="metric"><span class="metric-label">Session Tokens</span><span class="metric-value" id="session-tokens">—</span></div>
  <div class="metric"><span class="metric-label">Turns</span><span class="metric-value" id="turn-count">—</span></div>
  <div class="metric"><span class="metric-label">Alerts</span><span class="metric-value" id="alert-count">0</span></div>
  <span id="status">connecting…</span>
  <button id="theme-btn" onclick="toggleTheme()" style="background:none;border:1px solid var(--border-strong);border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px;color:var(--text-secondary);display:flex;align-items:center;gap:6px;transition:all 0.2s">
    <span id="theme-icon">&#9728;&#65039;</span>
    <span id="theme-label">Light</span>
  </button>
</div>
<div style="padding:2px 16px 8px;color:var(--text-muted);font-size:11px;font-family:monospace">${projectPath}</div>
<div class="log-wrap">
  <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--bg-secondary);border-bottom:1px solid var(--border-strong)">
    <span style="color:var(--text-secondary);font-size:11px;letter-spacing:1px">ALERT LOG</span>
    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:var(--text-secondary);font-size:11px">
      <span id="toggle-label">ALERTS ONLY</span>
      <div id="toggle" onclick="toggleMode()" style="width:36px;height:20px;background:var(--toggle-track);border-radius:10px;position:relative;cursor:pointer;transition:background 0.2s">
        <div id="toggle-knob" style="width:16px;height:16px;background:var(--text-secondary);border-radius:50%;position:absolute;top:2px;left:2px;transition:left 0.2s,background 0.2s"></div>
      </div>
    </label>
  </div>
  <div id="alert-log"><div class="empty">No alerts yet.</div></div>
</div>
<script>
let alertCount = 0;
let showAllLogs = false;
let allEvents = [];

function toggleTheme() {
  const html = document.documentElement;
  const isLight = html.getAttribute('data-theme') === 'light';
  html.setAttribute('data-theme', isLight ? 'dark' : 'light');
  localStorage.setItem('ctg-theme', isLight ? 'dark' : 'light');
  document.getElementById('theme-icon').textContent = isLight ? '\u2600\ufe0f' : '\ud83c\udf19';
  document.getElementById('theme-label').textContent = isLight ? 'Light' : 'Dark';
}

(function() {
  var saved = localStorage.getItem('ctg-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  if (saved === 'light') {
    document.getElementById('theme-icon').textContent = '\ud83c\udf19';
    document.getElementById('theme-label').textContent = 'Dark';
  }
})();

function toggleMode() {
  showAllLogs = !showAllLogs;
  document.getElementById('toggle-label').textContent = showAllLogs ? 'ALL LOGS' : 'ALERTS ONLY';
  const knob = document.getElementById('toggle-knob');
  const track = document.getElementById('toggle');
  knob.style.left = showAllLogs ? '18px' : '2px';
  knob.style.background = showAllLogs ? '#22c55e' : 'var(--text-secondary)';
  track.style.background = showAllLogs ? '#166534' : 'var(--toggle-track)';
  rebuildLog();
}

function rebuildLog() {
  const log = document.getElementById('alert-log');
  log.innerHTML = '';
  const filtered = showAllLogs ? allEvents : allEvents.filter(function(e) { return e.rule > 0; });
  if (filtered.length === 0) {
    log.innerHTML = '<div style="color:var(--text-muted);font-style:italic;padding:12px">No entries yet.</div>';
    return;
  }
  var rev = filtered.slice().reverse();
  for (var i = 0; i < rev.length; i++) { appendEntry(rev[i], log); }
}

function appendEntry(d, container) {
  if (d.type === 'history-end') return;
  var div = document.createElement('div');
  var time = new Date(d.timestamp).toLocaleTimeString();
  if (d.type === 'turn') {
    div.style.cssText = 'padding:4px 12px;margin:2px 0;font-family:monospace;font-size:12px;color:var(--text-turn);border-left:3px solid var(--turn-border)';
    div.textContent = time + '  +' + (d.tokens/1000).toFixed(1) + 'k tokens (' + d.model + ') | total: ' + (d.sessionTotal/1000).toFixed(1) + 'k';
  } else {
    var color = d.rule===6 ? '#a855f7' : d.rule===5 ? '#eab308' : d.rule===4 ? '#eab308' : d.rule===2 ? '#3b82f6' : '#f97316';
    var label = 'R' + d.rule;
    div.style.cssText = 'padding:8px 12px;margin:4px 0;font-family:monospace;font-size:13px;white-space:pre-wrap;border-left:3px solid ' + color;
    div.style.color = 'var(--text-primary)';
    div.style.background = 'var(--bg-entry)';
    div.innerHTML = '<span style="color:' + color + ';font-size:10px;margin-right:8px">' + label + '</span>' + time + '  ' + d.message;
  }
  container.appendChild(div);
}

const es = new EventSource('/events');
es.onmessage = function(e) {
  const d = JSON.parse(e.data);
  if (d.type === 'history-end') return;

  if (d.type === 'session-reset') {
    alertCount = 0;
    allEvents = [];
    document.getElementById('session-tokens').textContent = '—';
    document.getElementById('turn-count').textContent = '—';
    document.getElementById('alert-count').textContent = '0';

    const log = document.getElementById('alert-log');
    log.innerHTML = '';
    const banner = document.createElement('div');
    banner.style.cssText = 'padding:10px 12px;margin:4px 0;font-family:monospace;' +
      'font-size:12px;color:var(--live-dot);border-left:3px solid var(--live-dot);' +
      'background:var(--bg-entry)';
    banner.textContent = '\u2500\u2500 /clear detected at ' + new Date(d.timestamp).toLocaleTimeString() + ' \u2014 session reset \u2500\u2500';
    log.appendChild(banner);
    return;
  }

  if (d.type === 'turn') {
    document.getElementById('session-tokens').textContent =
      d.sessionTotal >= 1000000
        ? (d.sessionTotal/1000000).toFixed(2) + 'M'
        : (d.sessionTotal/1000).toFixed(1) + 'k';
    document.getElementById('turn-count').textContent = d.turnCount;
  } else {
    alertCount++;
    document.getElementById('alert-count').textContent = alertCount;
  }

  allEvents.push(d);
  rebuildLog();
};
es.onerror = function() { document.getElementById('status').textContent = 'reconnecting\u2026'; };
es.onopen = function() { document.getElementById('status').textContent = 'live'; };
</script>
</body>
</html>`;
}

function sendNotification(msg) {
  const platform = process.platform;
  if (platform === "darwin") {
    spawn("osascript", ["-e", `display notification "${msg.replace(/"/g, '\\"')}"`]);
  } else if (platform === "linux") {
    spawn("notify-send", ["CTG Alert", msg]);
  }
  // Windows: skip silently
}

function startDashboard(targetDir, opts = {}) {
  const dir = (typeof targetDir === 'string')
    ? targetDir
    : (targetDir?.dir || targetDir?.path || process.cwd());
  const notify = opts.notify === true;
  const projectName = path.basename(path.resolve(dir));
  const projectPath = path.resolve(dir);
  const html = buildHTML(projectName, projectPath);

  const emitter = new EventEmitter();
  const clients = new Set();
  const eventHistory = [];
  const MAX_HISTORY = 2000;

  startMonitor({
    ...opts.monitorOpts,
    onSpike(e) {
      emitter.emit("spike", e);
    },
  });

  function broadcast(payload) {
    const chunk = `data:${JSON.stringify(payload)}\n\n`;
    for (const res of clients) {
      try { res.write(chunk); } catch { clients.delete(res); }
    }
  }

  emitter.on("spike", (alert) => {
    if (alert.type === 'session-reset') {
      eventHistory.length = 0;
      broadcast(alert);
      return;
    }
    eventHistory.push(alert);
    if (eventHistory.length > MAX_HISTORY) eventHistory.shift();
    broadcast(alert);
    if (notify && alert.message) sendNotification(alert.message);
  });

  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (req.method === "GET" && req.url === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });
      res.flushHeaders();
      for (const evt of eventHistory) {
        res.write('data:' + JSON.stringify(evt) + '\n\n');
      }
      res.write('data:' + JSON.stringify({ type: 'history-end' }) + '\n\n');
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  const DEFAULT_PORT = 7842;

  function findAvailablePort(startPort, callback) {
    const net = require('net');
    const tester = net.createServer();
    tester.once('error', () => {
      findAvailablePort(startPort + 1, callback);
    });
    tester.once('listening', () => {
      tester.close(() => callback(startPort));
    });
    tester.listen(startPort, '127.0.0.1');
  }

  findAvailablePort(DEFAULT_PORT, (port) => {
    server.listen(port, '127.0.0.1', () => {
      const url = 'http://localhost:' + port;
      console.log('Open your browser -> ' + url + '  (Ctrl+C to stop)');
      console.log('CTG Dashboard: ' + url);
    });
  });

  return server;
}

module.exports = { startDashboard };
