import { describe, expect, it } from 'vitest';
import { parseTickets } from '../src/io/tickets.js';

describe('ticket intake', () => {
  it('returns one typed error per bad line and keeps the good ones', () => {
    const ok = (id: string) => JSON.stringify({ ticket_id: id, subject: 's', body: 'b' });
    const text = [
      ok('B1-0001'),
      '{not json',
      '[1]',
      JSON.stringify({ ticket_id: 'B1-0002', subject: 's' }),
      ok('has space'),
      ok('x'.repeat(65)),
      ok('B1-0001'),
      '',
      ok('x'.repeat(64)),
    ].join('\n');
    const { tickets, errors } = parseTickets(text);
    expect(tickets.map((t) => t.ticket_id)).toEqual(['B1-0001', 'x'.repeat(64)]);
    expect(errors.map((e) => [e.line, e.code])).toEqual([
      [2, 'INTAKE_JSON'], [3, 'INTAKE_JSON'], [4, 'INTAKE_FIELD'],
      [5, 'INTAKE_ID'], [6, 'INTAKE_ID'], [7, 'INTAKE_DUPLICATE_ID'],
    ]);
  });
});
