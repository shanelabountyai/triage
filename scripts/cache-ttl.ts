// npm run cache:ttl — task 4.4 (D-60): the recorded 1h cache writes priced as 1h (what was billed, O-7) and as 5m, from usage fields.
// Counterfactual only: it moves cacheCreation1h tokens into cacheCreation5m and reprices; whether a 5m entry would have survived is the wall-clock facts below.
import { readFileSync } from 'node:fs';
import { costPico, type Prices } from '../src/pipeline/cost.js';
import { PICO_PER_CENT } from '../src/pipeline/num.js';
import type { Usage } from '../src/pipeline/parse.js';
import { readResults } from '../src/io/results.js';

const prices = JSON.parse(readFileSync('pricing/prices.v1.json', 'utf8')) as Prices;
// four decimals of a cent, integer arithmetic: the whole difference is a hundredth of a cent
const cents = (p: bigint) => { const t = p / (PICO_PER_CENT / 10000n); return `${t / 10000n}.${String(t % 10000n).padStart(4, '0')}¢`; };
for (const n of [1, 2]) {
  const meta = JSON.parse(readFileSync(`recordings/batch${n}/meta.json`, 'utf8'));
  let tot1h = 0n, tot5m = 0n, writes = 0;
  for (const tier of ['A', 'B']) {
    const { results } = readResults(`recordings/batch${n}/tier${tier}.jsonl`);
    let h1 = 0n, m5 = 0n, w = 0, reqs = 0;
    for (const r of results.values()) {
      if (!r.usage) continue;
      reqs++; w += r.usage.cacheCreation1h;
      const model = r.model ?? meta.models[tier];
      const u: Usage = r.usage, u5: Usage = { ...u, cacheCreation5m: u.cacheCreation5m + u.cacheCreation1h, cacheCreation1h: 0 };
      h1 += costPico(model, u, true, prices); m5 += costPico(model, u5, true, prices);
    }
    tot1h += h1; tot5m += m5; writes += w;
    const t = meta.tiers[tier];
    console.log(`batch ${n} tier ${tier}: ${reqs} requests with usage, 1h write tokens ${w}, batch wall time ${(Date.parse(t.completed_at) - Date.parse(t.submitted_at)) / 1000}s, cost as 1h ${cents(h1)} vs as 5m ${cents(m5)}`);
  }
  console.log(`batch ${n} total (tiers A+B incl. top-up lines): 1h ${cents(tot1h)}  5m ${cents(tot5m)}  difference ${cents(tot1h - tot5m)}  1h write tokens ${writes}`);
}
