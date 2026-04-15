#!/usr/bin/env node
// @mostajs/replica-monitor — standalone CLI entry (mostajs-monitor)
// Author: Dr Hamid MADANI drmdh@msn.com
//
// Usage :
//   mostajs-monitor --tree .mostajs/replicator-tree.json
//                   [--port 14499] [--host 127.0.0.1] [--token SECRET]
//
// Since v0.2.0 the CLI reads the tree JSON directly (read-only). It does
// NOT instantiate a live ReplicationManager → no DB connections, no driver
// dependencies. If you want live lag / connection state you must instead
// wire the monitor inside your replicator service process (see
// scaffoldMonitorService).

import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { readTreeManager } from './tree-reader.js';
import { startMonitor } from './server.js';

const argv = process.argv.slice(2);
const val = (name: string, def?: string) => {
  const i = argv.indexOf('--' + name);
  if (i < 0) return def;
  return argv[i + 1] ?? def;
};
const has = (name: string) => argv.includes('--' + name);

if (has('help') || has('h')) {
  console.log(`
  mostajs-monitor — web dashboard for @mostajs/replicator (tree-only, read-only)

    --tree     <file>         replicator-tree.json (required)
    --port     <number>       HTTP port           (default 14499)
    --host     <address>      HTTP host           (default 127.0.0.1)
    --token    <secret>       Bearer auth token   (no auth if omitted)
    --poll     <ms>           poll interval       (default 2000)
    --no-watch                disable fs.watch on the tree (polling-only)
`);
  process.exit(0);
}

const tree   = val('tree', resolve('.mostajs/replicator-tree.json'));
const port   = Number(val('port', '14499'));
const host   = val('host', '127.0.0.1')!;
const token  = val('token');
const pollMs = Number(val('poll', '2000'));
const noWatch = has('no-watch');

if (!tree) {
  console.error(`[monitor] --tree <path> required`);
  process.exit(1);
}
if (!existsSync(tree)) {
  console.error(`[monitor] tree file not found at ${tree}`);
  console.error(`          run 'mostajs' → menu r → 1 to add a replica first,`);
  console.error(`          or pass --tree <path> to a valid replicator-tree.json`);
  process.exit(1);
}

// Tree-backed manager — reads the JSON directly, no DB, no creds.
const manager = readTreeManager({ tree, watch: !noWatch });

const handle = await startMonitor({
  manager,
  port, host, authToken: token, pollMs,
  onEvent: (ev) => {
    if (ev.type === 'error') console.error(`[monitor] ${ev.type}: ${ev.message}`);
  },
});

const tokenQs = token ? `?token=${encodeURIComponent(token)}` : '';
console.log(`\n  ▶ replica-monitor running at  ${handle.url}${tokenQs}`);
console.log(`    watching tree : ${tree}`);
console.log(`    press Ctrl+C to stop.\n`);

const shutdown = async (sig: string) => {
  console.log(`\n[monitor] shutting down (${sig})`);
  try { await handle.stop(); } catch {}
  try { manager.stop(); } catch {}
  process.exit(0);
};
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
