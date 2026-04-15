// @mostajs/replica-monitor — public types
// Author: Dr Hamid MADANI drmdh@msn.com

export interface MonitorConfig {
  /**
   * The ReplicationManager instance to watch. We duck-type to avoid a hard
   * dependency — any object with `getReplicaStatus(project)`, `listProjects()`,
   * `listRules()`, and `getSyncStats(rule)` works.
   */
  manager: ReplicationManagerLike;

  /** HTTP port (default 14499) */
  port?: number;

  /** HTTP host (default '127.0.0.1') */
  host?: string;

  /**
   * Optional token — when set, every request must carry
   * `Authorization: Bearer <token>` (or ?token=... query string).
   * Leave unset for local-only dev use.
   */
  authToken?: string;

  /** Polling interval in ms (default 2000) */
  pollMs?: number;

  /** Maximum number of activity events to keep in the in-memory ring buffer (default 200) */
  activityBufferSize?: number;

  /** Called on each event emitted (useful to log server-side) */
  onEvent?: (ev: ActivityEvent) => void;
}

/** Minimal shape of @mostajs/replicator we depend on. */
export interface ReplicationManagerLike {
  listProjects?: () => string[];
  getReplicaStatus: (project: string) => ReplicaInfo[];
  getReadRouting?: (project: string) => string;
  listRules: () => ReplicationRuleLike[];
  getSyncStats?: (ruleName: string) => SyncStatsLike | undefined;
}

export interface ReplicaInfo {
  name: string;
  role: 'master' | 'slave';
  dialect?: string;
  lag?: number | null;
  state?: 'up' | 'down' | 'connecting' | 'unknown';
  poolUsage?: { in: number; out: number };
  lastPing?: number;   // epoch ms
}

export interface ReplicationRuleLike {
  name: string;
  source: string;
  target: string;
  mode: string;
  collections: string[];
  conflictResolution: string;
  enabled: boolean;
}

export interface SyncStatsLike {
  inserted?: number;
  updated?: number;
  deleted?: number;
  failed?: number;
  durationMs?: number;
  lastRun?: number;
}

export type ActivityEvent =
  | { type: 'replica.added';    project: string; replica: string; role: string; ts: number }
  | { type: 'replica.removed';  project: string; replica: string; ts: number }
  | { type: 'replica.promoted'; project: string; replica: string; ts: number }
  | { type: 'replica.state';    project: string; replica: string; state: string; lag?: number; ts: number }
  | { type: 'rule.added';       rule: string; ts: number }
  | { type: 'rule.removed';     rule: string; ts: number }
  | { type: 'rule.sync.start';  rule: string; ts: number }
  | { type: 'rule.sync.done';   rule: string; stats: SyncStatsLike; ts: number }
  | { type: 'error';            message: string; context?: string; ts: number };

export interface MonitorHandle {
  /** Full URL the dashboard is served on (e.g. http://127.0.0.1:14499) */
  url: string;
  /** Stop the server, clear the polling loop, release the port. */
  stop: () => Promise<void>;
}
