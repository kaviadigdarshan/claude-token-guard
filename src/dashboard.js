"use strict";

const http = require("http");
const { EventEmitter } = require("events");
const { spawn } = require("child_process");
const { startMonitor } = require("./monitor");

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>CTG Dashboard</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #0d1117; color: #e6edf3; font-family: monospace; font-size: 14px; padding: 20px; }
h1 { color: #58a6ff; margin-bottom: 16px; font-size: 18px; letter-spacing: 1px; }
.ticker { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 14px 18px; margin-bottom: 16px; display: flex; gap: 32px; align-items: center; }
.metric { display: flex; flex-direction: column; }
.metric-label { color: #8b949e; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
.metric-value { color: #79c0ff; font-size: 22px; font-weight: bold; margin-top: 2px; }
#status { font-size: 11px; color: #3fb950; margin-left: auto; }
.log-wrap { background: #161b22; border: 1px solid #30363d; border-radius: 6px; overflow: hidden; }
.log-header { padding: 8px 14px; background: #21262d; color: #8b949e; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
#log { height: 380px; overflow-y: auto; padding: 8px 0; }
.entry { padding: 5px 14px; border-bottom: 1px solid #21262d; display: flex; gap: 10px; align-items: baseline; }
.entry:last-child { border-bottom: none; }
.ts { color: #484f58; font-size: 11px; flex-shrink: 0; }
.badge { font-size: 10px; font-weight: bold; padding: 1px 6px; border-radius: 3px; flex-shrink: 0; }
.r1, .r2, .r3 { background: #4d2600; color: #f0883e; }
.r4, .r5 { background: #4d3800; color: #d29922; }
.r6 { background: #2d1f4e; color: #bc8cff; }
.msg { color: #c9d1d9; }
.empty { padding: 16px 14px; color: #484f58; font-style: italic; }
</style>
</head>
<body>
<h1>CTG — Claude Token Guard</h1>
<div class="ticker">
  <div class="metric"><span class="metric-label">Session Tokens</span><span class="metric-value" id="sessionTotal">—</span></div>
  <div class="metric"><span class="metric-label">Turns</span><span class="metric-value" id="turnCount">—</span></div>
  <div class="metric"><span class="metric-label">Alerts</span><span class="metric-value" id="spikes">0</span></div>
  <span id="status">connecting…</span>
</div>
<div class="log-wrap">
  <div class="log-header">Alert Log</div>
  <div id="log"><div class="empty">No alerts yet.</div></div>
</div>
<script>
const ruleClass = r => r <= 3 ? 'r1' : r <= 5 ? 'r4' : 'r6';
const fmt = n => n >= 1000000 ? (n/1000000).toFixed(2)+'M' : n >= 1000 ? Math.round(n/1000)+'k' : String(n);
const pad = n => String(n).padStart(2,'0');
function ts() {
  const d = new Date();
  return pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds());
}
let alertCount = 0;
const es = new EventSource('/events');
es.addEventListener('data', e => {
  const d = JSON.parse(e.data);
  if (d.stats) {
    document.getElementById('sessionTotal').textContent = fmt(d.stats.sessionTotal);
    document.getElementById('turnCount').textContent = d.stats.turnCount;
  }
  if (d.alert) {
    alertCount++;
    document.getElementById('spikes').textContent = alertCount;
    const log = document.getElementById('log');
    const empty = log.querySelector('.empty');
    if (empty) empty.remove();
    const div = document.createElement('div');
    div.className = 'entry';
    const cls = ruleClass(d.alert.rule);
    div.innerHTML = '<span class="ts">'+ts()+'</span>'
      +'<span class="badge '+cls+'">R'+d.alert.rule+'</span>'
      +'<span class="msg">'+d.alert.message+'</span>';
    log.prepend(div);
  }
  document.getElementById('status').textContent = 'live';
});
es.onerror = () => { document.getElementById('status').textContent = 'reconnecting…'; };
es.onopen = () => { document.getElementById('status').textContent = 'live'; };
</script>
</body>
</html>`;

function sendNotification(msg) {
  const platform = process.platform;
  if (platform === "darwin") {
    spawn("osascript", ["-e", `display notification "${msg.replace(/"/g, '\\"')}"`]);
  } else if (platform === "linux") {
    spawn("notify-send", ["CTG Alert", msg]);
  }
  // Windows: skip silently
}

function startDashboard(opts = {}) {
  const port = opts.port != null ? opts.port : 7842;
  const notify = opts.notify === true;

  const emitter = new EventEmitter();
  const clients = new Set();

  startMonitor({
    ...opts.monitorOpts,
    onSpike(e) {
      emitter.emit("spike", e);
    },
  });

  function broadcast(payload) {
    const chunk = `event:data\ndata:${JSON.stringify(payload)}\n\n`;
    for (const res of clients) {
      try { res.write(chunk); } catch { clients.delete(res); }
    }
  }

  emitter.on("spike", (alert) => {
    broadcast({ alert });
    if (notify) sendNotification(alert.message);
  });

  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(HTML);
      return;
    }

    if (req.method === "GET" && req.url === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });
      res.flushHeaders();
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  function tryBind(tryPort) {
    server.listen(tryPort, "127.0.0.1", () => {
      console.log("CTG Dashboard: http://localhost:" + tryPort);
    });

    server.once("error", (err) => {
      if (err.code === "EADDRINUSE") {
        const next = tryPort + 1;
        if (next > port + 7) {
          console.error("CTG: all ports " + port + "-" + (port + 7) + " in use");
          process.exit(1);
        }
        server.close();
        tryBind(next);
      } else {
        throw err;
      }
    });
  }

  tryBind(port);
  return server;
}

module.exports = { startDashboard };
