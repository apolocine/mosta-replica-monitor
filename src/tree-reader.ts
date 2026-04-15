// @mostajs/replica-monitor — read-only tree.json reader
// Author: Dr Hamid MADANI drmdh@msn.com
//
// Instead of requiring a live ReplicationManager instance (which would need
// DB credentials), the monitor can watch the replicator-tree.json directly :
//   - zero DB connections
//   - works from anywhere the file is readable
//   - auto-reflects changes when the tree is re-saved (watchTree = true)
//
// Produces an object that implements the ReplicationManagerLike duck-type
// (see types.ts) so startMonitor() can consume it interchangeably.

import { readFileSync, watch, existsSync, type FSWatcher } from 'node:fs';
import type { ReplicaInfo, ReplicationManagerLike, ReplicationRuleLike } from './types.js';

export interface TreeReaderOptions {
  /** Path to the replicator-tree.json file */
  tree: string;
  /** Re-read the file when it changes (default true) */
  watch?: boolean;
}

export interface TreeReaderHandle extends ReplicationManagerLike {
  /** Stop watching the file */
  stop(): void;
  /** Force a re-read from disk */
  refresh(): void;
}

/**
 * Tree file shape (matches ReplicationManager.saveToFile output) :
 *   {
 *     replicas: { [project]: { [name]: { role, dialect, uri(masked), pool, lagTolerance?, schemaStrategy? } } },
 *     rules:    { [name]: { source, target, mode, collections, conflictResolution, enabled } },
 *     routing:  { [project]: 'round-robin' | 'least-lag' | 'random' }
 *   }
 */
interface TreeFile {
  replicas: Record<string, Record<string, Record<string, unknown>>>;
  rules:    Record<string, Record<string, unknown>>;
  routing:  Record<string, string>;
}

export function readTreeManager(opts: TreeReaderOptions): TreeReaderHandle {
  const treePath = opts.tree;
  const doWatch  = opts.watch !== false;
  let tree: TreeFile = { replicas: {}, rules: {}, routing: {} };
  let watcher: FSWatcher | null = null;

  const refresh = () => {
    if (!existsSync(treePath)) { tree = { replicas: {}, rules: {}, routing: {} }; return; }
    try {
      const raw = readFileSync(treePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<TreeFile>;
      tree = {
        replicas: parsed.replicas ?? {},
        rules:    parsed.rules    ?? {},
        routing:  parsed.routing  ?? {},
      };
    } catch {
      // Keep last-known-good on parse error
    }
  };

  refresh();

  if (doWatch && existsSync(treePath)) {
    try {
      watcher = watch(treePath, { persistent: false }, () => refresh());
    } catch { /* ignore (edge cases on some filesystems) */ }
  }

  return {
    listProjects:    () => Object.keys(tree.replicas),
    getReplicaStatus: (project: string): ReplicaInfo[] => {
      const entries = tree.replicas[project] ?? {};
      return Object.entries(entries).map(([name, cfg]) => ({
        name,
        role:    (cfg.role as 'master' | 'slave') ?? 'slave',
        dialect: cfg.dialect as string | undefined,
        // When reading from disk we don't know the live lag/state — treat as unknown.
        // A future 'augmenter' could merge this with HTTP ping results.
        lag: null,
        state: 'unknown',
      }));
    },
    getReadRouting: (project: string) => tree.routing[project] ?? 'round-robin',
    listRules:      (): ReplicationRuleLike[] => {
      return Object.entries(tree.rules).map(([name, r]) => ({
        name,
        source:             r.source as string,
        target:             r.target as string,
        mode:               r.mode as string,
        collections:        (r.collections as string[]) ?? [],
        conflictResolution: r.conflictResolution as string,
        enabled:            (r.enabled as boolean) ?? true,
      }));
    },
    getSyncStats: (_ruleName: string) => undefined,  // no live stats in tree-only mode

    // Handle controls
    stop: () => { if (watcher) { watcher.close(); watcher = null; } },
    refresh,
  };
}
