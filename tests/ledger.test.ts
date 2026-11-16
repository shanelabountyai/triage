// Task 3.1: ledger:show over the committed sample ledger tests/samples/runs.jsonl (three rows: a live run whose
// decisions are the committed recordings/batch1, a replay whose out dir does not exist, a tier-B top-up with no out).
// Every expected number is derived by hand from those files, never copied from the output.
import { describe, expect, it } from 'vitest';
import { ledgerTable, runDetail } from '../src/io/ledger.js';

const LEDGER = 'tests/samples/runs.jsonl';
const HASHES = '1853dfe9 6df58154 bc2d7fed c94a2c1d 97b5dcb6';
const cells = (line: string) => line.trim().split(/\s{2,}/);

describe('ledgerTable', () => {
  const lines = ledgerTable(LEDGER);
  it('one row per run, columns in order, cents from pico half up', () => {
    expect(lines).toHaveLength(5);
    expect(cells(lines[0]!)).toEqual(['run id', 'provider', 'models (A / B)', 'tickets', 'cents', 'cap', 'p50/p95 s', 'policy', 'drift', 'prices', 'triage', 'classify']);
    expect(cells(lines[1]!)).toEqual(['20261025T143308.223Z-live', 'live', 'claude-haiku-5-5 / claude-sonnet-5-5', '700', '46', 'OK', '364/423', HASHES]);
    expect(cells(lines[2]!)).toEqual(['20261025T211251.995Z-recorded', 'recorded', 'claude-haiku-5-5 / claude-sonnet-5-5', '500', '40', 'n/a', 'n/a', HASHES]);
    expect(cells(lines[3]!)).toEqual(['20261026T150208.981Z-live', 'live', 'claude-haiku-5-5 / claude-sonnet-5-5', '276', '4', 'OK', '483/483', HASHES]);
  });
  it('the totals line reconciles to the ledger: 459037705000 + 37867765000 pico = 496905470000 → 50¢ over the 2 live rows; the 40¢ replay spends nothing', () => {
    expect(lines[4]).toBe('3 runs · live spend 50¢ over 2 live rows (pico sum, what the project cap reads) · 1 replay rows spend nothing');
  });
  it('an empty or missing ledger prints a header and a zero totals line', () => {
    expect(ledgerTable('tests/samples/no-such-ledger.jsonl').at(-1)).toBe('0 runs · live spend 0¢ over 0 live rows (pico sum, what the project cap reads) · 0 replay rows spend nothing');
  });
});

describe('runDetail', () => {
  it('a live run over the committed recording: paths, queue share, failures by code, cents per 1,000', () => {
    const d = runDetail(LEDGER, '20261025T143308.223Z-live');
    expect(d[0]).toBe('run 20261025T143308.223Z-live (live) cap OK');
    expect(d[1]).toBe('  input: fixtures/tickets_batch1.jsonl (sha256 e02c5395…)');
    expect(d[2]).toBe('  out:   recordings/batch1');
    expect(d[3]).toBe('  decisions: 700 rows from recordings/batch1/decisions.jsonl');
    for (const p of ['A 219', 'A>B 172', 'A>H 57', 'A>B>H 252']) expect(d[4]).toContain(p); // 219+172+57+252 = 700
    expect(d[5]).toBe('  human queue: 309 of 700 (44.14%)'); // D-51: 309 of 700; 309·10000/700 = 4414.28 → 4414 bps
    expect(d[6]).toBe('  failures: FINAL_TIER_FAILED:PARSE_JSON 1'); // the one Sonnet max_tokens stop (D-8, carried item 3.7)
    // 459037705000 pico = 45.90¢ → 46¢; per 1,000: 459037705000·1000 / (700·10^10) = 65.58 → 66
    expect(d[7]).toBe('  cost: 46¢ over 700 decisions at batch prices (ledger row 46¢), 66¢ per 1,000 tickets');
    expect(d).toHaveLength(8);
  });
  it('a top-up row has no out and no decisions', () => {
    const d = runDetail(LEDGER, '20261026T150208.981Z-live');
    expect(d[0]).toBe('run 20261026T150208.981Z-live (live, tier-B top-up of recordings/batch1) cap OK');
    expect(d.at(-1)).toBe('  decisions: none (a top-up appends tier-B lines to its recording and takes no decisions)');
  });
  it('a row whose out dir is gone says so instead of throwing', () => {
    expect(runDetail(LEDGER, '20261025T211251.995Z-recorded').at(-1)).toBe('  decisions: /nonexistent/rep2/decisions.jsonl not found');
  });
  it('an unknown run id is a typed refusal', () => {
    expect(() => runDetail(LEDGER, 'nope')).toThrow(/LEDGER_UNKNOWN_RUN:nope/);
  });
});
