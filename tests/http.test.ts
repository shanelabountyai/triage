// Task 3.4 (D-56): the triage.http.v1 contract over an ephemeral port, scripted provider only (no token is spent; D-2).
// The decisions a POST produces are held to fixtures/decisions_batch1.csv on every column, as tests/run.test.ts holds triageRun.
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { capsFromEnv } from '../src/io/caps.js';
import { BODY_LIMIT, CONTRACT, createTriageServer } from '../src/io/http.js';
import { liveFromEnv } from '../src/providers/live.js';
import type { DecisionRow } from '../src/pipeline/run.js';

const TOKEN = 'test-token-7c1b9e';
const tickets = readFileSync('fixtures/tickets_batch1.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l) as object);
const logs: string[] = [];
let server: Server, base: string, dir: string;
let frozen: string | undefined; // a test pins the clock to force a run_id collision

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'triage-http-'));
  server = createTriageServer({ token: TOKEN, ledgerPath: join(dir, 'runs.jsonl'), dataDir: join(dir, 'http'), log: (l) => logs.push(l),
    now: () => frozen ?? new Date().toISOString(), live: (c) => liveFromEnv({}, c), caps: capsFromEnv({}) }); // an empty env: the live gate as serve.ts wires it, with nothing set
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` }) =>
  fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
const json = async (r: Response) => ({ status: r.status, body: (await r.json()) as Record<string, unknown> });

async function finished(runId: string) {
  for (let i = 0; i < 200; i++) {
    const { body } = await json(await call('GET', `/runs/${runId}`));
    if (body['status'] !== 'running') return body;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('run did not finish');
}

describe('triage:serve, triage.http.v1 (scripted)', () => {
  it('refuses to start without a token', () => {
    expect(() => createTriageServer({ token: '', ledgerPath: 'x', dataDir: 'y' })).toThrow(/HTTP_NO_TOKEN/);
  });
  it('GET /health needs no token and names the contract', async () => {
    const r = await call('GET', '/health', undefined, {});
    expect(r.status).toBe(200);
    expect(r.headers.get('x-triage-contract')).toBe(CONTRACT);
    expect(await r.json()).toEqual({ status: 'ok', contract: CONTRACT });
  });
  it('401 without a token, with a wrong one, and with the right one in the wrong scheme', async () => {
    for (const h of [{}, { authorization: 'Bearer nope' }, { authorization: `Basic ${TOKEN}` }]) {
      const r = await call('GET', '/runs', undefined, h);
      expect(r.status).toBe(401);
      expect(r.headers.get('www-authenticate')).toBe('Bearer');
      expect(await r.json()).toEqual({ error: 'UNAUTHORIZED' });
    }
    expect((await json(await call('POST', '/runs', { provider: 'scripted', batch: 'batch1', tickets }, {}))).status).toBe(401);
  });
  it('413 over the 2 MB body limit, declared or streamed', async () => {
    const big = JSON.stringify({ provider: 'scripted', batch: 'batch1', tickets: [], pad: 'x'.repeat(BODY_LIMIT) });
    expect(await json(await call('POST', '/runs', big))).toEqual({ status: 413, body: { error: 'BODY_TOO_LARGE', limit_bytes: BODY_LIMIT } });
    // no content-length: a chunked stream is counted as it arrives
    const chunked = await fetch(base + '/runs', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, duplex: 'half',
      body: new ReadableStream({ start(c) { for (let i = 0; i < 3; i++) c.enqueue(new TextEncoder().encode('x'.repeat(1024 * 1024))); c.close(); } }) } as RequestInit);
    expect(chunked.status).toBe(413);
  });
  it('400 on bad JSON, a bad envelope and intake errors with per-line codes', async () => {
    expect((await json(await call('POST', '/runs', '{not json'))).body).toEqual({ error: 'BAD_JSON' });
    for (const bad of [[], { provider: 'live2', batch: 'b', tickets: [] }, { provider: 'scripted', tickets: [] }, { provider: 'scripted', batch: 'bad name', tickets: [] }, { provider: 'scripted', batch: 'b', tickets: {} }]) {
      const r = await json(await call('POST', '/runs', bad));
      expect(r.status).toBe(400);
      expect(r.body['error']).toBe('BAD_REQUEST');
    }
    expect((await json(await call('POST', '/runs', { provider: 'scripted', batch: 'b', tickets: [] }))).body).toEqual({ error: 'BAD_REQUEST', detail: 'tickets is empty' });
    const r = await json(await call('POST', '/runs', { provider: 'scripted', batch: 'b', tickets: [
      tickets[0], 'text', { ticket_id: 'B1-0001', subject: 'dup', body: 'dup' }, { ticket_id: 'has space', subject: 's', body: 'b' }, { ticket_id: 'ok', subject: 's' }] }));
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ error: 'INTAKE', errors: [
      { line: 2, code: 'INTAKE_JSON', detail: 'not an object' },
      { line: 3, code: 'INTAKE_DUPLICATE_ID', detail: 'B1-0001' },
      { line: 4, code: 'INTAKE_ID', detail: 'ticket_id "has space" fails ^[a-zA-Z0-9_-]{1,64}$' },
      { line: 5, code: 'INTAKE_FIELD', detail: 'missing or non-string: body' } ] });
    expect(existsSync(join(dir, 'runs.jsonl'))).toBe(false); // nothing ran
  });
  it('404 on an unknown run and an unknown path, 405 on a wrong method', async () => {
    expect(await json(await call('GET', '/runs/nope'))).toEqual({ status: 404, body: { error: 'RUN_UNKNOWN', run_id: 'nope' } });
    expect((await call('GET', '/nope')).status).toBe(404);
    expect((await call('DELETE', '/runs')).status).toBe(405);
  });
  it('POST /runs → 202 {run_id}; GET /runs/<id> → decisions equal to fixtures/decisions_batch1.csv; GET /runs → the ledger', async () => {
    const accepted = await json(await call('POST', '/runs', { provider: 'scripted', batch: 'batch1', tickets }));
    expect(accepted.status).toBe(202);
    const runId = accepted.body['run_id'] as string;
    expect(runId).toMatch(/^\d{8}T\d{6}\.\d{3}Z-scripted$/);
    expect(accepted.body['status']).toBe('running');

    const done = await finished(runId);
    expect(done['status']).toBe('done');
    expect(done['error']).toBeNull();
    const row = done['ledger_row'] as Record<string, unknown>;
    expect(row).toMatchObject({ run_id: runId, provider: 'scripted', tickets: 700, intake_errors: 0, cap_status: 'n/a', input: join(dir, 'http', runId, 'tickets_batch1.jsonl') });
    const rows = done['decisions'] as DecisionRow[];
    // the same column mapping as tests/run.test.ts: the answer key stands in for the person on `overridden` (O-6)
    const key = new Map(readFileSync('fixtures/answer_key_batch1.csv', 'utf8').trim().split('\n').slice(1)
      .map((l) => l.split(',')).map((f) => [f[0]!, `${f[1]},${f[3]}`]));
    const ours = rows.map((r) => {
      const reasons = r.reasons.join('|');
      const overridden = r.human_touched && key.get(r.ticket_id) !== `${r.category},${r.priority}`;
      return [r.ticket_id, r.path, r.final_tier, r.category, r.priority, r.route, r.needs_human, r.language, r.min_bps,
        r.flags.join('|'), reasons.includes(',') ? `"${reasons}"` : reasons, r.cost_pico_batch, r.cost_pico_standard, r.human_touched, overridden].join(',');
    });
    expect(ours).toHaveLength(700);
    expect(ours).toEqual(readFileSync('fixtures/decisions_batch1.csv', 'utf8').trim().split('\n').slice(1));

    const ledger = await json(await call('GET', '/runs'));
    expect(ledger.status).toBe(200);
    expect((ledger.body as unknown as Record<string, unknown>[]).map((r) => r['run_id'])).toEqual([runId]);
    // the second POST in the same millisecond would be the same run_id: 409, never a silent overwrite
    frozen = row['started_at'] as string;
    expect(await json(await call('POST', '/runs', { provider: 'scripted', batch: 'batch1', tickets }))).toEqual({ status: 409, body: { error: 'RUN_EXISTS', run_id: runId } });
    frozen = undefined;
  });
  it('a live POST without TRIAGE_LIVE=1 is accepted, then fails as LIVE_REFUSED; nothing is sent and no ledger row is written', async () => {
    const before = readFileSync(join(dir, 'runs.jsonl'), 'utf8');
    const accepted = await json(await call('POST', '/runs', { provider: 'live', batch: 'nope', tickets: tickets.slice(0, 2) }));
    expect(accepted.status).toBe(202);
    const done = await finished(accepted.body['run_id'] as string);
    expect(done['status']).toBe('failed');
    expect(done['error']).toMatch(/LIVE_REFUSED: TRIAGE_LIVE=1 is not set/);
    expect(done['decisions']).toBeNull();
    expect(readFileSync(join(dir, 'runs.jsonl'), 'utf8')).toBe(before);
  });
  it('never logs the token: not on a 401, not on a 202, not anywhere', () => {
    expect(logs.length).toBeGreaterThan(10);
    expect(logs.join('\n')).not.toContain(TOKEN);
    expect(logs.join('\n')).not.toMatch(/authorization|bearer/i);
    expect(logs.every((l) => /^(GET|POST|DELETE) \/\S* \d{3} \d+ms$/.test(l))).toBe(true);
  });
});
