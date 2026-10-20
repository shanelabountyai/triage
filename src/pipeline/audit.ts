// Reproducible audit sample (D-21): a share of auto-handled tickets a person re-labels, so the
// override rate says something about tickets nobody would otherwise read. Chosen per ticket by
// sha256(`${seed}:audit:${ticket_id}`), first 8 hex digits as an integer, mod 10000 < audit_sample_bps.
import { createHash } from 'node:crypto';
import { BPS } from './num.js';
import type { Policy } from './types.js';

export function auditSampled(policy: Policy, seed: number, ticketId: string): boolean {
  const h = BigInt('0x' + createHash('sha256').update(`${seed}:audit:${ticketId}`).digest('hex').slice(0, 8));
  return h % BPS < BigInt(policy.audit_sample_bps);
}

/** A ticket a person reads: everything in the human queue plus the audit sample of the rest. */
export const humanTouched = (policy: Policy, seed: number, ticketId: string, needsHuman: boolean): boolean =>
  needsHuman || auditSampled(policy, seed, ticketId);
