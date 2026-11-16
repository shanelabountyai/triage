import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseResults, readResults } from '../src/io/results.js';
import { parseResult, tierResult, type TierResult } from '../src/pipeline/parse.js';
import type { Schema } from '../src/pipeline/validate.js';

const schema = JSON.parse(readFileSync('schemas/triage.v1.json', 'utf8')) as Schema;
const good = {
  category: 'BILLING', category_confidence_bps: 9000, priority: 'P3', priority_confidence_bps: 9000,
  needs_human: false, needs_human_confidence_bps: 9000, language: 'en', secondary_category: 'NONE', reason: 'r',
};
const fail = (o: unknown) => {
  const r = parseResult(typeof o === 'string' ? o : JSON.stringify(o), schema);
  return 'failure' in r ? r.failure : '';
};

describe('GP parse goldens', () => {
  it('GP-01 enums and language are case-insensitive', () => {
    const r = parseResult(JSON.stringify({ ...good, category: 'billing', language: 'EN', secondary_category: 'none' }), schema);
    expect(r).toEqual({ parsed: expect.objectContaining({ category: 'BILLING', language: 'en', secondaryCategory: 'NONE' }) });
  });
  it('GP-02..08 typed failures', () => {
    const { reason: _r, ...noReason } = good;
    expect(fail('The ticket is about billing.')).toBe('PARSE_JSON');
    expect(fail({ ...good, category: 'REFUND' })).toBe('PARSE_ENUM:category');
    expect(fail({ ...good, category_confidence_bps: 10001 })).toBe('PARSE_RANGE:category_confidence_bps');
    expect(fail(noReason)).toBe('PARSE_MISSING:reason');
    expect(fail({ ...good, route: 'TIER1' })).toBe('PARSE_EXTRA_KEY');
    expect(fail({ ...good, needs_human: 0 })).toBe('PARSE_TYPE:needs_human');
    expect(fail(JSON.stringify(good).replace('"category_confidence_bps":9000', '"category_confidence_bps":9000.0'))).toBe('PARSE_RANGE:category_confidence_bps');
  });
  it('GP-09 a refusal is PARSE_REFUSAL, even when its text would parse (D-40 item 4)', () => {
    const line = (stop_reason: string) => JSON.stringify({ custom_id: 'r', result: { type: 'succeeded', message: {
      model: 'm', stop_reason, content: [{ type: 'text', text: JSON.stringify(good) }], usage: { input_tokens: 1, output_tokens: 1 } } } });
    expect(tierResult(parseResults(line('refusal')).results.get('r'), schema).failure).toBe('PARSE_REFUSAL');
    expect(tierResult(parseResults(line('end_turn')).results.get('r'), schema).failure).toBe('');
  });
  it('shape, bool-as-integer, bad language', () => {
    expect(fail('[1]')).toBe('PARSE_SHAPE');
    expect(fail({ ...good, priority_confidence_bps: true })).toBe('PARSE_RANGE:priority_confidence_bps');
    expect(fail({ ...good, needs_human_confidence_bps: -1 })).toBe('PARSE_RANGE:needs_human_confidence_bps');
    expect(fail({ ...good, language: 'eng' })).toBe('PARSE_TYPE:language');
    expect(fail(good)).toBe('');
  });
});

describe('results reader', () => {
  const ok = (id: string, usage: unknown) => JSON.stringify({
    custom_id: id, result: { type: 'succeeded', message: { model: 'm', content: [{ type: 'text', text: '{}' }], usage } },
  });
  it('one typed error per bad line, usage normalised', () => {
    const text = [
      ok('a', { input_tokens: 5, output_tokens: 7, cache_read_input_tokens: 3, cache_creation_input_tokens: 4, cache_creation: { ephemeral_5m_input_tokens: 1, ephemeral_1h_input_tokens: 3 } }),
      '{x',
      JSON.stringify({ custom_id: 'b', result: { type: 'weird' } }),
      ok('c', { input_tokens: 5 }),
      ok('d', { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 4, cache_creation: { ephemeral_5m_input_tokens: 1 } }),
      ok('a', { input_tokens: 1, output_tokens: 1 }),
      JSON.stringify({ custom_id: 'e', result: { type: 'expired' } }),
    ].join('\n');
    const { results, errors } = parseResults(text);
    expect(errors.map((e) => [e.line, e.code])).toEqual([[2, 'RESULT_JSON'], [3, 'RESULT_SHAPE'], [4, 'RESULT_SHAPE'], [5, 'RESULT_SHAPE'], [6, 'RESULT_DUPLICATE_ID']]);
    expect(results.get('a')?.usage).toEqual({ input: 5, cacheRead: 3, cacheCreation5m: 1, cacheCreation1h: 3, output: 7 });
    expect(tierResult(results.get('e'), schema).failure).toBe('expired');
    expect(tierResult(undefined, schema).failure).toBe('missing');
  });
});

describe('fixture result files', () => {
  const files = [1, 2].flatMap((b) => ['A', 'B'].map((t) => `fixtures/scripted_tier${t}_batch${b}.jsonl`));
  const tiers = Object.fromEntries(files.map((f) => {
    const { results, errors } = readResults(f);
    expect(errors).toEqual([]);
    return [f, new Map([...results].map(([id, r]) => [id, tierResult(r, schema)]))];
  })) as Record<string, Map<string, TierResult>>;
  const tally = (m: Map<string, TierResult>, ids?: Set<string>) => {
    const c: Record<string, number> = {};
    for (const [id, t] of m) if (t.failure && (!ids || ids.has(id))) c[t.failure] = (c[t.failure] ?? 0) + 1;
    return c;
  };
  const escalated = (b: number) => new Set(readFileSync(`fixtures/decisions_batch${b}.csv`, 'utf8').trim().split('\n').slice(1)
    .map((l) => l.split(',')).filter((c) => c[1]?.includes('B')).map((c) => c[0] as string));

  it('failure counts match brief §11', () => {
    expect(tally(tiers['fixtures/scripted_tierA_batch1.jsonl']!)).toEqual({ 'PARSE_ENUM:category': 6, PARSE_JSON: 3, errored: 10 });
    expect(tally(tiers['fixtures/scripted_tierB_batch1.jsonl']!, escalated(1))).toEqual({});
    expect(tally(tiers['fixtures/scripted_tierA_batch2.jsonl']!)).toEqual({ 'PARSE_ENUM:category': 2, PARSE_JSON: 2, errored: 2 });
    expect(tally(tiers['fixtures/scripted_tierB_batch2.jsonl']!, escalated(2))).toEqual({ errored: 2 });
  });

  it('agrees with triagelib.parse_result and reference_pipeline.to_tier on every line', () => {
    const py = `import json,sys
sys.path.insert(0,'tools')
from reference_pipeline import to_tier
out={}
for f in ${JSON.stringify(files)}:
    for l in open(f,encoding='utf-8'):
        r=json.loads(l); t=to_tier('A',r); p=t.parsed; u=t.usage
        out[f+'|'+r['custom_id']]=[t.failure, None if p is None else [p.category,p.category_bps,p.priority,p.priority_bps,p.needs_human,p.needs_human_bps,p.language,p.secondary_category,p.reason],
          None if not u else [u['input_tokens'],u.get('cache_read_input_tokens',0),u.get('cache_creation_input_tokens',0)-u['cache_creation_1h_input_tokens'],u['cache_creation_1h_input_tokens'],u['output_tokens']]]
print(json.dumps(out))`;
    const oracle = JSON.parse(execFileSync('python3', ['-c', py], { encoding: 'utf8', maxBuffer: 1 << 26 })) as Record<string, unknown>;
    const ours: Record<string, unknown> = {};
    for (const f of files) for (const [id, t] of tiers[f]!) {
      const p = t.parsed; const u = t.usage;
      ours[`${f}|${id}`] = [t.failure, p && [p.category, p.categoryBps, p.priority, p.priorityBps, p.needsHuman, p.needsHumanBps, p.language, p.secondaryCategory, p.reason],
        u && [u.input, u.cacheRead, u.cacheCreation5m, u.cacheCreation1h, u.output]];
    }
    expect(Object.keys(ours)).toHaveLength(2400);
    expect(ours).toEqual(oracle);
  });
});
