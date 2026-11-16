// Task 3.2: overrides:add over the committed sample ledger (tests/samples/runs.jsonl; the live row's decisions are
// recordings/batch1). Three typed refusals, each before anything is written; one accepted row that drift's reader takes unchanged.
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addOverride, readOverrides } from '../src/io/overrides.js';
import type { Policy } from '../src/pipeline/decide.js';

const LEDGER = 'tests/samples/runs.jsonl';
const RUN = '20261025T143308.223Z-live';
const policy = JSON.parse(readFileSync('routing/policy.v1.json', 'utf8')) as Policy;
const row = { run_id: RUN, ticket_id: 'B1-0001', category: 'BILLING', priority: 'P2', by: 'shane', at: '2026-10-28T10:00:00Z' };
const fresh = () => join(mkdtempSync(join(tmpdir(), 'triage-add-')), 'overrides.jsonl');

describe('addOverride', () => {
  it('refuses a run not in the ledger and writes nothing', () => {
    const p = fresh();
    expect(() => addOverride({ ledgerPath: LEDGER, overridesPath: p, policy, row: { ...row, run_id: 'nope' } })).toThrow(/^OVERRIDE_UNKNOWN_RUN:nope/);
    expect(existsSync(p)).toBe(false);
  });
  it('refuses a ticket not in that run and writes nothing', () => {
    const p = fresh();
    expect(() => addOverride({ ledgerPath: LEDGER, overridesPath: p, policy, row: { ...row, ticket_id: 'B2-0001' } })).toThrow(/^OVERRIDE_UNKNOWN_TICKET:B2-0001/);
    expect(existsSync(p)).toBe(false);
  });
  it('refuses a label outside the policy enums and writes nothing', () => {
    const p = fresh();
    expect(() => addOverride({ ledgerPath: LEDGER, overridesPath: p, policy, row: { ...row, category: 'REFUND' } })).toThrow(/^OVERRIDE_BAD_LABEL:category=REFUND/);
    expect(() => addOverride({ ledgerPath: LEDGER, overridesPath: p, policy, row: { ...row, priority: 'P0' } })).toThrow(/^OVERRIDE_BAD_LABEL:priority=P0/);
    expect(existsSync(p)).toBe(false);
  });
  it('appends an accepted row that readOverrides returns unchanged; a correction is a second row and the latest wins', () => {
    const p = fresh();
    addOverride({ ledgerPath: LEDGER, overridesPath: p, policy, row });
    addOverride({ ledgerPath: LEDGER, overridesPath: p, policy, row: { ...row, priority: 'P1', at: '2026-10-28T11:00:00Z' } });
    expect(readFileSync(p, 'utf8').split('\n').filter(Boolean)).toHaveLength(2);
    const { byRun, errors } = readOverrides(p, policy);
    expect(errors).toEqual([]);
    expect(byRun.get(RUN)!.get('B1-0001')).toEqual({ category: 'BILLING', priority: 'P1' });
  });
});
