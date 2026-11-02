// Task 4.2 (D-62): the scorer reproduces the recorded batch 1 baseline (EVAL.md) before it judges a v2 recording.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { score } from '../src/eval/prompt-compare.js';
import type { DecisionRow } from '../src/pipeline/run.js';

const rows = readFileSync('recordings/batch1/decisions.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l) as DecisionRow);
const key = readFileSync('fixtures/answer_key_batch1.csv', 'utf8');
const policy = JSON.parse(readFileSync('routing/policy.v1.json', 'utf8'));

describe('prompt:compare', () => {
  it('v1 batch 1 recording: the baseline numbers', () => {
    expect(score(rows, key, policy)).toMatchObject({ n: 700, nhRecall: [203, 203], p1Missed: [0, 42], delivered: [375, 391],
      queuedMisroute: [48, 309], targetMisroute: 12, targetCat: { OUTAGE: [13, 22], PRIVACY_DATA: [15, 24] } });
    expect(score(rows, key, policy, 'test')).toMatchObject({ n: 281, nhRecall: [81, 81], p1Missed: [0, 15], delivered: [153, 159], targetMisroute: 7 });
  });
});
