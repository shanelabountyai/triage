import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { recordedHashes } from '../src/io/hash.js';
import { triageRun } from '../src/io/run.js';
import type { DecisionRow } from '../src/pipeline/run.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'triage-run-'));
const clock = (...t: string[]) => () => t.shift()!;
const run = (dir: string, provider: 'scripted' | 'live' = 'scripted') => triageRun({
  inPath: 'fixtures/tickets_batch1.jsonl', provider, outDir: join(dir, 'out'), ledgerPath: join(dir, 'runs.jsonl'),
  auditSeed: 20261019, now: clock('2026-10-20T10:00:00.000Z', '2026-10-20T10:00:01.000Z'),
});

describe('triage:run over batch 1 (scripted)', () => {
  it('writes 700 decisions equal to fixtures/decisions_batch1.csv on every column, and one ledger row', async () => {
    const dir = tmp();
    await run(dir);
    const rows = readFileSync(join(dir, 'out/decisions.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as DecisionRow);
    // overridden needs a person's correction (1.10); the answer key stands in for that person here (O-6), as in the oracle.
    const key = new Map(readFileSync('fixtures/answer_key_batch1.csv', 'utf8').trim().split('\n').slice(1)
      .map((l) => l.split(',')).map((f) => [f[0]!, `${f[1]},${f[3]}`]));
    const ours = rows.map((r) => {
      const reasons = r.reasons.join('|');
      const overridden = r.human_touched && key.get(r.ticket_id) !== `${r.category},${r.priority}`;
      return [r.ticket_id, r.path, r.final_tier, r.category, r.priority, r.route, r.needs_human, r.language, r.min_bps,
        r.flags.join('|'), reasons.includes(',') ? `"${reasons}"` : reasons, r.cost_pico_batch, r.cost_pico_standard,
        r.human_touched, overridden].join(',');
    });
    expect(ours).toHaveLength(700);
    expect(ours).toEqual(readFileSync('fixtures/decisions_batch1.csv', 'utf8').trim().split('\n').slice(1));
    expect(rows.every((r) => r.overridden === null)).toBe(true);

    const ledger = readFileSync(join(dir, 'runs.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(ledger).toHaveLength(1);
    const row = ledger[0];
    expect(row.hashes).toEqual(recordedHashes());
    expect(row).toMatchObject({ run_id: '20261020T100000.000Z-scripted', provider: 'scripted', tickets: 700, intake_errors: 0,
      models: { A: 'claude-haiku-5-5', B: 'claude-sonnet-5-5' }, cap_status: 'n/a',
      started_at: '2026-10-20T10:00:00.000Z', finished_at: '2026-10-20T10:00:01.000Z',
      submitted_at: null, completed_at: null, latency_s_p50: null, latency_s_p95: null });
    expect(BigInt(row.cost_pico_batch)).toBe(rows.reduce((s, r) => s + BigInt(r.cost_pico_batch), 0n));
  });
  it('refuses to overwrite an earlier run\'s decisions', async () => {
    const dir = tmp();
    await run(dir);
    await expect(run(dir)).rejects.toThrow(/EEXIST/);
  });
  it('live without the caps and a provider builder refuses and writes nothing (tests/caps.test.ts drives a live run)', async () => {
    const dir = tmp();
    await expect(run(dir, 'live')).rejects.toThrow(/LIVE_ONLY_VIA_RUN/);
    expect(() => readFileSync(join(dir, 'runs.jsonl'))).toThrow(/ENOENT/);
  });
});
