// ledger:show (task 3.1, D-53): data/runs.jsonl as a table, and one run's decisions.jsonl summarized. A view over the
// existing readers, no new state. Adapted from opsagent src/opsagent/ledger.py `spend` (a per-run spend view over an
// append-only log); integer cents here, and the totals line is the same sum the project cap uses (`ledgerState`).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { per1k } from '../eval/report.js';
import { bps, fmtBps, picoToCents } from '../pipeline/num.js';
import type { DecisionRow } from '../pipeline/run.js';
import { ledgerState } from './caps.js';

export interface LedgerRow {
  run_id: string; provider: string; input: string; input_sha256: string; out: string | null; topup_of?: string;
  models: { A: string; B: string }; hashes: Record<string, string>; tickets: number; cost_pico_batch: string; cost_cents: number;
  cap_status: string; error?: string; latency_s_p50: number | null; latency_s_p95: number | null;
}

const HASH_FILES = ['routing/policy.v1.json', 'monitoring/drift.v1.json', 'pricing/prices.v1.json', 'schemas/triage.v1.json', 'prompts/classify.v1.md'];

export const readLedger = (path: string): LedgerRow[] =>
  existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as LedgerRow) : [];

/** The ledger as printed lines: one per run, then a totals line that reconciles to `ledgerState` (what the project cap reads). */
export function ledgerTable(path: string): string[] {
  const rows = readLedger(path);
  const w = { id: Math.max(6, ...rows.map((r) => r.run_id.length)), models: Math.max(14, ...rows.map((r) => `${r.models.A} / ${r.models.B}`.length)) };
  const lat = (r: LedgerRow) => (r.latency_s_p50 === null ? 'n/a' : `${r.latency_s_p50}/${r.latency_s_p95}`);
  const live = rows.filter((r) => r.provider === 'live');
  return [
    `${'run id'.padEnd(w.id)}  ${'provider'.padEnd(8)}  ${'models (A / B)'.padEnd(w.models)}  tickets  cents  ${'cap'.padEnd(10)}  ${'p50/p95 s'.padEnd(9)}  ${HASH_FILES.map((f) => f.split('/')[1]!.split('.')[0]!.padEnd(8)).join(' ')}`,
    ...rows.map((r) => `${r.run_id.padEnd(w.id)}  ${r.provider.padEnd(8)}  ${`${r.models.A} / ${r.models.B}`.padEnd(w.models)}  ${String(r.tickets).padStart(7)}  ${String(picoToCents(BigInt(r.cost_pico_batch))).padStart(5)}  ${r.cap_status.padEnd(10)}  ${lat(r).padEnd(9)}  ${HASH_FILES.map((f) => (r.hashes[f] ?? '').slice(0, 8).padEnd(8)).join(' ')}`),
    `${rows.length} runs · live spend ${picoToCents(ledgerState(path).livePico)}¢ over ${live.length} live rows (pico sum, what the project cap reads) · ${rows.length - live.length} replay rows spend nothing`,
  ];
}

/** One run: its paths and, from its decisions.jsonl, path counts, queue share, failures by code and cents per 1,000. */
export function runDetail(path: string, runId: string): string[] {
  const r = readLedger(path).find((x) => x.run_id === runId);
  if (!r) throw new Error(`LEDGER_UNKNOWN_RUN:${runId} (not in ${path})`);
  const lines = [
    `run ${r.run_id} (${r.provider}${r.topup_of ? `, tier-B top-up of ${r.topup_of}` : ''}) cap ${r.cap_status}${r.error ? ` · ${r.error}` : ''}`,
    `  input: ${r.input} (sha256 ${r.input_sha256.slice(0, 8)}…)`,
    `  out:   ${r.out ?? 'none'}`,
  ];
  const file = r.out === null ? null : join(r.out, 'decisions.jsonl');
  if (file === null) return [...lines, `  decisions: none (a top-up appends tier-B lines to its recording and takes no decisions)`];
  if (!existsSync(file)) return [...lines, `  decisions: ${file} not found`];
  const d = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as DecisionRow);
  const count = (xs: string[]) => [...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())];
  const queue = d.filter((x) => x.needs_human).length;
  const failures = count(d.flatMap((x) => x.flags.filter((f) => f.startsWith('FINAL_TIER_FAILED:'))));
  const pico = d.reduce((s, x) => s + BigInt(x.cost_pico_batch), 0n);
  return [
    ...lines,
    `  decisions: ${d.length} rows from ${file}`,
    `  paths: ${count(d.map((x) => x.path)).map(([k, n]) => `${k} ${n}`).join(' · ')}`,
    `  human queue: ${queue} of ${d.length} (${fmtBps(bps(queue, d.length))})`,
    `  failures: ${failures.length ? failures.map(([k, n]) => `${k} ${n}`).join(' · ') : 'none'}`,
    `  cost: ${picoToCents(pico)}¢ over ${d.length} decisions at batch prices (ledger row ${picoToCents(BigInt(r.cost_pico_batch))}¢), ${per1k(pico, d.length)}¢ per 1,000 tickets`,
  ];
}
