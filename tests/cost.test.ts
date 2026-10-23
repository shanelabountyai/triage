import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseResults, readResults } from '../src/io/results.js';
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

// Task 2.4: usage as the API sends it (SDK 0.137.0 `Usage`: cache counters `number | null`, extra fields), read by
// the D-9 reader and priced at batch rates. Expected values by hand from pricing/prices.v1.json (pico per token).
describe('GC real usage shape (2.4)', () => {
  const line = (id: string, model: string, usage: object) => JSON.stringify({ custom_id: id, result: { type: 'succeeded',
    message: { model, stop_reason: 'end_turn', content: [{ type: 'text', text: '{}' }], usage } } });
  const extra = { inference_geo: 'us', server_tool_use: null, service_tier: 'batch', speed: null };
  const { results, errors } = parseResults([
    // first request writes the prefix to the 1h cache; 180 of the 300 output tokens are thinking, billed as output
    line('w', 'claude-haiku-5-5', { ...extra, input_tokens: 120, output_tokens: 300, output_tokens_details: { thinking_tokens: 180 },
      cache_read_input_tokens: 0, cache_creation_input_tokens: 1316, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1316 } }),
    line('r', 'claude-haiku-5-5', { ...extra, input_tokens: 80, output_tokens: 90, output_tokens_details: null,
      cache_read_input_tokens: 1316, cache_creation_input_tokens: null, cache_creation: null }),
    line('x', 'claude-haiku-5-5', { ...extra, input_tokens: 80, output_tokens: 90, cache_read_input_tokens: null,
      cache_creation_input_tokens: 1316, cache_creation: null }),
    line('u', 'claude-haiku-5-5-20261001', { ...extra, input_tokens: 1, output_tokens: 1 }),
  ].join('\n'));
  const cost = (id: string) => costPico(results.get(id)!.model!, results.get(id)!.usage, true, prices);
  it('a 1h write: (120×100,000 + 1,316×200,000 + 300×500,000) ÷ 2', () => {
    expect(results.get('w')?.usage).toEqual({ input: 120, cacheRead: 0, cacheCreation5m: 0, cacheCreation1h: 1316, output: 300 });
    expect(cost('w')).toBe(212_600_000n); // priced as a 5m write it would be 163,250,000
  });
  it('a cache read with null creation counters: (80×100,000 + 1,316×10,000 + 90×500,000) ÷ 2', () => {
    expect(cost('r')).toBe(33_080_000n);
  });
  it('a write without the 5m/1h split is a typed error, not a guessed TTL', () => {
    expect(errors).toEqual([{ line: 3, code: 'RESULT_SHAPE', detail: 'cache_creation_input_tokens without usage.cache_creation' }]);
  });
  it('an unknown model id throws', () => {
    expect(() => cost('u')).toThrow(/COST_UNKNOWN_MODEL/);
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
