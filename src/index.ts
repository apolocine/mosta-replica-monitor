// @mostajs/replica-monitor — public entry point
// Author: Dr Hamid MADANI drmdh@msn.com
// License: AGPL-3.0-or-later

export { startMonitor } from './server.js';
export type {
  MonitorConfig,
  MonitorHandle,
  ActivityEvent,
  ReplicationManagerLike,
  ReplicaInfo,
  ReplicationRuleLike,
  SyncStatsLike,
} from './types.js';
