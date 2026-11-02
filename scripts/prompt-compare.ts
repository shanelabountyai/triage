// prompt:compare -- <recording dir> [<recording dir> ...] — task 4.2 (D-62): each recording's decisions.jsonl scored
// against fixtures/answer_key_batch1.csv (all, dev, test). Reads recordings only; spends nothing.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { score } from '../src/eval/prompt-compare.js';
import { picoToCents } from '../src/pipeline/num.js';
import type { DecisionRow } from '../src/pipeline/run.js';

const key = readFileSync('fixtures/answer_key_batch1.csv', 'utf8');
const policy = JSON.parse(readFileSync('routing/policy.v1.json', 'utf8'));
const f = ([a, b]: [number, number]) => `${a}/${b}`;
console.log('recording            split  n    nh-recall  P1-missed  delivered-cat  queued-misroute  of-which-OUTAGE/PRIVACY  OUTAGE  PRIVACY_DATA  cost');
for (const dir of process.argv.slice(2)) {
  const rows = readFileSync(join(dir, 'decisions.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as DecisionRow);
  for (const split of [undefined, 'dev', 'test']) {
    const s = score(rows, key, policy, split);
    console.log([dir.padEnd(20), (split ?? 'all').padEnd(5), String(s.n).padEnd(4), f(s.nhRecall).padEnd(10), f(s.p1Missed).padEnd(10), f(s.delivered).padEnd(14),
      f(s.queuedMisroute).padEnd(16), String(s.targetMisroute).padEnd(24), f(s.targetCat['OUTAGE']!).padEnd(7), f(s.targetCat['PRIVACY_DATA']!).padEnd(13), `${picoToCents(s.costPico)}¢`].join(' '));
  }
}
