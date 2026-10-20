import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readCsv } from '../src/io/csv.js';
import { driftReport } from '../src/io/driftreport.js';
import { loadPolicyData } from '../src/io/load.js';
import { appendOverrides, isOverridden, readOverrides } from '../src/io/overrides.js';
import { runOnce } from '../src/io/run.js';
import { standInOverrides } from '../src/eval/standin.js';
import { auditSampled } from '../src/pipeline/audit.js';
import { driftSignals, tvdBps, type WindowStats } from '../src/pipeline/drift.js';
import { getProvider } from '../src/providers/index.js';

const { data } = loadPolicyData();

describe('drift goldens (brief §10, tools/golden_answers.py)', () => {
  it('GD-01 tvd', () => expect(tvdBps({ a: 50, b: 30, c: 20 }, { a: 20, b: 30, c: 50 })).toBe(3000));
  it('GD-02 tvd with a label only in the window', () => expect(tvdBps({ a: 100 }, { a: 90, z: 10 })).toBe(1000));
  it('GD-03 tvd exact then rounded', () => expect(tvdBps({ a: 2, b: 1 }, { a: 1, b: 1 })).toBe(1667));
  const ws = (n: number, category: Record<string, number>, priority: Record<string, number>, escalated: number, human_queue: number, low_conf_a: number,
    unsupported_lang: number, results_total: number, results_failed: number, human_touched: number, overridden: number): WindowStats =>
    ({ n, category, priority, escalated, human_queue, low_conf_a, unsupported_lang, results_total, results_failed, human_touched, overridden });
  const base = ws(1000, { HOW_TO: 500, BUG: 500 }, { P3: 1000 }, 300, 200, 250, 50, 1300, 13, 280, 28);
  const win = ws(200, { HOW_TO: 80, BUG: 120 }, { P3: 200 }, 80, 56, 70, 22, 280, 7, 70, 11);
  const sig = Object.fromEntries(driftSignals(data.drift, base, win).map((s) => [s.id, [s.value_bps, s.fired]]));
  it('GD-04 category tvd fires at the threshold', () => expect(sig['LABEL_MIX_TVD_CATEGORY']).toEqual([1000, true]));
  it('GD-05 priority tvd', () => expect(sig['LABEL_MIX_TVD_PRIORITY']).toEqual([0, false]));
  it('GD-06 override delta', () => expect(sig['OVERRIDE_RATE_DELTA']).toEqual([571, true]));
  it('GD-07 escalation delta', () => expect(sig['ESCALATION_SHARE_DELTA']).toEqual([1000, true]));
  it('GD-08 human queue delta', () => expect(sig['HUMAN_QUEUE_SHARE_DELTA']).toEqual([800, true]));
  it('GD-09 low confidence delta', () => expect(sig['LOW_CONFIDENCE_SHARE_DELTA']).toEqual([1000, true]));
  it('GD-10 language delta', () => expect(sig['UNSUPPORTED_LANGUAGE_SHARE_DELTA']).toEqual([600, true]));
  it('GD-11 parse failure absolute', () => expect(sig['PARSE_FAILURE_RATE']).toEqual([250, true]));
  it('GD-12 a window below min_window_items never fires', () => {
    const small = ws(50, { BUG: 50 }, { P3: 50 }, 50, 50, 50, 50, 50, 50, 50, 50);
    expect(driftSignals(data.drift, base, small).some((s) => s.fired)).toBe(false);
  });
  it('a negative delta is reported as negative and does not fire', () => {
    expect(driftSignals(data.drift, win, base).find((s) => s.id === 'ESCALATION_SHARE_DELTA')).toMatchObject({ value_bps: -1000, fired: false });
  });
});

describe('overrides', () => {
  it('append-only, latest row per ticket wins, a confirmation is not an override', () => {
    const p = join(mkdtempSync(join(tmpdir(), 'triage-ov-')), 'o.jsonl');
    const row = (category: string, priority: string) => ({ ticket_id: 'T1', run_id: 'r', category, priority, by: 'me', at: 't' });
    appendOverrides([row('BUG', 'P2')], p);
    expect(isOverridden({ ticket_id: 'T1', category: 'BUG', priority: 'P3' }, readOverrides(p))).toBe(true);
    appendOverrides([row('BUG', 'P3')], p);
    expect(isOverridden({ ticket_id: 'T1', category: 'BUG', priority: 'P3' }, readOverrides(p))).toBe(false);
    expect(() => appendOverrides([{ ...row('BUG', 'P3'), by: '' }], p)).toThrow(/missing by/);
  });
  it('the audit sample matches the oracle hash on a few ids', () => {
    // triagelib.audit_sampled(id, 20261019), checked against the reference human_touched column below
    expect(['B1-0001', 'B1-0002'].map((id) => auditSampled(data.policy, 20261019, id))).toEqual([false, false]);
  });
});

describe('batch 2 against batch 1 (brief §11)', () => {
  it('overridden equals the reference on every ticket; the eight values match and exactly five fire', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'triage-drift-'));
    const ledger = join(dir, 'runs.jsonl');
    const overrides = join(dir, 'overrides.jsonl');
    const runs: Record<number, string> = {};
    for (const n of [1, 2]) {
      const input = `fixtures/tickets_batch${n}.jsonl`;
      const out = join(dir, `b${n}`);
      const { row, decisions } = await runOnce({ input, provider: getProvider('scripted', { input }), out, ledger, now: () => `2026-10-19T12:00:0${n}.000Z` });
      const key = new Map(readCsv(`fixtures/answer_key_batch${n}.csv`).map((r) => [r['ticket_id']!, r]));
      appendOverrides(standInOverrides(row.run_id, decisions, key, 't'), overrides);
      const latest = readOverrides(overrides);
      expect(decisions.map((d) => String(d.human_touched && isOverridden(d, latest))))
        .toEqual(readCsv(`fixtures/decisions_batch${n}.csv`).map((r) => r['overridden']));
      runs[n] = out;
    }
    const r = driftReport(runs[1]!, runs[2]!, overrides);
    expect([r.stats.baseline.overridden, r.stats.baseline.human_touched, r.stats.window.overridden, r.stats.window.human_touched]).toEqual([41, 287, 46, 272]);
    expect(r.signals.map((s) => [s.id, s.value_bps, s.fired])).toEqual([
      ['LABEL_MIX_TVD_CATEGORY', 1423, true], ['LABEL_MIX_TVD_PRIORITY', 1429, true], ['OVERRIDE_RATE_DELTA', 262, false],
      ['ESCALATION_SHARE_DELTA', 1023, true], ['HUMAN_QUEUE_SHARE_DELTA', 1477, true], ['LOW_CONFIDENCE_SHARE_DELTA', 666, false],
      ['UNSUPPORTED_LANGUAGE_SHARE_DELTA', 686, true], ['PARSE_FAILURE_RATE', 103, false],
    ]);
  });
});
