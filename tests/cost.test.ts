import { describe, expect, it } from 'vitest';
import { readCsv } from '../src/io/csv.js';
import { loadPolicyData } from '../src/io/load.js';
import { readResults } from '../src/io/results.js';
import { readTickets } from '../src/io/tickets.js';
import { decideBatch } from '../src/pipeline/batch.js';
import { costPico, estTokens, priceRow } from '../src/pipeline/cost.js';
import { centsPer1000, fmtBps } from '../src/pipeline/num.js';
import type { Usage } from '../src/pipeline/types.js';

const { prices } = loadPolicyData().data;
const u: Usage = { input: 100, cacheRead: 1300, cacheCreation5m: 0, cacheCreation1h: 0, output: 80 };

describe('cost goldens (brief §10, tools/golden_answers.py)', () => {
  it('GC-01 haiku standard = 63,000,000 pico', () => expect(costPico(prices, 'claude-haiku-5-5', u, false)).toBe(63_000_000n));
  it('GC-02 haiku batch (half) = 31,500,000', () => expect(costPico(prices, 'claude-haiku-5-5', u, true)).toBe(31_500_000n));
  const w = { input: 100, cacheRead: 0, cacheCreation5m: 0, cacheCreation1h: 1300, output: 80 };
  it('GC-03 sonnet 1h write = 6,200,000,000', () => expect(costPico(prices, 'claude-sonnet-5-5', w, false)).toBe(6_200_000_000n));
  it('GC-04 sonnet 5m write = 4,250,000,000', () =>
    expect(costPico(prices, 'claude-sonnet-5-5', { ...w, cacheCreation5m: 1300, cacheCreation1h: 0 }, false)).toBe(4_250_000_000n));
  it('GC-05 haiku long-prompt row above 100,000 input tokens', () => {
    const big = { input: 100_001, cacheRead: 0, cacheCreation5m: 0, cacheCreation1h: 0, output: 0 };
    expect(costPico(prices, 'claude-haiku-5-5', big, false)).toBe(100_001n * 500_000n);
    expect(priceRow(prices, 'claude-haiku-5-5', 100_000).input).toBe(100_000); // the boundary itself is the short row
  });
  it('GC-09 unknown model raises', () => expect(() => costPico(prices, 'claude-opus-4-1', u, false)).toThrow(/no price/));
  it('batch rounding is half up on an odd total (every v1 price is even, so a synthetic row)', () => {
    const odd = { version: 't', batch_multiplier: { num: 1, den: 2 }, models: { m: { input: 3, output: 0, cache_write_5m: 0, cache_write_1h: 0, cache_read: 0 } } };
    expect(costPico(odd, 'm', { input: 1, cacheRead: 0, cacheCreation5m: 0, cacheCreation1h: 0, output: 0 }, true)).toBe(2n);
  });
});

describe('helpers', () => {
  it('cents per 1,000 equals the oracle on its own examples', () => {
    expect(centsPer1000(31_500_000n * 700n, 700)).toBe(3); // GC-06 per ticket at 700 tickets
    expect(centsPer1000(5n * 10n ** 9n, 1000)).toBe(1); // half a cent per 1,000: the GC-08 tie, up
    expect(centsPer1000(5n * 10n ** 9n - 1n, 1000)).toBe(0);
    expect(centsPer1000(0n, 0)).toBe(0);
  });
  it('estimate is ceil(utf-8 bytes / 4)', () => {
    expect([estTokens(''), estTokens('abcd'), estTokens('abcde'), estTokens('é')]).toEqual([0, 1, 2, 1]);
  });
  it('fmtBps prints the oracle format from integer digits', () => {
    expect([fmtBps(4457), fmtBps(10000), fmtBps(0), fmtBps(5), fmtBps(-5)]).toEqual(['44.57%', '100.00%', '0.00%', '0.05%', '-0.05%']);
  });
});

describe('per-ticket cost over the fixtures', () => {
  for (const n of [1, 2] as const) {
    it(`batch ${n}: cost_pico_batch and cost_pico_standard equal fixtures/decisions_batch${n}.csv on every ticket`, () => {
      const { tickets } = readTickets(`fixtures/tickets_batch${n}.jsonl`);
      const out = decideBatch(loadPolicyData().data, tickets,
        readResults(`fixtures/scripted_tierA_batch${n}.jsonl`).results, readResults(`fixtures/scripted_tierB_batch${n}.jsonl`).results);
      const ref = readCsv(`fixtures/decisions_batch${n}.csv`).map((r) => [r['ticket_id'], r['cost_pico_batch'], r['cost_pico_standard']]);
      expect(out.map((o) => [o.decision.ticket_id, String(o.costPicoBatch), String(o.costPicoStandard)])).toEqual(ref);
      // brief §11: batch 1 26 / 53 cents per 1,000, batch 2 32 / 64
      const sum = (f: (o: (typeof out)[number]) => bigint) => out.reduce((s, o) => s + f(o), 0n);
      expect([centsPer1000(sum((o) => o.costPicoBatch), out.length), centsPer1000(sum((o) => o.costPicoStandard), out.length)])
        .toEqual(n === 1 ? [26, 53] : [32, 64]);
    });
  }
});
