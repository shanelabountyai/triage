// npm run privacy:tier — task 4.3 (D-60): a projection, no third tier built. For the tickets whose final category is
// PRIVACY_DATA, what an Opus 5.5 answer would cost at tier B's recorded token counts, and what it could change.
import { readFileSync } from 'node:fs';
import { costPico, type Prices } from '../src/pipeline/cost.js';
import { PICO_PER_CENT, roundHalfUp } from '../src/pipeline/num.js';
import type { DecisionRow } from '../src/pipeline/run.js';
import { readResults } from '../src/io/results.js';

const prices = JSON.parse(readFileSync('pricing/prices.v1.json', 'utf8')) as Prices;
const c2 = (p: bigint) => `${roundHalfUp(p * 100n, PICO_PER_CENT) / 100n}.${String(roundHalfUp(p * 100n, PICO_PER_CENT) % 100n).padStart(2, '0')}¢`;
for (const n of [1, 2]) {
  const rows = readFileSync(`recordings/batch${n}/decisions.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as DecisionRow);
  const { results: rb } = readResults(`recordings/batch${n}/tierB.jsonl`);
  const priv = rows.filter((r) => r.category === 'PRIVACY_DATA');
  const viaB = priv.filter((r) => r.path.startsWith('A>B'));
  let sonnet = 0n, opus = 0n;
  for (const r of viaB) { const u = rb.get(r.ticket_id)?.usage; if (u) { sonnet += costPico('claude-sonnet-5-5', u, true, prices); opus += costPico('claude-opus-5-5', u, true, prices); } }
  console.log(`batch ${n}: ${rows.length} tickets; final category PRIVACY_DATA ${priv.length} (${viaB.length} went A>B); needs_human on those ${priv.filter((r) => r.needs_human).length}/${priv.length}; `
    + `tier-B cost on them as Sonnet ${c2(sonnet)} → as Opus ${c2(opus)}, +${c2(opus - sonnet)} on the batch = +${c2((opus - sonnet) * 1000n / BigInt(rows.length))} per 1,000 tickets`);
}
