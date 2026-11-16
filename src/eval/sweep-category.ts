// Task 4.1 (D-60): the escalation threshold swept per tier-A category, recorded results, answer key as judge.
// Escalation is per ticket (tier A's min confidence against T), so slicing the global sweep by tier A's category equals
// giving that category its own T. Eval-only code: it reads the answer key, src/pipeline/ never does.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Prices } from '../pipeline/cost.js';
import type { Policy } from '../pipeline/decide.js';
import { bps, fmtBps } from '../pipeline/num.js';
import { runTickets, type DecisionRow, type RunConfig } from '../pipeline/run.js';
import type { Schema } from '../pipeline/validate.js';
import { provider } from '../providers/index.js';
import { readTickets } from '../io/tickets.js';
import { parseCsv, per1k } from './report.js';

const sum = (xs: DecisionRow[]) => xs.reduce((s, r) => s + BigInt(r.cost_pico_batch), 0n);
const pct = (n: number, d: number) => fmtBps(bps(n, d));

/** Chosen on batch 1 dev: the categories whose recall dropped when T fell from 7500 to 6000 keep 7500, the rest take 6000. */
export const KEEP_7500 = ['ACCOUNT_ACCESS', 'INTEGRATION'];

export async function sweepByCategory(root = '.', Ts = [6000, 6500, 7000, 7500, 8000, 8500, 9000, 9500]) {
  const json = <T>(p: string): T => JSON.parse(readFileSync(join(root, p), 'utf8')) as T;
  const policy = json<Policy>('routing/policy.v1.json');
  const c: RunConfig = { policy, prices: json<Prices>('pricing/prices.v1.json'), schema: json<Schema>('schemas/triage.v1.json'), auditSeed: 20261019 };
  const p = provider('recorded', root);
  const out: string[] = [];
  for (const [n, splits] of [[1, ['dev', 'test']], [2, ['all']]] as const) {
    const inPath = join(root, `fixtures/tickets_batch${n}.jsonl`);
    const { tickets } = readTickets(inPath);
    const ra = await p('A', tickets, inPath), rb = await p('B', tickets, inPath);
    const key = new Map(parseCsv(readFileSync(join(root, `fixtures/answer_key_batch${n}.csv`), 'utf8')).map((k) => [k['ticket_id']!, k]));
    for (const split of splits) {
      const ids = new Set(tickets.filter((t) => split === 'all' || key.get(t.ticket_id)!['split'] === split).map((t) => t.ticket_id));
      out.push('', `== batch ${n}, ${split} split (${ids.size} tickets), recorded, answer key as judge ==`,
        '  category (tier A)      T    escalated   delivered-category-acc   human-queue   cents/1k');
      const perT = Ts.map((T) => {
        const at = { ...c, policy: { ...policy, escalate_to_tier_b_when: { ...policy.escalate_to_tier_b_when, min_confidence_bps_below: T } } };
        const { rows, tiers } = runTickets(tickets, ra, rb, at);
        return { T, rows: rows.filter((r) => ids.has(r.ticket_id)).map((r) => ({ r, cat: tiers.get(r.ticket_id)!.a.parsed?.category ?? '(A failed)' })) };
      });
      const mixed = perT.find((x) => x.T === 6000)!.rows.map((x, i) => (KEEP_7500.includes(x.cat) ? perT.find((y) => y.T === 7500)! : perT.find((y) => y.T === 6000)!).rows[i]!);
      perT.push({ T: -1, rows: mixed });
      const cats = [...new Set(perT[0]!.rows.map((x) => x.cat))].sort();
      for (const cat of [...cats, 'ALL'])
        for (const { T, rows } of perT) {
          const rs = rows.filter((x) => cat === 'ALL' || x.cat === cat).map((x) => x.r);
          const esc = rs.filter((r) => r.path.startsWith('A>B')), auto = rs.filter((r) => !r.needs_human);
          const unrec = esc.filter((r) => !rb.has(r.ticket_id)).length;
          const kn = (r: DecisionRow) => key.get(r.ticket_id)!;
          const need = rs.filter((r) => kn(r)['needs_human'] === 'true'), caught = need.filter((r) => r.needs_human).length;
          const p1 = rs.filter((r) => kn(r)['priority'] === 'P1'), p1miss = p1.filter((r) => !r.needs_human).length;
          const ok = auto.filter((r) => r.category === key.get(r.ticket_id)!['category']).length;
          out.push(`  ${cat.padEnd(20)} ${(T < 0 ? 'MIX' : String(T)).padEnd(5)} ${String(esc.length).padStart(4)} of ${String(rs.length).padStart(3)}   `
            + (unrec ? `n/a: ${unrec} escalated without a recorded tier-B line` : `${pct(ok, auto.length).padStart(7)} (${ok}/${auto.length})`.padEnd(24)
              + `${String(rs.length - auto.length).padStart(4)} (${pct(rs.length - auto.length, rs.length).padStart(7)})   ${`${caught}/${need.length}`.padEnd(8)}${`${p1miss}/${p1.length}`.padEnd(10)}${String(per1k(sum(rs), rs.length)).padStart(5)}`));
        }
    }
  }
  return out;
}
