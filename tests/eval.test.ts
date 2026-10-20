import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decisionDiffs, evalReport, withThreshold } from '../src/eval/report.js';
import { loadPolicyData } from '../src/io/load.js';
import { eceBps, prf } from '../src/pipeline/evalmath.js';

const { data, hashes } = loadPolicyData();

describe('eval goldens (brief §10, tools/golden_answers.py)', () => {
  it('GE-01 prf(90, 10, 30)', () => expect(prf(90, 10, 30)).toEqual([9000, 7500, 8182]));
  it('GE-02 prf undefined is 0', () => expect(prf(0, 0, 0)).toEqual([0, 0, 0]));
  it('GE-03 ECE = 500 bps', () => expect(eceBps([...Array<[number, boolean]>(4).fill([9500, true]), [5500, true], [5500, false]])).toBe(500));
  it('ECE puts 10000 in the last bin and an edge value in the upper bin', () => {
    expect(eceBps([[10000, true]])).toBe(0);
    expect(eceBps([[1000, false]])).toBe(1000);
    expect(eceBps([])).toBe(0);
  });
});

describe('triage:eval', () => {
  const { lines, runs } = evalReport({ data, hashes, fixtures: 'fixtures', results: 'scripted', seed: 20261019 });

  it('prints fixtures/samples/reference_pipeline.output.txt line for line, header hashes included', () => {
    expect(lines).toEqual(readFileSync('fixtures/samples/reference_pipeline.output.txt', 'utf8').replace(/\n$/, '').split('\n'));
  });

  it('header hashes are the D-26 hashes policy:lint checks', () => {
    expect(lines[1]).toBe(`policy sha256 ${hashes.policy.slice(0, 12)}  drift ${hashes.drift.slice(0, 12)}  prices ${hashes.prices.slice(0, 12)}  prompt ${hashes.prompt.slice(0, 12)}  schema ${hashes.schema.slice(0, 12)}`);
  });

  it('every per-ticket decision equals fixtures/decisions_batch{1,2}.csv on all 15 columns', () => {
    expect(decisionDiffs('fixtures', runs)).toEqual([]);
  });

  it('a policy change shows up as per-ticket differences (the gate can go red)', () => {
    const changed = evalReport({ data: withThreshold(data, 7000), hashes, fixtures: 'fixtures', results: 'scripted', seed: 20261019 });
    expect(decisionDiffs('fixtures', changed.runs).length).toBeGreaterThan(0);
  });
});
