// Run ledger (brief §4 step 9, PRD): append-only JSONL under data/ (gitignored). One row per run;
// a run id appears once. A correction is a new run, never an edit.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ProviderName } from '../providers/index.js';
import type { RunTotals } from '../pipeline/record.js';
import type { Hashes } from './load.js';

export const DEFAULT_LEDGER = 'data/runs.jsonl';

export interface LedgerRow extends RunTotals {
  run_id: string;
  provider: ProviderName;
  input: string; input_sha256: string; intake_errors: number;
  models: { A: string; B: string };
  /** Content hashes of the five policy files (D-26), equal to policy:lint's. */
  hashes: Hashes;
  threshold_bps: number;
  audit_seed: number;
  results_source: { A: string; B: string };
  /** Hard caps apply to live runs only (D-19); a replay spends nothing. */
  cap_status: 'n/a' | 'ok' | 'OVER_CAP';
  started_at: string; finished_at: string;
  /** O-10: Batches submit-to-result latency, integer seconds; null for replays (no batch was submitted). */
  submitted_at: string | null; completed_at: string | null;
  latency_s_p50: number | null; latency_s_p95: number | null;
}

export function readLedger(path = DEFAULT_LEDGER): LedgerRow[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as LedgerRow);
}

export function appendRun(row: LedgerRow, path = DEFAULT_LEDGER): void {
  if (readLedger(path).some((r) => r.run_id === row.run_id)) throw new Error(`ledger ${path} already has run ${row.run_id}`);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(row) + '\n');
}
