import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { driftReport, lastRuns, runDecisions } from '../src/io/drift.js';
import { appendOverrides, readOverrides } from '../src/io/overrides.js';
import { triageRun } from '../src/io/run.js';
import type { Policy } from '../src/pipeline/decide.js';
import { driftSignals, tvdBps, windowStats, type DriftPolicy, type WindowStats } from '../src/pipeline/drift.js';

const drift = JSON.parse(readFileSync('monitoring/drift.v1.json', 'utf8')) as DriftPolicy;
const policy = JSON.parse(readFileSync('routing/policy.v1.json', 'utf8')) as Policy;
const ws = (n: number, cat: Record<string, number>, pri: Record<string, number>, ...c: number[]): WindowStats => {
  const [escalated, humanQueue, lowConfA, unsupportedLang, resultsTotal, resultsFailed, humanTouched, overridden] = c as [number, number, number, number, number, number, number, number];
  return { n, categoryCounts: cat, priorityCounts: pri, escalated, humanQueue, lowConfA, unsupportedLang, resultsTotal, resultsFailed, humanTouched, reviewed: humanTouched, overridden };
};

describe('GD drift goldens (brief §10)', () => {
  it('GD-01..03 tvd', () => {
    expect(tvdBps({ a: 50, b: 30, c: 20 }, { a: 20, b: 30, c: 50 })).toBe(3000);
    expect(tvdBps({ a: 100 }, { a: 90, z: 10 })).toBe(1000);
    expect(tvdBps({ a: 2, b: 1 }, { a: 1, b: 1 })).toBe(1667);
  });
  const base = ws(1000, { HOW_TO: 500, BUG: 500 }, { P3: 1000 }, 300, 200, 250, 50, 1300, 13, 280, 28);
  it('GD-04..11 one worked baseline vs window', () => {
    const win = ws(200, { HOW_TO: 80, BUG: 120 }, { P3: 200 }, 80, 56, 70, 22, 280, 7, 70, 11);
    expect(Object.fromEntries(driftSignals(base, win, drift).map((s) => [s.id, [s.valueBps, s.fired]]))).toEqual({
      LABEL_MIX_TVD_CATEGORY: [1000, true], LABEL_MIX_TVD_PRIORITY: [0, false], OVERRIDE_RATE_DELTA: [571, true],
      ESCALATION_SHARE_DELTA: [1000, true], HUMAN_QUEUE_SHARE_DELTA: [800, true], LOW_CONFIDENCE_SHARE_DELTA: [1000, true],
      UNSUPPORTED_LANGUAGE_SHARE_DELTA: [600, true], PARSE_FAILURE_RATE: [250, true],
    });
  });
  it('GD-12 a window under min_window_items never fires', () => {
    expect(driftSignals(base, ws(50, { BUG: 50 }, { P3: 50 }, 50, 50, 50, 50, 50, 50, 50, 50), drift).some((s) => s.fired)).toBe(false);
  });
});

describe('windowStats', () => {
  it('D-37: an unreviewed human-touched ticket is outside the override-rate denominator', () => {
    const row = (id: string, human_touched: boolean) => ({ ticket_id: id, path: 'A', final_tier: 'A', category: 'BUG', priority: 'P3',
      route: 'ENGINEERING', needs_human: false, language: 'en', min_bps: 9000, flags: [], reasons: [], cost_pico_batch: '0',
      cost_pico_standard: '0', human_touched, overridden: null, tier_a_min_bps: 9000 });
    const rows = [row('T-1', true), row('T-2', true), row('T-3', true), row('T-4', false)];
    const ovr = new Map([['T-1', { category: 'HOW_TO', priority: 'P3' }], ['T-4', { category: 'HOW_TO', priority: 'P3' }]]);
    const w = windowStats(rows, ovr, policy);
    expect([w.humanTouched, w.reviewed, w.overridden]).toEqual([3, 1, 1]);
  });
});

describe('overrides.jsonl', () => {
  it('a correction is a new row and the latest wins; a bad line is a typed error', () => {
    const p = join(mkdtempSync(join(tmpdir(), 'triage-ovr-')), 'overrides.jsonl');
    const row = { run_id: 'r1', ticket_id: 'T-1', category: 'BUG', priority: 'P2', by: 'mei', at: '2026-10-20T10:00:00Z' };
    appendOverrides(p, [row, { ...row, priority: 'P1', at: '2026-10-20T11:00:00Z' }]);
    writeFileSync(p, readFileSync(p, 'utf8') + 'not json\n' + JSON.stringify({ ...row, category: 'REFUND' }) + '\n');
    const { byRun, errors } = readOverrides(p, policy);
    expect(byRun.get('r1')?.get('T-1')).toEqual({ category: 'BUG', priority: 'P1' });
    expect(errors.map((e) => [e.line, e.code, e.code === 'OVERRIDE_FIELD' ? e.detail : ''])).toEqual([[3, 'OVERRIDE_JSON', ''], [4, 'OVERRIDE_FIELD', 'category']]);
  });
});

describe('drift:report, batch 2 vs batch 1 (scripted, answer key as the person, O-6) and pooled windows (3.3, D-55)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'triage-drift-'));
  const ledgerPath = join(dir, 'runs.jsonl'), overridesPath = join(dir, 'overrides.jsonl');
  const ids: string[] = [];
  // Three scripted runs: batch 1, batch 2, batch 1 again (the third is the pooling twin).
  const setup = (async () => {
    for (const [i, b] of [1, 2, 1].entries()) {
      const t = `2026-10-20T10:0${i + 1}:00.000Z`;
      const { rows, row } = await triageRun({ inPath: `fixtures/tickets_batch${b}.jsonl`, provider: 'scripted', outDir: join(dir, `r${i}`),
        ledgerPath, auditSeed: 20261019, now: () => t });
      ids.push(row.run_id);
      // The stand-in, as scripts/overrides-standin.ts: the key's labels on every human-touched ticket.
      const key = new Map(readFileSync(`fixtures/answer_key_batch${b}.csv`, 'utf8').trim().split('\n').slice(1)
        .map((l) => l.split(',')).map((f) => [f[0]!, { category: f[1]!, priority: f[3]! }]));
      appendOverrides(overridesPath, rows.filter((r) => r.human_touched)
        .map((r) => ({ run_id: row.run_id, ticket_id: r.ticket_id, ...key.get(r.ticket_id)!, by: 'answer-key', at: t })));
    }
  })();
  const report = (baseline: string[], window: string[]) => driftReport({ baseline, window, ledgerPath, overridesPath });

  it('prints the eight brief §11 values and fires exactly the five', async () => {
    await setup;
    const r = report([ids[0]!], [ids[1]!]);
    expect([r.base.overridden, r.base.reviewed, r.base.humanTouched, r.win.overridden, r.win.reviewed, r.win.humanTouched]).toEqual([41, 287, 287, 46, 272, 272]);
    const ref = readFileSync('fixtures/samples/reference_pipeline.output.txt', 'utf8').split('\n');
    const at = ref.indexOf('  signal                              value     threshold  fired');
    const table = r.lines.indexOf('  signal                              value     threshold  fired');
    expect(r.lines.slice(table, table + 9)).toEqual(ref.slice(at, at + 9));
    expect(r.signals.filter((s) => s.fired).map((s) => s.id)).toEqual(['LABEL_MIX_TVD_CATEGORY', 'LABEL_MIX_TVD_PRIORITY',
      'ESCALATION_SHARE_DELTA', 'HUMAN_QUEUE_SHARE_DELTA', 'UNSUPPORTED_LANGUAGE_SHARE_DELTA']);
  });

  it('invariance: batch 1 twice equals batch 1 once on every signal, over twice the denominator', async () => {
    await setup;
    const once = report([ids[1]!], [ids[0]!]), twice = report([ids[1]!], [ids[0]!, ids[2]!]);
    expect(twice.signals).toEqual(once.signals);
    expect([twice.win.n, twice.win.reviewed, twice.win.overridden]).toEqual([once.win.n * 2, once.win.reviewed * 2, once.win.overridden * 2]);
    expect(twice.lines[0]).toBe(`drift: ${ids[0]},${ids[2]} window (n 1400) vs ${ids[1]} baseline (n 500) (monitoring/drift.v1.json)`);
    expect(twice.lines.some((l) => l.includes('WARNING'))).toBe(false);
  });

  it('--last N: newest N runs with decisions vs the N before; a top-up row is not a run; too few is a refusal', async () => {
    await setup;
    expect(lastRuns(ledgerPath, 1)).toEqual({ window: [ids[2]], baseline: [ids[1]] });
    writeFileSync(ledgerPath, readFileSync(ledgerPath, 'utf8') + JSON.stringify({ run_id: 'topup', out: null, hashes: {} }) + '\n');
    expect(lastRuns(ledgerPath, 1)).toEqual({ window: [ids[2]], baseline: [ids[1]] });
    expect(() => lastRuns(ledgerPath, 2)).toThrow('DRIFT_LAST_TOO_FEW:2 (3 runs with decisions');
    expect(() => runDecisions(ledgerPath, 'topup')).toThrow('DRIFT_NO_DECISIONS:topup');
  });

  it('a mixed-policy-hash window prints a warning naming both hashes', async () => {
    await setup;
    const rows = readFileSync(ledgerPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const real = rows[0]['hashes']['routing/policy.v1.json'] as string;
    rows[2]['hashes']['routing/policy.v1.json'] = 'f'.repeat(64);
    writeFileSync(ledgerPath, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const r = report([ids[1]!], [ids[0]!, ids[2]!]);
    expect(r.lines[1]).toBe(`  WARNING: window pools runs under 2 policy hashes: ${real.slice(0, 8)}, ffffffff (a signal may be the policy change, not drift)`);
    expect(r.signals).toEqual(report([ids[1]!], [ids[0]!]).signals);
    expect(report([ids[0]!], [ids[2]!]).lines[1]).toBe(`  WARNING: window policy hash ffffffff differs from baseline ${real.slice(0, 8)} (a signal may be the policy change, not drift)`);
  });
});
