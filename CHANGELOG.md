# Changelog

All notable changes to `@mostajs/replica-monitor` will be documented in this file.

## [0.1.0] — 2026-04-15

### Initial release

- **Live web dashboard** for @mostajs/replicator : master/slave health,
  replication lag, CDC rules, activity stream.
- **Zero external deps** — pure `node:http` + SSE + vanilla JS (one HTML
  page served inline). No React / Express / WebSocket libs to install.
- **Duck-typed manager** — works with any object exposing
  `listProjects / getReplicaStatus / listRules / getReadRouting / getSyncStats`.
  Easy to mock in tests.
- **Three tabs** in the UI :
  1. Replicas (cards with role, dialect, state, live lag + 30-point SVG sparkline)
  2. CDC rules (last sync stats per rule)
  3. Activity log (streaming event feed, auto-reconnect on drop)
- **Polling + SSE hybrid** — every `pollMs` (default 2s) the monitor diffs
  state against the previous snapshot and emits synthetic events on
  `replica.added / replica.removed / replica.promoted / replica.state`.
  Events ship via SSE stream to all connected clients.
- **Token auth** (`authToken`) enforced on every endpoint including SSE.
  Accepts `Authorization: Bearer <token>` header or `?token=<token>` query
  string (browser-friendly for SSE).
- **HTTP API** : `/api/health`, `/api/replicas`, `/api/rules`, `/api/routing`,
  `/api/events`, `/api/stream`.
- **Standalone CLI** `mostajs-monitor --tree X --runtime Y --port Z`
  for ops consoles with no app process.
- **Integrated into @mostajs/orm-cli@0.5.2** via menu `r → m` — auto-install,
  background spawn, pid tracking, `xdg-open` browser launcher.

### Tests

E2E suite (`test-scripts/test-monitor-e2e.sh`) — **11/11 passing** :
health, replicas, rules, routing, events buffer, HTML root, SSE stream,
404 handling, token auth (absent / Bearer / query string).

### Limitations (v0.1.0)

- No persistent metrics — the activity ring buffer lives in memory only
  and is lost on restart.
- No write operations from the UI (read-only dashboard ; mutations happen
  via `mostajs` menu `r` or programmatic calls to `ReplicationManager`).
- Single-project views only ; multi-project selector coming in 0.2.
