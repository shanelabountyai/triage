// The two D-19 caps over the run ledger (task 2.3). The projection refuses before a submit; the ledger refuses late:
// a live run whose real cost broke a cap is marked OVER_CAP, and live runs stay refused until one acknowledges it.
// No flag removes a cap; a higher cap is a config change recorded in docs/decisions.md.
import { existsSync, readFileSync } from 'node:fs';
import { PICO_PER_CENT } from '../pipeline/num.js';

export interface Caps { runCents: number; projectCents: number }

export function capsFromEnv(env: Record<string, string | undefined>): Caps {
  const cents = (k: string, d: number) => {
    const v = env[k];
    if (v === undefined || v === '') return d;
    if (!/^\d+$/.test(v)) throw new Error(`CAP_INVALID: ${k}=${JSON.stringify(v)} is not whole cents; nothing was sent`);
    return Number(v);
  };
  return { runCents: cents('TRIAGE_RUN_CAP_CENTS', 400), projectCents: cents('TRIAGE_PROJECT_CAP_CENTS', 1500) };
}

interface LedgerRow { run_id: string; provider: string; cost_pico_batch: string; cost_pico_standard?: string; cap_status: string; acknowledges?: string[] }

/** The providers whose rows are money: `live` (Batches, batch prices) and `messages` (task 3.5, standard prices). */
export const spends = (r: { provider: string }): boolean => r.provider === 'live' || r.provider === 'messages';

/** What a row was billed: batch pico for a Batches run, standard pico for a `messages` call; a replay's notional cost is 0 here. */
export const billedPico = (r: Pick<LedgerRow, 'provider' | 'cost_pico_batch' | 'cost_pico_standard'>): bigint =>
  r.provider === 'live' ? BigInt(r.cost_pico_batch) : r.provider === 'messages' ? BigInt(r.cost_pico_standard ?? '0') : 0n;

/** Live spend over the whole ledger (replays spend nothing, whatever their notional cost) and the unacknowledged OVER_CAP runs. */
export function ledgerState(path: string): { livePico: bigint; overCap: string[] } {
  const rows: LedgerRow[] = existsSync(path)
    ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as LedgerRow) : [];
  const acked = new Set(rows.flatMap((r) => r.acknowledges ?? []));
  return {
    livePico: rows.reduce((s, r) => s + billedPico(r), 0n),
    overCap: rows.filter((r) => r.cap_status === 'OVER_CAP' && !acked.has(r.run_id)).map((r) => r.run_id),
  };
}

/** What is left under both caps, given the ledger's live spend and what this run has already spent. Can be negative. */
export const headroomPico = (c: Caps, ledgerPico: bigint, runPico: bigint): bigint => {
  const run = BigInt(c.runCents) * PICO_PER_CENT - runPico;
  const project = BigInt(c.projectCents) * PICO_PER_CENT - ledgerPico - runPico;
  return run < project ? run : project;
};
