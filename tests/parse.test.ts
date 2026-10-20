import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { loadPolicyData } from '../src/io/load.js';
import { readResults } from '../src/io/results.js';
import { parseResult, tierResult } from '../src/pipeline/parse.js';

const { data } = loadPolicyData();
const code = (t: string) => {
  const r = parseResult(t, data.schema);
  return r.ok ? '' : r.code;
};
const good = '{"category":"billing","category_confidence_bps":9000,"priority":"P2","priority_confidence_bps":8000,"needs_human":false,"needs_human_confidence_bps":8500,"language":"EN","secondary_category":"none","reason":"x"}';

describe('parse goldens (brief §10, tools/golden_answers.py)', () => {
  it('GP-01 enum case-insensitive', () => {
    const r = parseResult(good, data.schema);
    expect(r.ok && [r.parsed.category, r.parsed.language, r.parsed.secondary_category]).toEqual(['BILLING', 'en', 'NONE']);
  });
  it('GP-02 not json', () => expect(code('I think this is billing')).toBe('PARSE_JSON'));
  it('GP-03 unknown enum', () => expect(code(good.replace('"billing"', '"REFUND"'))).toBe('PARSE_ENUM:category'));
  it('GP-04 bps out of range', () => expect(code(good.replace('9000', '10001'))).toBe('PARSE_RANGE:category_confidence_bps'));
  it('GP-05 missing key', () => expect(code(good.replace(',"reason":"x"', ''))).toBe('PARSE_MISSING:reason'));
  it('GP-06 extra key', () => expect(code(good.replace('"reason":"x"', '"reason":"x","route":"TIER1"'))).toBe('PARSE_EXTRA_KEY'));
  it('GP-07 bool as int', () => expect(code(good.replace('"needs_human":false', '"needs_human":0'))).toBe('PARSE_TYPE:needs_human'));
  it('GP-08 float bps', () => expect(code(good.replace('9000', '9000.0'))).toBe('PARSE_RANGE:category_confidence_bps'));
});

describe('parse edges the oracle defines', () => {
  it('a non-object is PARSE_SHAPE', () => {
    for (const t of ['[]', 'null', '7', '"x"']) expect(code(t)).toBe('PARSE_SHAPE');
  });
  it('exponent, negative and boolean bps are PARSE_RANGE', () => {
    expect(code(good.replace('9000', '9e3'))).toBe('PARSE_RANGE:category_confidence_bps');
    expect(code(good.replace('9000', '-1'))).toBe('PARSE_RANGE:category_confidence_bps');
    expect(code(good.replace('9000', 'true'))).toBe('PARSE_RANGE:category_confidence_bps');
    expect(code(good.replace('9000', '0'))).toBe('');
    expect(code(good.replace('9000', '10000'))).toBe('');
  });
  it('language must be two letters', () => {
    expect(code(good.replace('"EN"', '"eng"'))).toBe('PARSE_TYPE:language');
    expect(code(good.replace('"EN"', '7'))).toBe('PARSE_TYPE:language');
  });
  it('the first miss wins, in the oracle order (missing before extra before enum before range)', () => {
    const both = good.replace('"billing"', '"REFUND"').replace('8000', '-5');
    expect(code(both)).toBe('PARSE_ENUM:category');
    expect(code(good.replace(',"reason":"x"', ',"route":"x"'))).toBe('PARSE_MISSING:reason');
  });
  it('a missing result line is the typed failure "missing"', () => {
    expect(tierResult('A', 'claude-haiku-5-5', undefined, data.schema)).toEqual({ tier: 'A', model: 'claude-haiku-5-5', parsed: null, failure: 'missing', usage: null });
  });
});

const files = ['scripted_tierA_batch1', 'scripted_tierB_batch1', 'scripted_tierA_batch2', 'scripted_tierB_batch2'];

describe('the four scripted fixture files', () => {
  const read = Object.fromEntries(files.map((f) => [f, readResults(`fixtures/${f}.jsonl`)]));

  it('read without an error: 700 / 700 / 500 / 500 lines', () => {
    expect(files.map((f) => [read[f]!.errors.length, read[f]!.results.size])).toEqual([[0, 700], [0, 700], [0, 500], [0, 500]]);
  });

  it('tier-A failure counts match brief §11 (tier A reads every ticket, so every line is used)', () => {
    const fails = (f: string) => {
      const c: Record<string, number> = {};
      for (const line of read[f]!.results.values()) {
        const t = tierResult('A', 'claude-haiku-5-5', line, data.schema);
        if (t.failure) c[t.failure] = (c[t.failure] ?? 0) + 1;
      }
      return c;
    };
    expect(fails('scripted_tierA_batch1')).toEqual({ 'PARSE_ENUM:category': 6, PARSE_JSON: 3, errored: 10 });
    expect(fails('scripted_tierA_batch2')).toEqual({ 'PARSE_ENUM:category': 2, PARSE_JSON: 2, errored: 2 });
  });

  it('agree with triagelib.parse_result and the oracle usage on every one of the 2,400 lines', () => {
    const py = `
import json, sys
sys.path.insert(0, "tools")
from reference_pipeline import load_results, to_tier
out = {}
for f in ${JSON.stringify(files)}:
    for cid, raw in load_results(f"fixtures/{f}.jsonl").items():
        t = to_tier("A", raw)
        p = t.parsed
        u = t.usage
        out[f + "/" + cid] = [t.model, t.failure, None if p is None else [p.category, p.category_bps, p.priority, p.priority_bps, p.needs_human, p.needs_human_bps, p.language, p.secondary_category, p.reason],
            None if not u else [u["input_tokens"], u.get("cache_read_input_tokens", 0), u.get("cache_creation_input_tokens", 0) - u["cache_creation_1h_input_tokens"], u["cache_creation_1h_input_tokens"], u["output_tokens"]]]
print(json.dumps(out))`;
    const oracle = JSON.parse(execFileSync('python3', ['-c', py], { encoding: 'utf8', maxBuffer: 64 << 20 })) as Record<string, unknown>;
    const ours: Record<string, unknown> = {};
    for (const f of files) {
      for (const [cid, line] of read[f]!.results) {
        const t = tierResult('A', 'claude-haiku-5-5', line, data.schema);
        const p = t.parsed;
        const u = t.usage;
        ours[`${f}/${cid}`] = [t.model, t.failure,
          p && [p.category, p.category_confidence_bps, p.priority, p.priority_confidence_bps, p.needs_human, p.needs_human_confidence_bps, p.language, p.secondary_category, p.reason],
          u && [u.input, u.cacheRead, u.cacheCreation5m, u.cacheCreation1h, u.output]];
      }
    }
    expect(Object.keys(ours).length).toBe(2400);
    expect(ours).toEqual(oracle);
  });
});
