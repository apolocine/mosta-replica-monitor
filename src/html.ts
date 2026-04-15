// @mostajs/replica-monitor — embedded UI (HTML + vanilla JS + CSS)
// Author: Dr Hamid MADANI drmdh@msn.com
//
// All served as a single `text/html` response at GET /. No build step, no
// bundler, no React — keeps the package dep-free.

export const INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>@mostajs/replica-monitor</title>
<style>
  :root {
    --bg:#0d1117; --fg:#c9d1d9; --muted:#8b949e; --accent:#58a6ff;
    --ok:#3fb950; --warn:#d29922; --err:#f85149; --card:#161b22; --border:#30363d;
  }
  * { box-sizing: border-box; }
  body { margin:0; font: 14px/1.5 ui-monospace,Menlo,Monaco,Consolas,monospace; background:var(--bg); color:var(--fg); }
  header { padding: 12px 20px; border-bottom: 1px solid var(--border); display:flex; gap:16px; align-items:center; }
  header h1 { margin:0; font-size:16px; font-weight:600; color:var(--accent); }
  header .pill { padding:2px 8px; border-radius:12px; background:var(--card); border:1px solid var(--border); font-size:12px; color:var(--muted); }
  header #conn.ok  { color: var(--ok); }
  header #conn.err { color: var(--err); }
  nav { padding: 8px 20px; border-bottom: 1px solid var(--border); display:flex; gap:8px; }
  nav button { background:transparent; color:var(--muted); border:1px solid var(--border); padding:6px 12px; cursor:pointer; border-radius:6px; font:inherit; }
  nav button.active { background:var(--card); color:var(--accent); border-color:var(--accent); }
  main { padding: 20px; }
  .tab { display:none; }
  .tab.active { display:block; }
  .cards { display:grid; grid-template-columns: repeat(auto-fill, minmax(320px,1fr)); gap:12px; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:8px; padding:14px; }
  .card h3 { margin:0 0 8px 0; font-size:14px; display:flex; gap:8px; align-items:center; }
  .card h3 .role-master { color:var(--accent); }
  .card h3 .role-slave  { color:var(--muted); }
  .card .k { color:var(--muted); display:inline-block; min-width:90px; }
  .card .v { color:var(--fg); }
  .state-up    { color:var(--ok); }
  .state-down  { color:var(--err); }
  .state-unknown, .state-connecting { color:var(--warn); }
  .lag-good { color:var(--ok); }
  .lag-warn { color:var(--warn); }
  .lag-bad  { color:var(--err); }
  .badge { display:inline-block; padding:1px 6px; border-radius:4px; font-size:11px; background:var(--card); border:1px solid var(--border); }
  .activity { font-size:12px; max-height:70vh; overflow:auto; border:1px solid var(--border); border-radius:8px; padding:6px 10px; background:var(--card); }
  .activity .ev { padding:3px 0; border-bottom:1px dotted var(--border); }
  .activity .ev:last-child { border-bottom:none; }
  .activity .ts { color:var(--muted); margin-right:8px; }
  .ev-replica-added    { color:var(--ok); }
  .ev-replica-removed  { color:var(--err); }
  .ev-replica-promoted { color:var(--accent); font-weight:600; }
  .ev-replica-state    { color:var(--muted); }
  .ev-rule-added       { color:var(--ok); }
  .ev-rule-removed     { color:var(--err); }
  .ev-rule-sync-start  { color:var(--accent); }
  .ev-rule-sync-done   { color:var(--ok); }
  .ev-error            { color:var(--err); }
  .empty { color:var(--muted); font-style: italic; padding: 20px; text-align:center; }
  .sparkline { display:inline-block; vertical-align: middle; margin-left: 8px; }
</style>
</head>
<body>
<header>
  <h1>@mostajs/replica-monitor</h1>
  <span class="pill" id="conn">connecting…</span>
  <span class="pill" id="summary"></span>
  <span class="pill" id="tick">—</span>
</header>
<nav>
  <button data-tab="replicas" class="active">Replicas</button>
  <button data-tab="rules">CDC rules</button>
  <button data-tab="activity">Activity</button>
</nav>
<main>
  <section id="replicas" class="tab active"><div class="cards" id="rep-cards"></div></section>
  <section id="rules" class="tab"><div class="cards" id="rule-cards"></div></section>
  <section id="activity" class="tab"><div class="activity" id="activity-log"></div></section>
</main>
<script>
const TOKEN = new URLSearchParams(location.search).get('token');
const qs = TOKEN ? '?token=' + encodeURIComponent(TOKEN) : '';
const authHeaders = TOKEN ? { 'Authorization': 'Bearer ' + TOKEN } : {};

// --- Tabs ---
for (const btn of document.querySelectorAll('nav button')) {
  btn.onclick = () => {
    for (const b of document.querySelectorAll('nav button')) b.classList.toggle('active', b === btn);
    for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.id === btn.dataset.tab);
  };
}

// --- State ---
const lagHistory = new Map(); // key: project/name → number[]

// --- Fetch helpers ---
async function fetchJSON(path) {
  const r = await fetch(path + qs, { headers: authHeaders });
  if (!r.ok) throw new Error(path + ' → ' + r.status);
  return r.json();
}

function pushLag(key, lag) {
  let arr = lagHistory.get(key); if (!arr) { arr = []; lagHistory.set(key, arr); }
  arr.push(lag ?? 0);
  if (arr.length > 30) arr.shift();
}

function sparkline(values) {
  if (!values || values.length < 2) return '';
  const w = 80, h = 20;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - (v / max) * h]);
  const d = 'M' + pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' L');
  return '<svg class="sparkline" width="' + w + '" height="' + h + '"><path d="' + d + '" fill="none" stroke="#58a6ff" stroke-width="1"/></svg>';
}

function lagClass(ms) {
  if (ms == null) return 'lag-warn';
  if (ms < 1000)  return 'lag-good';
  if (ms < 5000)  return 'lag-warn';
  return 'lag-bad';
}

function renderReplicas(data) {
  const container = document.getElementById('rep-cards');
  let totalReps = 0, masters = 0;
  const html = [];
  for (const [project, reps] of Object.entries(data)) {
    for (const r of reps) {
      totalReps++;
      if (r.role === 'master') masters++;
      const key = project + '/' + r.name;
      pushLag(key, r.lag);
      const state = r.state || 'unknown';
      html.push(
        '<div class="card">' +
          '<h3><span class="role-' + r.role + '">' + (r.role === 'master' ? '★' : '•') + ' ' + r.name + '</span>' +
            '<span class="badge">' + project + '</span>' +
          '</h3>' +
          '<div><span class="k">dialect</span><span class="v">' + (r.dialect || '—') + '</span></div>' +
          '<div><span class="k">role</span><span class="v">' + r.role + '</span></div>' +
          '<div><span class="k">state</span><span class="v state-' + state + '">' + state + '</span></div>' +
          '<div><span class="k">lag</span><span class="v ' + lagClass(r.lag) + '">' + (r.lag != null ? r.lag + ' ms' : 'n/a') + sparkline(lagHistory.get(key)) + '</span></div>' +
          (r.poolUsage ? '<div><span class="k">pool</span><span class="v">' + r.poolUsage.in + '/' + r.poolUsage.out + '</span></div>' : '') +
        '</div>'
      );
    }
  }
  container.innerHTML = html.length ? html.join('') : '<div class="empty">No replicas registered.</div>';
  document.getElementById('summary').textContent = totalReps + ' replicas · ' + masters + ' master(s)';
}

function renderRules(data, routing) {
  const container = document.getElementById('rule-cards');
  if (!data.length) { container.innerHTML = '<div class="empty">No CDC rules registered.</div>'; return; }
  container.innerHTML = data.map(r => {
    const s = r.lastStats || {};
    return '<div class="card">' +
      '<h3>' + (r.enabled ? '✓ ' : '✗ ') + r.name + '</h3>' +
      '<div><span class="k">source</span><span class="v">' + r.source + '</span></div>' +
      '<div><span class="k">target</span><span class="v">' + r.target + '</span></div>' +
      '<div><span class="k">mode</span><span class="v badge">' + r.mode + '</span></div>' +
      '<div><span class="k">collections</span><span class="v">' + r.collections.join(', ') + '</span></div>' +
      '<div><span class="k">conflict</span><span class="v">' + r.conflictResolution + '</span></div>' +
      '<div><span class="k">last sync</span><span class="v">' +
        (s.inserted ?? 0) + '↑ / ' + (s.updated ?? 0) + '⟳ / ' + (s.deleted ?? 0) + '↓ / ' +
        (s.failed ?? 0) + '✗' + (s.durationMs ? ' · ' + s.durationMs + 'ms' : '') +
      '</span></div>' +
    '</div>';
  }).join('');
}

function renderActivityAppend(ev) {
  const log = document.getElementById('activity-log');
  const ts = new Date(ev.ts).toISOString().slice(11, 19);
  const cls = 'ev-' + ev.type.replaceAll('.', '-');
  let txt = '';
  switch (ev.type) {
    case 'replica.added':    txt = 'replica added   ' + ev.project + '/' + ev.replica + ' (' + ev.role + ')'; break;
    case 'replica.removed':  txt = 'replica removed ' + ev.project + '/' + ev.replica; break;
    case 'replica.promoted': txt = 'PROMOTED        ' + ev.project + '/' + ev.replica; break;
    case 'replica.state':    txt = ev.project + '/' + ev.replica + ' → ' + ev.state + (ev.lag != null ? ' (lag=' + ev.lag + 'ms)' : ''); break;
    case 'rule.added':       txt = 'rule added      ' + ev.rule; break;
    case 'rule.removed':     txt = 'rule removed    ' + ev.rule; break;
    case 'rule.sync.start':  txt = 'sync started    ' + ev.rule; break;
    case 'rule.sync.done':   txt = 'sync done       ' + ev.rule + ' · ins=' + (ev.stats.inserted ?? 0) + ' upd=' + (ev.stats.updated ?? 0) + ' del=' + (ev.stats.deleted ?? 0) + ' fail=' + (ev.stats.failed ?? 0); break;
    case 'error':            txt = 'ERROR           ' + ev.message + (ev.context ? ' [' + ev.context + ']' : ''); break;
    default:                 txt = JSON.stringify(ev);
  }
  const div = document.createElement('div');
  div.className = 'ev ' + cls;
  div.innerHTML = '<span class="ts">' + ts + '</span>' + txt;
  log.appendChild(div);
  // Cap the log at 500 entries
  while (log.childElementCount > 500) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
}

// --- Poll loop (2s) ---
async function refresh() {
  try {
    const [reps, rules, routing] = await Promise.all([
      fetchJSON('/api/replicas'),
      fetchJSON('/api/rules'),
      fetchJSON('/api/routing'),
    ]);
    renderReplicas(reps);
    renderRules(rules, routing);
    document.getElementById('conn').textContent = 'connected';
    document.getElementById('conn').className = 'pill ok';
    document.getElementById('tick').textContent = new Date().toISOString().slice(11, 19);
  } catch (e) {
    document.getElementById('conn').textContent = 'disconnected';
    document.getElementById('conn').className = 'pill err';
  }
}
setInterval(refresh, 2000);
refresh();

// --- SSE stream for activity ---
function openStream() {
  const url = '/api/stream' + qs;
  const es = new EventSource(url);
  es.onmessage = (m) => { try { renderActivityAppend(JSON.parse(m.data)); } catch {} };
  es.onerror = () => { setTimeout(openStream, 3000); es.close(); };
}
openStream();
</script>
</body>
</html>`;
