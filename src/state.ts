// @mostajs/replica-monitor — in-memory state + polling loop
// Author: Dr Hamid MADANI drmdh@msn.com

import type { ActivityEvent, MonitorConfig, ReplicaInfo, ReplicationRuleLike } from './types.js';

/**
 * Ring buffer for activity events — older events drop when we exceed the cap.
 */
class RingBuffer<T> {
  private data: T[] = [];
  constructor(private cap: number) {}
  push(item: T): void {
    this.data.push(item);
    if (this.data.length > this.cap) this.data.shift();
  }
  snapshot(): T[] { return [...this.data]; }
}

/** One subscriber (SSE connection). */
export interface EventSubscriber {
  send: (ev: ActivityEvent) => void;
  close: () => void;
}

export class MonitorState {
  readonly activity: RingBuffer<ActivityEvent>;
  private readonly subscribers = new Set<EventSubscriber>();
  private timer: NodeJS.Timeout | null = null;
  private lastReplicas = new Map<string, ReplicaInfo>();  // key: `${project}/${name}`
  private lastRules   = new Map<string, ReplicationRuleLike>();

  constructor(private readonly cfg: MonitorConfig) {
    this.activity = new RingBuffer<ActivityEvent>(cfg.activityBufferSize ?? 200);
  }

  /** Start the polling loop. No-op if already running. */
  start(): void {
    if (this.timer) return;
    const interval = this.cfg.pollMs ?? 2000;
    const tick = () => { try { this.poll(); } catch (e) { this.emit({ type: 'error', message: (e as Error).message, context: 'poll', ts: Date.now() }); } };
    tick();
    this.timer = setInterval(tick, interval);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    for (const sub of this.subscribers) sub.close();
    this.subscribers.clear();
  }

  /** Register an SSE subscriber. Returns an unsubscribe function. */
  subscribe(sub: EventSubscriber): () => void {
    this.subscribers.add(sub);
    // Replay last 20 events so the new subscriber gets immediate context
    for (const ev of this.activity.snapshot().slice(-20)) sub.send(ev);
    return () => { this.subscribers.delete(sub); sub.close(); };
  }

  emit(ev: ActivityEvent): void {
    this.activity.push(ev);
    this.cfg.onEvent?.(ev);
    for (const sub of this.subscribers) {
      try { sub.send(ev); } catch { /* ignore broken subscribers */ }
    }
  }

  /** Snapshot for HTTP /api/replicas and /api/rules. */
  snapshotReplicas(): Record<string, ReplicaInfo[]> {
    const out: Record<string, ReplicaInfo[]> = {};
    const projects = this.listProjects();
    for (const p of projects) {
      try { out[p] = this.cfg.manager.getReplicaStatus(p); }
      catch { out[p] = []; }
    }
    return out;
  }

  snapshotRules(): Array<ReplicationRuleLike & { lastStats?: unknown }> {
    const rules = this.cfg.manager.listRules();
    return rules.map(r => ({
      ...r,
      lastStats: this.cfg.manager.getSyncStats?.(r.name),
    }));
  }

  snapshotRouting(): Record<string, string> {
    const out: Record<string, string> = {};
    if (typeof this.cfg.manager.getReadRouting !== 'function') return out;
    for (const p of this.listProjects()) {
      try { out[p] = this.cfg.manager.getReadRouting!(p); } catch { /* ignore */ }
    }
    return out;
  }

  private listProjects(): string[] {
    if (typeof this.cfg.manager.listProjects === 'function') {
      try { return this.cfg.manager.listProjects() ?? []; } catch { return []; }
    }
    return [];
  }

  /** Diff current state against last poll and emit events. */
  private poll(): void {
    // Replicas diff
    const nowReplicas = new Map<string, ReplicaInfo>();
    for (const project of this.listProjects()) {
      let reps: ReplicaInfo[] = [];
      try { reps = this.cfg.manager.getReplicaStatus(project); } catch { /* ignore */ }
      for (const r of reps) {
        const key = `${project}/${r.name}`;
        nowReplicas.set(key, r);
        const prev = this.lastReplicas.get(key);
        if (!prev) {
          this.emit({ type: 'replica.added', project, replica: r.name, role: r.role, ts: Date.now() });
        } else if (prev.role !== r.role) {
          this.emit({ type: 'replica.promoted', project, replica: r.name, ts: Date.now() });
        } else if (prev.state !== r.state || prev.lag !== r.lag) {
          this.emit({ type: 'replica.state', project, replica: r.name, state: r.state ?? 'unknown', lag: r.lag ?? undefined, ts: Date.now() });
        }
      }
    }
    // Removed replicas
    for (const [key] of this.lastReplicas) {
      if (!nowReplicas.has(key)) {
        const [project, name] = key.split('/');
        this.emit({ type: 'replica.removed', project, replica: name, ts: Date.now() });
      }
    }
    this.lastReplicas = nowReplicas;

    // Rules diff
    const nowRules = new Map<string, ReplicationRuleLike>();
    try {
      for (const r of this.cfg.manager.listRules()) {
        nowRules.set(r.name, r);
        if (!this.lastRules.has(r.name)) {
          this.emit({ type: 'rule.added', rule: r.name, ts: Date.now() });
        }
      }
    } catch { /* ignore */ }
    for (const [name] of this.lastRules) {
      if (!nowRules.has(name)) this.emit({ type: 'rule.removed', rule: name, ts: Date.now() });
    }
    this.lastRules = nowRules;
  }
}
