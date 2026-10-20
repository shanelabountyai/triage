import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readResults } from '../src/io/results.js';
import { readTickets } from '../src/io/tickets.js';
import { costPico, estTokens, priceRow, type Prices } from '../src/pipeline/cost.js';
import { escalate, type Policy } from '../src/pipeline/decide.js';
import { picoToCents } from '../src/pipeline/num.js';
import { tierResult, type Usage } from '../src/pipeline/parse.js';
import type { Schema } from '../src/pipeline/validate.js';

const prices = JSON.parse(readFileSync('pricing/prices.v1.json', 'utf8')) as Prices;
const policy = JSON.parse(readFileSync('routing/policy.v1.json', 'utf8')) as Policy;
const schema = JSON.parse(readFileSync('schemas/triage.v1.json', 'utf8')) as Schema;

describe('GC cost goldens', () => {
  const u: Usage = { input: 100, cacheRead: 1300, cacheCreation5m: 0, cacheCreation1h: 0, output: 80 };
  const u2: Usage = { input: 100, cacheRead: 0, cacheCreation5m: 0, cacheCreation1h: 1300, output: 80 };
  it('GC-01..09', () => {
    expect(costPico('claude-haiku-5-5', u, false, prices)).toBe(63_000_000n);
    expect(costPico('claude-haiku-5-5', u, true, prices)).toBe(31_500_000n);
    expect(costPico('claude-sonnet-5-5', u2, false, prices)).toBe(200_000_000n + 5_200_000_000n + 800_000_000n);
    expect(costPico('claude-sonnet-5-5', { ...u2, cacheCreation5m: 1300, cacheCreation1h: 0 }, false, prices)).toBe(200_000_000n + 3_250_000_000n + 800_000_000n);
    expect(costPico('claude-haiku-5-5', { input: 100_001, cacheRead: 0, cacheCreation5m: 0, cacheCreation1h: 0, output: 0 }, false, prices)).toBe(100_001n * 500_000n);
    expect(picoToCents(31_500_000n * 1000n)).toBe(3);
    expect(picoToCents(63_000_000n * 1000n)).toBe(6);
    expect(picoToCents(5n * 10n ** 9n)).toBe(1);
    expect(() => costPico('claude-opus-4-1', u, false, prices)).toThrow(/COST_UNKNOWN_MODEL/);
  });
  it('long-prompt row starts above 100,000 total input, cache tokens included', () => {
    expect(priceRow('claude-haiku-5-5', 100_000, prices).input).toBe(100_000);
    expect(priceRow('claude-haiku-5-5', 100_001, prices).input).toBe(500_000);
  });
  it('a missing response costs 0 but its model must be priced', () => {
    expect(costPico('claude-sonnet-5-5', null, true, prices)).toBe(0n);
    expect(() => costPico('nope', null, true, prices)).toThrow(/COST_UNKNOWN_MODEL/);
  });
  it('estTokens is ceil(utf-8 bytes / 4)', () => {
    expect([estTokens(''), estTokens('abcd'), estTokens('abcde'), estTokens('é')]).toEqual([0, 1, 2, 1]);
  });
});

// cost_pico_batch, cost_pico_standard of fixtures/decisions_batch{n}.csv (reference_pipeline.run_batch):
// A's usage plus B's when escalated, the tier's model from the policy when the line carries none.
describe.each([1, 2])('batch %i', (n) => {
  it('reproduces both cost columns on every ticket', () => {
    const ra = readResults(`fixtures/scripted_tierA_batch${n}.jsonl`).results;
    const rb = readResults(`fixtures/scripted_tierB_batch${n}.jsonl`).results;
    const ours = readTickets(`fixtures/tickets_batch${n}.jsonl`).tickets.map((t) => {
      const a = tierResult(ra.get(t.ticket_id), schema);
      const b = escalate(a, policy).escalate ? tierResult(rb.get(t.ticket_id), schema) : null;
      const cost = (batch: boolean) => costPico(a.model ?? policy.tiers.A.model, a.usage, batch, prices)
        + (b ? costPico(b.model ?? policy.tiers.B.model, b.usage, batch, prices) : 0n);
      return `${t.ticket_id},${cost(true)},${cost(false)}`;
    });
    const csv = readFileSync(`fixtures/decisions_batch${n}.csv`, 'utf8').trim().split('\n').slice(1)
      .map((l) => l.match(/^([^,]+),.*,(\d+),(\d+),(?:true|false),(?:true|false)$/)!.slice(1).join(','));
    expect(ours).toHaveLength(n === 1 ? 700 : 500);
    expect(ours).toEqual(csv);
  });
});
