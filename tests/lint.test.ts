import { cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dataErrors, hashErrors, pipelineErrors, sourceErrors } from '../src/io/lint.js';
import { POLICY_SCHEMA } from '../src/pipeline/contracts.js';
import { schemaErrors, validate } from '../src/pipeline/validate.js';

const policy = () => JSON.parse(readFileSync('routing/policy.v1.json', 'utf8'));

describe('policy:lint', () => {
  it('is clean on the repo', () => {
    expect([...dataErrors(), ...hashErrors(), ...pipelineErrors()]).toEqual([]);
  });

  it('fails the hash check when one byte of a copy of the policy changes', () => {
    const root = mkdtempSync(join(tmpdir(), 'triage-lint-'));
    for (const d of ['routing', 'monitoring', 'pricing', 'schemas', 'prompts', 'docs']) cpSync(d, join(root, d), { recursive: true });
    expect(hashErrors(root)).toEqual([]);
    const p = join(root, 'routing/policy.v1.json');
    const bytes = readFileSync(p);
    bytes[bytes.indexOf('7500')] = '8'.charCodeAt(0); // 7500 → 8500
    writeFileSync(p, bytes);
    const errs = hashErrors(root);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/^routing\/policy\.v1\.json sha256 /);
  });

  it('reports a missing key, an extra key, a float and a wrong type in the policy', () => {
    const p = policy();
    delete p.audit_sample_bps;
    p.audit_sampel_bps = 1000;
    p.escalate_to_tier_b_when.min_confidence_bps_below = 0.75;
    p.needs_human_when.screen_flagged = 'yes';
    expect(validate(p, POLICY_SCHEMA).sort()).toEqual([
      '$.audit_sampel_bps: not allowed',
      '$.audit_sample_bps: required',
      '$.escalate_to_tier_b_when.min_confidence_bps_below: expected integer, got 0.75',
      '$.needs_human_when.screen_flagged: expected boolean',
    ]);
  });

  it('checks enum, array items and map values', () => {
    expect(validate('x', { type: 'string', enum: ['A'] })).toEqual(['$: "x" not in [A]']);
    expect(validate([1, 'a'], { type: 'array', items: { type: 'integer' } })).toEqual(['$[1]: expected integer, got "a"']);
    expect(validate({ a: 'X', b: 2 }, { type: 'object', additionalProperties: { type: 'string' } })).toEqual(['$.b: expected string']);
  });

  it('refuses a schema keyword outside the subset', () => {
    expect(schemaErrors({ type: 'integer', minimum: 0 })).toEqual(['#: unsupported keyword minimum']);
    expect(schemaErrors({ type: 'object', properties: {}, required: ['a'] })).toEqual(['#: required a has no property']);
  });

  it('flags forbidden calls and float arithmetic under src/pipeline/', () => {
    const src = [
      "import { readFileSync } from 'node:fs';",
      'const a = Date.now() / 2;',
      'const b = Math.floor(1.5) + 2e3;',
      'const c = (x: number) => x.toFixed(2);',
      'const re = /a\\/b/; const h = 0xEE;',
    ].join('\n');
    expect(sourceErrors('src/pipeline/x.ts', src)).toEqual([
      "src/pipeline/x.ts:1 forbidden 'node:fs'",
      'src/pipeline/x.ts:2 forbidden Date.now',
      'src/pipeline/x.ts:2 division outside num.ts',
      'src/pipeline/x.ts:3 float op Math.floor',
      'src/pipeline/x.ts:3 float literal 1.5',
      'src/pipeline/x.ts:3 float literal 2e3',
      'src/pipeline/x.ts:4 float op toFixed',
    ]);
    expect(sourceErrors('src/pipeline/num.ts', 'const q = 2n / 3n;')).toEqual([]);
  });
});

// Task 2.1 (D-41): the SDK is a runtime dependency now, and the only place it may be imported is src/providers/.
const specifiers = (dir: string): [string, string][] =>
  readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.ts'))
    .flatMap((f) => [...readFileSync(join(dir, f), 'utf8').matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m): [string, string] => [join(dir, f), m[1]!]));

describe('import boundary', () => {
  it('src/pipeline/ imports only its own files and node:crypto', () => {
    expect(specifiers('src/pipeline').filter(([, s]) => !s.startsWith('./') && s !== 'node:crypto')).toEqual([]);
  });

  it('@anthropic-ai/sdk is imported only under src/providers/', () => {
    const outside = ['src', 'scripts', 'tests'].flatMap(specifiers)
      .filter(([f, s]) => s.startsWith('@anthropic-ai/') && !f.startsWith('src/providers/'));
    expect(outside).toEqual([]);
  });
});
