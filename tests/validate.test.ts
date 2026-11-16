// The closed-subset validator (src/pipeline/validate.ts) against the committed data files and schema,
// and the prototype-key hole: a key that names an Object.prototype member is still an extra key.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DRIFT_SCHEMA, POLICY_SCHEMA, PRICES_SCHEMA } from '../src/pipeline/contracts.js';
import { schemaErrors, validate, type Schema } from '../src/pipeline/validate.js';

const read = (p: string): any => JSON.parse(readFileSync(p, 'utf8'));
const closed: Schema = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false };

describe('validate: prototype-named keys are extra keys', () => {
  for (const k of ['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__']) {
    it(`refuses an extra "${k}" under additionalProperties: false`, () => {
      const v = JSON.parse(`{"a":"x","${k}":1}`);
      expect(validate(v, closed)).toEqual([`$.${k}: not allowed`]);
    });
  }

  it('validates a prototype-named extra key against an additionalProperties schema', () => {
    const map: Schema = { type: 'object', additionalProperties: { type: 'string' } };
    expect(validate(JSON.parse('{"constructor":1}'), map)).toEqual(['$.constructor: expected string']);
    expect(validate(JSON.parse('{"constructor":"ok"}'), map)).toEqual([]);
  });

  it('reports a missing required key even when the value has prototype-named keys', () => {
    expect(validate(JSON.parse('{"toString":"x"}'), closed)).toEqual(['$.a: required', '$.toString: not allowed']);
  });

  it('catches a prototype-named key misspelt into the committed policy', () => {
    const p = read('routing/policy.v1.json');
    p.tiers.A.constructor = 'x';
    expect(validate(p, POLICY_SCHEMA)).toEqual(['$.tiers.A.constructor: not allowed']);
  });
});

describe('validate: committed data files', () => {
  it('the three policy files match their contracts and the output schema uses only the subset', () => {
    expect(validate(read('routing/policy.v1.json'), POLICY_SCHEMA)).toEqual([]);
    expect(validate(read('monitoring/drift.v1.json'), DRIFT_SCHEMA)).toEqual([]);
    expect(validate(read('pricing/prices.v1.json'), PRICES_SCHEMA)).toEqual([]);
    expect(schemaErrors(read('schemas/triage.v1.json'))).toEqual([]);
  });

  it('every contract is itself in the subset', () => {
    for (const s of [POLICY_SCHEMA, DRIFT_SCHEMA, PRICES_SCHEMA]) expect(schemaErrors(s)).toEqual([]);
  });

  it('refuses a drift signal kind outside the enum and a missing signal id', () => {
    const d = read('monitoring/drift.v1.json');
    d.signals[0].kind = 'ratio';
    delete d.signals[1].id;
    expect(validate(d, DRIFT_SCHEMA)).toEqual([
      '$.signals[0].kind: "ratio" not in [distance, delta, absolute]',
      '$.signals[1].id: required',
    ]);
  });

  it('refuses a float price and a non-integer batch multiplier', () => {
    const p = read('pricing/prices.v1.json');
    const model = Object.keys(p.models)[0]!;
    p.models[model].input = 1.5;
    p.batch_multiplier.den = '2';
    expect(validate(p, PRICES_SCHEMA).sort()).toEqual([
      '$.batch_multiplier.den: expected integer, got "2"',
      `$.models.${model}.input: expected integer, got 1.5`,
    ]);
  });

  it('a valid model output passes the triage schema; an unsafe integer and a null do not', () => {
    const schema = read('schemas/triage.v1.json') as Schema;
    const ok = {
      category: 'BILLING', category_confidence_bps: 9000, priority: 'P3', priority_confidence_bps: 8000,
      needs_human: false, needs_human_confidence_bps: 9500, language: 'en', secondary_category: 'NONE', reason: 'charged twice',
    };
    expect(validate(ok, schema)).toEqual([]);
    expect(validate({ ...ok, category_confidence_bps: 2 ** 53 }, schema)).toEqual([
      '$.category_confidence_bps: expected integer, got 9007199254740992',
    ]);
    expect(validate({ ...ok, reason: null }, schema)).toEqual(['$.reason: expected string']);
  });
});
