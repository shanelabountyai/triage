// shane:pick — writes eval/labels/shane-30.json once from the first recording (D-24, task 2.10) and prints the tickets to read.
// Refuses to overwrite: the pick is frozen with the judgements. The eval reads the file; nothing in src/pipeline/ does.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseCsv } from '../src/eval/report.js';
import { pickShane30, SHANE30, type Shane30 } from '../src/eval/shane30.js';
import type { DecisionRow } from '../src/pipeline/run.js';

const SEED = 20261019;
if (existsSync(SHANE30)) { console.error(`${SHANE30} exists; the pick is frozen with its judgements (D-24)`); process.exit(1); }
const jsonl = <T>(p: string) => readFileSync(p, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as T);
const rows = jsonl<DecisionRow>('recordings/batch1/decisions.jsonl');
const byId = new Map(rows.map((r) => [r.ticket_id, r]));
const key = new Map(parseCsv(readFileSync('fixtures/answer_key_batch1.csv', 'utf8')).map((k) => [k['ticket_id']!, k]));
const tickets = new Map(jsonl<{ ticket_id: string; subject: string; body: string }>('fixtures/tickets_batch1.jsonl').map((t) => [t.ticket_id, t]));
const queue = rows.filter((r) => r.needs_human).length;
const picked = pickShane30(rows, SEED);

const fn = ['AMB-05', 'AMB-07'].map((template_id) => {
  const ids = [...key].filter(([id, k]) => k['template_id'] === template_id && k['needs_human'] === 'true' && !byId.get(id)!.needs_human).map(([id]) => id);
  const k = key.get(ids[0]!)!;
  return { template_id, ticket_ids: ids, body: tickets.get(ids[0]!)!.body, pipeline: { needs_human: false, category: byId.get(ids[0]!)!.category },
    key: { needs_human: true, category: k['category']! }, needs_human: null, category: null, note: '' };
});
const s: Shane30 = {
  picked_from: 'recordings/batch1/decisions.jsonl',
  pick: `30 of ${queue} human-queue tickets, first 30 by sha256('${SEED}:shane30:<ticket_id>')`,
  judged_on: null,
  tickets: picked.map((r) => ({ ticket_id: r.ticket_id, pipeline_reasons: r.reasons.filter((x) => x.startsWith('human:')), needs_human: null, agrees_with_pipeline_reason: null, labels_ok: null, note: '' })),
  false_negative_templates: fn,
};
mkdirSync(dirname(SHANE30), { recursive: true });
writeFileSync(SHANE30, JSON.stringify(s, null, 2) + '\n');
console.log(`wrote ${SHANE30}: ${s.pick}; false-negative templates ${fn.map((f) => `${f.template_id} (${f.ticket_ids.length})`).join(', ')}\n`);
for (const [i, r] of picked.entries()) {
  const t = tickets.get(r.ticket_id)!;
  console.log(`${i + 1}. ${r.ticket_id}  ${r.path}  ${r.category}/${r.priority} -> ${r.route}  min ${r.min_bps}  ${r.reasons.join(' ')}  flags ${r.flags.join(',') || '-'}\n   subject: ${t.subject}\n   ${t.body}\n`);
}
