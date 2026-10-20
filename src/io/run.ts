// One run (brief §4): intake → provider tier A → escalation → provider tier B → the pure pipeline
// → decisions.jsonl and run.json in the out directory, and a row appended to the ledger.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decideBatch, escalatedIds } from '../pipeline/batch.js';
import { decisionRow, runTotals, type DecisionRow } from '../pipeline/record.js';
import type { Provider } from '../providers/index.js';
import { appendRun, DEFAULT_LEDGER, type LedgerRow } from './ledger.js';
import { loadPolicyData } from './load.js';
import { parseTickets, type IntakeError } from './tickets.js';

export const DEFAULT_AUDIT_SEED = 20261019; // the fixture seed; D-21's sample is reproducible from it

export interface RunOptions {
  input: string;
  provider: Provider;
  out: string;
  ledger?: string;
  auditSeed?: number;
  /** Injected clock (ISO strings), so a test can pin the times; scripts pass the wall clock. */
  now: () => string;
  root?: string;
}

export interface RunResult { row: LedgerRow; decisions: DecisionRow[]; intakeErrors: IntakeError[] }

export async function runOnce(o: RunOptions): Promise<RunResult> {
  const started = o.now();
  const { data, hashes } = loadPolicyData(o.root ?? '.');
  if (existsSync(o.out) && readdirSync(o.out).length) throw new Error(`out directory ${o.out} is not empty; a run never overwrites another`);
  const bytes = readFileSync(o.input);
  const { tickets, errors } = parseTickets(bytes.toString('utf8'));
  const ids = tickets.map((t) => t.ticket_id);
  const linesA = await o.provider.results('A', ids);
  const linesB = await o.provider.results('B', escalatedIds(data, tickets, linesA));
  const outcomes = decideBatch(data, tickets, linesA, linesB);
  const auditSeed = o.auditSeed ?? DEFAULT_AUDIT_SEED;
  const decisions = outcomes.map((x) => decisionRow(data.policy, auditSeed, x));
  const inputSha = createHash('sha256').update(bytes).digest('hex');
  const finished = o.now();
  const row: LedgerRow = {
    run_id: `run-${started.replace(/[-:.]/g, '')}-${o.provider.name}-${inputSha.slice(0, 8)}`,
    provider: o.provider.name,
    input: o.input, input_sha256: inputSha, intake_errors: errors.length,
    models: { A: data.policy.tiers.A.model, B: data.policy.tiers.B.model },
    hashes, threshold_bps: data.policy.escalate_to_tier_b_when.min_confidence_bps_below, audit_seed: auditSeed,
    results_source: { A: o.provider.source('A'), B: o.provider.source('B') },
    ...runTotals(outcomes),
    cap_status: 'n/a',
    started_at: started, finished_at: finished,
    submitted_at: null, completed_at: null, latency_s_p50: null, latency_s_p95: null,
  };
  mkdirSync(o.out, { recursive: true });
  writeFileSync(join(o.out, 'decisions.jsonl'), decisions.map((d) => JSON.stringify(d)).join('\n') + '\n');
  if (errors.length) writeFileSync(join(o.out, 'intake_errors.jsonl'), errors.map((e) => JSON.stringify(e)).join('\n') + '\n');
  writeFileSync(join(o.out, 'run.json'), JSON.stringify(row, null, 2) + '\n');
  appendRun(row, o.ledger ?? DEFAULT_LEDGER);
  return { row, decisions, intakeErrors: errors };
}

/** A run directory written by runOnce: its ledger row and its decisions. */
export function readRunDir(dir: string): { row: LedgerRow; decisions: DecisionRow[] } {
  const row = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')) as LedgerRow;
  const decisions = readFileSync(join(dir, 'decisions.jsonl'), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as DecisionRow);
  return { row, decisions };
}
