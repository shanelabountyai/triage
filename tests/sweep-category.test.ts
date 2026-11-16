import { expect, test } from 'vitest';
import { sweepByCategory } from '../src/eval/sweep-category.js';

// 4.1 acceptance: the global T=7500 row reproduces the recorded baseline (D-51/EVAL); the mixed row is the dev-chosen proposal.
test('sweep by category: ALL at T=7500 equals the baseline, MIX keeps recall', async () => {
  const out = (await sweepByCategory()).join('\n');
  const row = (k: string, i: number) => out.split('\n').filter((l) => l.startsWith(`  ALL ${' '.repeat(16)} ${k}`))[i]!;
  expect(row('7500', 0)).toContain('95.69% (222/232)');
  expect(row('7500', 1)).toContain('96.23% (153/159)');
  expect(row('7500', 2)).toContain('96.45% (190/197)');
  for (const [i, r] of ['122/122', '81/81', '217/217'].entries()) expect(row('MIX', i)).toContain(r);
});
