# @mostajs/replica-monitor

> **Live web dashboard for [@mostajs/replicator](https://www.npmjs.com/package/@mostajs/replicator)** — master/slave health, replication lag, CDC rules, activity stream.
>
> Zero external deps : pure `node:http` + Server-Sent Events + vanilla JS. Drops into any project with a `ReplicationManager` instance.

[![npm version](https://img.shields.io/npm/v/@mostajs/replica-monitor.svg)](https://www.npmjs.com/package/@mostajs/replica-monitor)
[![License: AGPL-3.0-or-later](https://img.shields.io/badge/License-AGPL%203.0-blue.svg)](LICENSE)

## What it shows

| Tab | Content |
|---|---|
| **Replicas** | One card per replica : role (master / slave), dialect, state (up / down / connecting), **live replication lag** + 30-point sparkline, pool usage |
| **CDC rules** | One card per rule : source → target, mode (`snapshot` / `cdc` / `bidirectional`), last sync stats (inserted / updated / deleted / failed / ms) |
| **Activity** | Streaming log of every event : `replica.added`, `replica.promoted`, `rule.sync.done`, errors… Auto-reconnects on drop |

All three tabs refresh every 2 s via polling + receive push events via SSE.

## Install

```bash
npm install @mostajs/replica-monitor @mostajs/replicator
```

## Quick start — tree-only (since v0.2.0)

Zero setup. The monitor reads your committed `replicator-tree.json` directly — no DB connections, no `@mostajs/replicator` runtime needed at the monitor process :

```ts
import { startMonitor, readTreeManager } from '@mostajs/replica-monitor'

const manager = readTreeManager({ tree: '.mostajs/replicator-tree.json' })
const handle  = await startMonitor({ manager, port: 14499 })
console.log('dashboard at', handle.url)
```

The tree file is auto-reloaded via `fs.watch` when it changes — no polling race. Credentials inside the tree are already masked by `ReplicationManager.saveToFile()`, so this is safe to commit and expose.

## Scaffolding (since v0.2.0)

Rather than write your own monitor bootstrap, use the scaffolder to drop a ready-to-run `services/monitor.mjs` into your project :

```bash
npx mostajs-monitor-scaffold --dir .
```

Then add to `package.json` :

```json
"scripts": {
  "monitor": "node services/monitor.mjs"
}
```

Run : `npm run monitor` → opens on `http://localhost:14499`.

`@mostajs/orm-cli@0.5.3+` wires the scaffolding + `package.json` patch + `concurrently` install via menu `r → s`.

## Usage — programmatic

```ts
import { startMonitor } from '@mostajs/replica-monitor'
import { ReplicationManager } from '@mostajs/replicator'
import { ProjectManager }    from '@mostajs/mproject'

const pm = new ProjectManager()
const rm = new ReplicationManager(pm)
// … addProject / addReplica / addReplicationRule …

const handle = await startMonitor({
  manager:    rm,
  port:       14499,       // default
  host:       '127.0.0.1', // default (local-only)
  authToken:  'my-secret', // optional — Bearer auth on every request
  pollMs:     2000,        // default — state diff every 2s
})
console.log('Dashboard at', handle.url)

// Later :
await handle.stop()
```

## Usage — standalone CLI

```bash
npx mostajs-monitor \
  --tree .mostajs/replicator-tree.json \
  --runtime .                 \
  --port 14499                \
  --token SECRET123           # optional
```

The CLI loads a replicator tree from disk, spawns a fresh `ReplicationManager`, and serves the dashboard. Ideal for a standalone ops console.

Then visit **`http://localhost:14499`** (add `?token=SECRET123` if you used `--token`).

## Usage — via `@mostajs/orm-cli`

```bash
npx @mostajs/orm-cli@latest  →  menu r → m
```

The CLI will :
1. Install `@mostajs/replica-monitor` if missing
2. Spawn it in background (pid stored in `.mostajs/monitor.pid`)
3. Log to `.mostajs/monitor.log`
4. Open the dashboard in your default browser (`xdg-open` / `open`)

Stop it with : `kill $(cat .mostajs/monitor.pid)`.

## API surface

```ts
interface MonitorConfig {
  manager:             ReplicationManagerLike
  port?:               number                       // default 14499
  host?:               string                       // default '127.0.0.1'
  authToken?:          string                       // Bearer auth
  pollMs?:             number                       // default 2000
  activityBufferSize?: number                       // default 200
  onEvent?:            (ev: ActivityEvent) => void  // server-side tap
}

interface MonitorHandle {
  url:   string
  stop:  () => Promise<void>
}
```

### HTTP endpoints

| Path | Method | Returns |
|---|---|---|
| `/` | GET | HTML dashboard |
| `/api/health` | GET | `{ ok: true, ts }` |
| `/api/replicas` | GET | `{ [project]: ReplicaInfo[] }` |
| `/api/rules` | GET | `Array<Rule & { lastStats? }>` |
| `/api/routing` | GET | `{ [project]: 'round-robin' \| 'least-lag' \| 'random' }` |
| `/api/events` | GET | last N events (default 200) |
| `/api/stream` | GET (SSE) | push stream of `ActivityEvent` |

### Event types

```ts
type ActivityEvent =
  | { type: 'replica.added';    project, replica, role, ts }
  | { type: 'replica.removed';  project, replica, ts }
  | { type: 'replica.promoted'; project, replica, ts }
  | { type: 'replica.state';    project, replica, state, lag?, ts }
  | { type: 'rule.added';       rule, ts }
  | { type: 'rule.removed';     rule, ts }
  | { type: 'rule.sync.start';  rule, ts }
  | { type: 'rule.sync.done';   rule, stats, ts }
  | { type: 'error';            message, context?, ts }
```

## Security

- **Default bind is `127.0.0.1`** — not reachable from the network.
- `authToken` enables Bearer auth on every endpoint, including SSE. Pass the token via `Authorization: Bearer <token>` header or `?token=<token>` query string (useful for the browser to open the SSE stream).
- No cookies, no CSRF surface — stateless token auth.
- Credentials in the replicator tree file are **already masked** by `@mostajs/replicator.saveToFile()`, so exposing the monitor doesn't leak DB passwords.

## How it watches the manager

The monitor uses **duck-typing** — any object matching this shape works, even a mock :

```ts
interface ReplicationManagerLike {
  listProjects?:    () => string[]
  getReplicaStatus: (project: string) => ReplicaInfo[]
  getReadRouting?:  (project: string) => string
  listRules:        () => ReplicationRuleLike[]
  getSyncStats?:    (ruleName: string) => SyncStatsLike | undefined
}
```

State is polled every `pollMs`. Every tick, the monitor diffs the new snapshot vs the previous one and emits synthetic events (`replica.added`, `replica.removed`, `replica.promoted`, `replica.state` when lag/state changes, `rule.added`, `rule.removed`).

Want real-time events (CDC sync start/end) ? Call `state.emit(event)` directly from your `sync()` wrapper — but that requires access to the internal `MonitorState`. A future v0.2 will expose a `handle.emit(event)` escape hatch for app-triggered events.

## Roadmap

- **v0.1.0** ✅ HTTP/SSE dashboard, polling diff, token auth, orm-cli integration, standalone CLI
- **v0.2.0** — handle.emit() for app-triggered events (sync start/end)
- **v0.3.0** — SQLite-backed metrics history (7 days rolling), Prometheus exporter `/metrics`
- **v0.4.0** — Write-heavy protection : pause CDC rules from the UI, throttle slaves

## Ecosystem

- [@mostajs/replicator](https://www.npmjs.com/package/@mostajs/replicator) — the replication manager this monitors
- [@mostajs/orm](https://www.npmjs.com/package/@mostajs/orm) — the ORM behind the dialects
- [@mostajs/orm-cli](https://www.npmjs.com/package/@mostajs/orm-cli) — interactive CLI that embeds the monitor via `menu r → m`

## License

**AGPL-3.0-or-later** + commercial license available.

For closed-source commercial use : drmdh@msn.com

## Author

Dr Hamid MADANI <drmdh@msn.com>
