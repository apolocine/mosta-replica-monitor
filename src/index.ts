// @mostajs/replica-monitor — public entry point
// Author: Dr Hamid MADANI drmdh@msn.com
// License: AGPL-3.0-or-later

export { startMonitor } from './server.js';
export { readTreeManager } from './tree-reader.js';
export { scaffoldMonitorService } from './scaffold.js';
export type {
  MonitorConfig,
  MonitorHandle,
  ActivityEvent,
  ReplicationManagerLike,
  ReplicaInfo,
  ReplicationRuleLike,
  SyncStatsLike,
} from './types.js';
export type { TreeReaderOptions, TreeReaderHandle } from './tree-reader.js';
export type { MonitorScaffoldOptions, MonitorScaffoldResult } from './scaffold.js';
