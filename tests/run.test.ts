import { mkdtempSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readCsv } from '../src/io/csv.js';
import { recordedHashes } from '../src/io/hash.js';
import { readLedger } from '../src/io/ledger.js';
import { readRunDir, runOnce } from '../src/io/run.js';
import { getProvider } from '../src/providers/index.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'triage-run-'));
const clock = () => {
  let i = 0;
  return () => `2026-10-19T12:00:0${i++}.000Z`;
};
const COLS = ['ticket_id', 'path', 'final_tier', 'category', 'priority', 'route', 'needs_human', 'language', 'min_bps', 'flags', 'reasons', 'cost_pico_batch', 'cost_pico_standard', 'human_touched'] as const;

describe('triage:run', () => {
  it('batch 1 on the scripted provider: 700 decisions equal the reference on every column the run owns, and one ledger row', async () => {
    const dir = tmp();
    const input = 'fixtures/tickets_batch1.jsonl';
    const ledger = join(dir, 'runs.jsonl');
    const out = join(dir, 'run1');
    const { row, decisions } = await runOnce({ input, provider: getProvider('scripted', { input }), out, ledger, now: clock() });
    const ours = decisions.map((d) => COLS.map((c) => (Array.isArray(d[c]) ? (d[c] as string[]).join('|') : String(d[c]))));
    expect(ours).toEqual(readCsv('fixtures/decisions_batch1.csv').map((r) => COLS.map((c) => r[c])));
    expect(readRunDir(out).decisions).toEqual(decisions);

    const rows = readLedger(ledger);
    expect(rows).toEqual([row]);
    const D26 = recordedHashes();
    expect([row.hashes.policy, row.hashes.drift, row.hashes.prices, row.hashes.schema, row.hashes.prompt])
      .toEqual([D26['routing/policy.v1.json'], D26['monitoring/drift.v1.json'], D26['pricing/prices.v1.json'], D26['schemas/triage.v1.json'], D26['prompts/classify.v1.md']]);
    expect(row).toMatchObject({
      provider: 'scripted', tickets: 700, intake_errors: 0, escalated: 312, human_queue: 241, model_results: 1012, model_failures: 19,
      paths: { A: 304, 'A>B': 155, 'A>B>H': 157, 'A>H': 84 },
      cents_per_1000_batch: 26, cents_per_1000_standard: 53, cap_status: 'n/a',
      models: { A: 'claude-haiku-5-5', B: 'claude-sonnet-5-5' }, threshold_bps: 7500,
      started_at: '2026-10-19T12:00:00.000Z', finished_at: '2026-10-19T12:00:01.000Z',
      submitted_at: null, completed_at: null, latency_s_p50: null, latency_s_p95: null,
    });
    // brief §11 tokens line (tier A input side; tier B's write is the documented ≤1,316 approximation)
    expect(row.tokens.A).toEqual({ input: 53513, cache_read: 906724, cache_creation_5m: 0, cache_creation_1h: 1316, output: 52626 });
    expect(row.tokens.B).toEqual({ input: 24478, cache_read: 410592, cache_creation_5m: 0, cache_creation_1h: 0, output: 23933 });
  });

  it('never overwrites a run and never repeats a run id', async () => {
    const dir = tmp();
    const input = 'fixtures/tickets_batch2.jsonl';
    const ledger = join(dir, 'runs.jsonl');
    const now = () => '2026-10-19T12:00:00.000Z';
    await runOnce({ input, provider: getProvider('scripted', { input }), out: join(dir, 'a'), ledger, now });
    await expect(runOnce({ input, provider: getProvider('scripted', { input }), out: join(dir, 'a'), ledger, now })).rejects.toThrow(/not empty/);
    await expect(runOnce({ input, provider: getProvider('scripted', { input }), out: join(dir, 'b'), ledger, now })).rejects.toThrow(/already has run/);
  });

  it('recorded replays a run directory; a bad intake line is reported, not fatal', async () => {
    const dir = tmp();
    const rec = join(dir, 'rec');
    cpSync('fixtures/scripted_tierA_batch2.jsonl', join(rec, 'tierA.jsonl'));
    cpSync('fixtures/scripted_tierB_batch2.jsonl', join(rec, 'tierB.jsonl'));
    const input = join(dir, 'tickets.jsonl');
    const first = (await import('node:fs')).readFileSync('fixtures/tickets_batch2.jsonl', 'utf8').split('\n').slice(0, 3).join('\n');
    writeFileSync(input, first + '\n{not json}\n');
    const { row, decisions, intakeErrors } = await runOnce({ input, provider: getProvider('recorded', { input, recording: rec }), out: join(dir, 'o'), ledger: join(dir, 'l.jsonl'), now: clock() });
    expect([row.provider, row.tickets, decisions.length, intakeErrors.map((e) => e.code)]).toEqual(['recorded', 3, 3, ['INTAKE_JSON']]);
  });

  it('the live provider refuses before Phase 2, with or without the flag and key', () => {
    expect(() => getProvider('live', { input: 'x', env: {} })).toThrow(/LIVE_REFUSED/);
    expect(() => getProvider('live', { input: 'x', env: { TRIAGE_LIVE: '1', ANTHROPIC_API_KEY: 'k' } })).toThrow(/LIVE_NOT_AVAILABLE_IN_PHASE_1/);
    expect(() => getProvider('nope', { input: 'x' })).toThrow(/UNKNOWN_PROVIDER/);
  });
});
