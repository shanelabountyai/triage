// triage:serve (task 3.4, D-56): the triage.http.v1 contract for N9 over node:http. A door onto triageRun and the ledger
// readers, nothing more: no label, price or cap is decided here, and a live run still passes the D-19 gate inside triageRun.
// Adapted from opsagent src/opsagent/web.py (/health, /runs/{id}; D-53). The bearer check is new: no sibling has one.
import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { DecisionRow } from '../pipeline/run.js';
import { PROVIDERS, type Provider, type ProviderName } from '../providers/index.js';
import type { LiveConfig } from '../providers/live.js';
import type { Caps } from './caps.js';
import { runDecisions } from './drift.js';
import { readLedger } from './ledger.js';
import { runId, triageRun } from './run.js';
import { CUSTOM_ID, parseTickets } from './tickets.js';

export const CONTRACT = 'triage.http.v1';
export const BODY_LIMIT = 2 * 1024 * 1024;

export interface ServeOptions {
  /** TRIAGE_HTTP_TOKEN; empty refuses at startup. Compared in constant time, never logged. */
  token: string;
  ledgerPath: string;
  /** each accepted run gets `<dataDir>/<run_id>/tickets_<batch>.jsonl` and `<dataDir>/<run_id>/out/decisions.jsonl` */
  dataDir: string;
  root?: string;
  auditSeed?: number;
  /** live only, wired from the environment by scripts/serve.ts; without them a live POST fails as LIVE_ONLY_VIA_RUN */
  live?: (c: Omit<LiveConfig, 'client'>) => Provider;
  caps?: Caps;
  /** one line per request: method, path, status, ms. Nothing from a header or a body. */
  log?: (line: string) => void;
  now?: () => string;
}

interface RunState { status: 'running' | 'done' | 'failed'; error?: string }

const digest = (s: string) => createHash('sha256').update(s).digest();

/** Whole body up to BODY_LIMIT, else null. An oversized body is drained, not cut, so the 413 reaches the client. */
const readBody = (req: IncomingMessage) => new Promise<Buffer | null>((resolve, reject) => {
  const chunks: Buffer[] = [];
  let n = 0, over = Number(req.headers['content-length'] ?? 0) > BODY_LIMIT;
  // ponytail: a client streaming past the limit keeps the socket until it stops; destroy the request here if abuse matters
  req.on('data', (c: Buffer) => { n += c.length; if (n > BODY_LIMIT) { over = true; chunks.length = 0; } else if (!over) chunks.push(c); });
  req.on('end', () => resolve(over ? null : Buffer.concat(chunks)));
  req.on('error', reject);
});

export function createTriageServer(o: ServeOptions): Server {
  if (!o.token) throw new Error('HTTP_NO_TOKEN: TRIAGE_HTTP_TOKEN is empty; the handler refuses to start without a bearer token (D-56)');
  const tokenDigest = digest(o.token);
  const now = o.now ?? (() => new Date().toISOString());
  const log = o.log ?? ((l: string) => console.log(l));
  const runs = new Map<string, RunState>();
  // ponytail: one run at a time, so two live POSTs cannot both read the same cap headroom; a per-provider queue if throughput matters
  let chain: Promise<unknown> = Promise.resolve();

  const authorized = (req: IncomingMessage) => {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
    return m !== null && timingSafeEqual(digest(m[1]!), tokenDigest);
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<[number, unknown, Record<string, string>?]> => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const method = req.method ?? 'GET';
    if (path === '/health' && method === 'GET') return [200, { status: 'ok', contract: CONTRACT }];
    if (!authorized(req)) return [401, { error: 'UNAUTHORIZED' }, { 'www-authenticate': 'Bearer' }];

    if (path === '/runs') {
      if (method === 'GET') return [200, readLedger(o.ledgerPath)];
      if (method !== 'POST') return [405, { error: 'METHOD_NOT_ALLOWED' }, { allow: 'GET, POST' }];
      const raw = await readBody(req);
      if (raw === null) return [413, { error: 'BODY_TOO_LARGE', limit_bytes: BODY_LIMIT }];
      let body: unknown;
      try { body = JSON.parse(raw.toString('utf8')); } catch { return [400, { error: 'BAD_JSON' }]; }
      const b = (typeof body === 'object' && body !== null && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
      const provider = b['provider'], batch = b['batch'], list = b['tickets'];
      if (!PROVIDERS.includes(provider as ProviderName) || typeof batch !== 'string' || !CUSTOM_ID.test(batch) || !Array.isArray(list)) {
        return [400, { error: 'BAD_REQUEST', detail: `body must be {provider: ${PROVIDERS.join('|')}, batch: a name matching ${CUSTOM_ID.source} (the replay stem: fixtures/scripted_tier*_<batch>.jsonl or recordings/<batch>/), tickets: [...]}` }];
      }
      if (!list.length) return [400, { error: 'BAD_REQUEST', detail: 'tickets is empty' }];
      // one JSON line per array element, so the intake reader's line numbers are the array's 1-based positions
      const text = list.map((t) => JSON.stringify(t)).join('\n') + '\n';
      const { errors } = parseTickets(text);
      if (errors.length) return [400, { error: 'INTAKE', errors }];

      const started = now(), id = runId(started, provider as ProviderName);
      if (runs.has(id)) return [409, { error: 'RUN_EXISTS', run_id: id }];
      const dir = join(o.dataDir, id), inPath = join(dir, `tickets_${batch}.jsonl`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(inPath, text, { flag: 'wx' });
      runs.set(id, { status: 'running' });
      let first = true;
      const clock = () => (first ? ((first = false), started) : now()); // the ledger's started_at is the accepted time, so run_id matches
      chain = chain.then(() => triageRun({ inPath, provider: provider as ProviderName, outDir: join(dir, 'out'), ledgerPath: o.ledgerPath,
        auditSeed: o.auditSeed ?? 20261019, now: clock, ...(o.root ? { root: o.root } : {}), ...(o.live && o.caps ? { live: o.live, caps: o.caps } : {}) }))
        .then(() => runs.set(id, { status: 'done' }), (e: unknown) => runs.set(id, { status: 'failed', error: (e as Error).message }));
      return [202, { run_id: id, status: 'running' }];
    }

    const m = /^\/runs\/([^/]+)$/.exec(path);
    if (m) {
      if (method !== 'GET') return [405, { error: 'METHOD_NOT_ALLOWED' }, { allow: 'GET' }];
      const id = decodeURIComponent(m[1]!);
      const mem = runs.get(id), row = readLedger(o.ledgerPath).find((r) => r.run_id === id) ?? null;
      if (!mem && !row) return [404, { error: 'RUN_UNKNOWN', run_id: id }];
      const status = mem?.status ?? (row?.error ? 'failed' : 'done');
      let decisions: DecisionRow[] | null = null;
      if (status === 'done' && row) { try { decisions = runDecisions(o.ledgerPath, id); } catch { decisions = null; } }
      return [200, { run_id: id, status, error: mem?.error ?? row?.error ?? null, ledger_row: row, decisions }];
    }
    return [404, { error: 'NOT_FOUND' }];
  };

  return createServer((req, res) => {
    const t0 = Date.now();
    handle(req, res).then(([code, body, headers]) => {
      res.writeHead(code, { 'content-type': 'application/json', 'x-triage-contract': CONTRACT, ...headers });
      res.end(JSON.stringify(body) + '\n');
    }, (e: unknown) => {
      res.writeHead(500, { 'content-type': 'application/json', 'x-triage-contract': CONTRACT });
      res.end(JSON.stringify({ error: 'INTERNAL', detail: (e as Error).message }) + '\n');
    }).finally(() => log(`${req.method} ${new URL(req.url ?? '/', 'http://localhost').pathname} ${res.statusCode} ${Date.now() - t0}ms`));
  });
}
