// @mostajs/replica-monitor — HTTP server (native node:http, no deps)
// Author: Dr Hamid MADANI drmdh@msn.com

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { URL } from 'node:url';
import { MonitorState } from './state.js';
import { INDEX_HTML } from './html.js';
import type { MonitorConfig, MonitorHandle } from './types.js';

export async function startMonitor(cfg: MonitorConfig): Promise<MonitorHandle> {
  const state = new MonitorState(cfg);
  state.start();

  const port = cfg.port ?? 14499;
  const host = cfg.host ?? '127.0.0.1';
  const server = createServer((req, res) => handle(req, res, state, cfg));

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.off('error', reject); resolve(); });
  });

  const url = `http://${host}:${port}`;
  // Announce startup in the activity log
  state.emit({ type: 'replica.state', project: '_monitor_', replica: 'server', state: 'up', ts: Date.now() });

  return {
    url,
    stop: async () => {
      state.stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

// ----------------------------------------------------------------
// Request routing
// ----------------------------------------------------------------

function handle(req: IncomingMessage, res: ServerResponse, state: MonitorState, cfg: MonitorConfig): void {
  if (!authorize(req, cfg)) return deny(res);
  const url = new URL(req.url || '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = url.pathname;

  if (pathname === '/')               return sendHtml(res, INDEX_HTML);
  if (pathname === '/api/health')     return sendJson(res, { ok: true, ts: Date.now() });
  if (pathname === '/api/replicas')   return sendJson(res, state.snapshotReplicas());
  if (pathname === '/api/rules')      return sendJson(res, state.snapshotRules());
  if (pathname === '/api/routing')    return sendJson(res, state.snapshotRouting());
  if (pathname === '/api/events')     return sendJson(res, state.activity.snapshot());
  if (pathname === '/api/stream')     return openSSE(req, res, state);

  res.statusCode = 404;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ error: 'not found' }));
}

// ----------------------------------------------------------------
// SSE stream endpoint
// ----------------------------------------------------------------

function openSSE(req: IncomingMessage, res: ServerResponse, state: MonitorState): void {
  res.statusCode = 200;
  res.setHeader('content-type', 'text/event-stream');
  res.setHeader('cache-control', 'no-cache');
  res.setHeader('connection', 'keep-alive');
  res.setHeader('x-accel-buffering', 'no');     // nginx hint — don't buffer
  res.flushHeaders?.();

  // Keep-alive ping every 20s — prevents proxies from dropping idle SSE.
  const ping = setInterval(() => { try { res.write(':ping\n\n'); } catch { /* ignore */ } }, 20_000);
  if (typeof ping.unref === 'function') ping.unref();

  const unsub = state.subscribe({
    send: (ev) => {
      try { res.write(`data: ${JSON.stringify(ev)}\n\n`); }
      catch { unsub(); }
    },
    close: () => { try { res.end(); } catch { /* ignore */ } },
  });

  req.on('close', () => { clearInterval(ping); unsub(); });
}

// ----------------------------------------------------------------
// Auth
// ----------------------------------------------------------------

function authorize(req: IncomingMessage, cfg: MonitorConfig): boolean {
  if (!cfg.authToken) return true;
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ') && auth.slice(7) === cfg.authToken) return true;
  try {
    const q = new URL(req.url || '/', 'http://x').searchParams.get('token');
    if (q === cfg.authToken) return true;
  } catch { /* ignore */ }
  return false;
}

function deny(res: ServerResponse): void {
  res.statusCode = 401;
  res.setHeader('www-authenticate', 'Bearer');
  res.end('unauthorized');
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function sendJson(res: ServerResponse, payload: unknown): void {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function sendHtml(res: ServerResponse, html: string): void {
  res.statusCode = 200;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(html);
}
