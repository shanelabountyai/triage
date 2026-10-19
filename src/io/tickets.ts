// Ticket intake (brief §4 step 1). One typed error per bad line; a bad line never stops the rest.
// ticket_id becomes the batch custom_id, so it is checked against the D-9 rule here.
import { readFileSync } from 'node:fs';

export interface Ticket {
  ticket_id: string;
  subject: string;
  body: string;
  [field: string]: unknown;
}

export type IntakeCode = 'INTAKE_JSON' | 'INTAKE_FIELD' | 'INTAKE_ID' | 'INTAKE_DUPLICATE_ID';
export interface IntakeError { line: number; code: IntakeCode; detail: string }

export const CUSTOM_ID = /^[a-zA-Z0-9_-]{1,64}$/;

export function parseTickets(text: string): { tickets: Ticket[]; errors: IntakeError[] } {
  const tickets: Ticket[] = [];
  const errors: IntakeError[] = [];
  const seen = new Set<string>();
  text.split('\n').forEach((raw, i) => {
    const line = i + 1;
    if (raw.trim() === '') return;
    let o: unknown;
    try {
      o = JSON.parse(raw);
    } catch (e) {
      errors.push({ line, code: 'INTAKE_JSON', detail: (e as Error).message });
      return;
    }
    if (typeof o !== 'object' || o === null || Array.isArray(o)) {
      errors.push({ line, code: 'INTAKE_JSON', detail: 'not an object' });
      return;
    }
    const r = o as Record<string, unknown>;
    const missing = ['ticket_id', 'subject', 'body'].filter((k) => typeof r[k] !== 'string');
    if (missing.length) {
      errors.push({ line, code: 'INTAKE_FIELD', detail: 'missing or non-string: ' + missing.join(', ') });
      return;
    }
    const id = r['ticket_id'] as string;
    if (!CUSTOM_ID.test(id)) {
      errors.push({ line, code: 'INTAKE_ID', detail: `ticket_id ${JSON.stringify(id)} fails ${CUSTOM_ID.source}` });
      return;
    }
    if (seen.has(id)) {
      errors.push({ line, code: 'INTAKE_DUPLICATE_ID', detail: id });
      return;
    }
    seen.add(id);
    tickets.push(r as Ticket);
  });
  return { tickets, errors };
}

export const readTickets = (path: string) => parseTickets(readFileSync(path, 'utf8'));
