#!/usr/bin/env node
// @mostajs/replica-monitor — standalone CLI entry (mostajs-monitor)
// Author: Dr Hamid MADANI drmdh@msn.com
//
// Usage :
//   mostajs-monitor --tree .mostajs/replicator-tree.json
//                   [--port 14499] [--host 127.0.0.1] [--token SECRET]
//                   [--runtime /path/to/project]
//
// The CLI loads a replicator tree from disk, spawns a ReplicationManager,
// and serves the dashboard. Ideal for `ops` / `admin` consoles that just
// want visibility without wiring the monitor into their app process.

import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

const argv = process.argv.slice(2);
const val = (name: string, def?: string) => {
  const i = argv.indexOf('--' + name);
  if (i < 0) return def;
  return argv[i + 1] ?? def;
};
const has = (name: string) => argv.includes('--' + name);

if (has('help') || has('h')) {
  console.log(`
  mostajs-monitor — web dashboard for @mostajs/replicator

    --tree     <file>         replicator-tree.json produced by saveToFile()
    --runtime  <dir>          project root where @mostajs/replicator is installed
                              (default: cwd)
    --port     <number>       HTTP port (default 14499)
    --host     <address>      HTTP host (default 127.0.0.1)
    --token    <secret>       require Bearer auth
    --poll     <ms>           poll interval (default 2000)
`);
  process.exit(0);
}

const runtime = resolve(val('runtime', process.cwd())!);
const tree    = val('tree');
const port    = Number(val('port', '14499'));
const host    = val('host', '127.0.0.1')!;
const token   = val('token');
const pollMs  = Number(val('poll', '2000'));

// Dynamic import from the target project's node_modules so the CLI can be
// dropped into any project without deps conflicts.
const rep = runtime + '/node_modules/@mostajs/replicator/dist/index.js';
const proj = runtime + '/node_modules/@mostajs/mproject/dist/index.js';

if (!existsSync(rep) || !existsSync(proj)) {
  console.error(`[monitor] @mostajs/replicator not found in ${runtime}/node_modules.`);
  console.error(`          Install it :  npm i @mostajs/replicator @mostajs/mproject --legacy-peer-deps`);
  process.exit(1);
}

const { ReplicationManager } = await import(rep);
const { ProjectManager }     = await import(proj);
const pm = new ProjectManager();
const rm = new ReplicationManager(pm);

if (tree && existsSync(tree)) {
  try {
    await rm.loadFromFile(tree);
    console.log(`[monitor] tree loaded from ${tree}`);
  } catch (e) {
    console.error(`[monitor] failed to load tree : ${(e as Error).message}`);
  }
}

const { startMonitor } = await import('./server.js');
const handle = await startMonitor({
  manager: rm,
  port, host, authToken: token, pollMs,
  onEvent: (ev) => {
    if (ev.type === 'error') console.error(`[monitor] ${ev.type}: ${ev.message}`);
  },
});

console.log(`\n  ▶ replica-monitor running at  ${handle.url}` + (token ? `?token=…` : ''));
console.log(`    press Ctrl+C to stop.\n`);

const shutdown = async () => {
  console.log('\n[monitor] shutting down…');
  try { await handle.stop(); } catch {}
  try { await rm.disconnectAll(); } catch {}
  process.exit(0);
};
process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
