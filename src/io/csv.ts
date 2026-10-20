// Minimal CSV for the fixture files (answer keys, reference decisions), matching Python's csv
// module defaults: comma, double-quote quoting, "" for a literal quote, quoted newlines allowed.
// Only the eval and the tests read these files; product code never reads an answer key (non-negotiable 10).
import { readFileSync } from 'node:fs';

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const endField = () => {
    row.push(field);
    field = '';
  };
  while (i < text.length) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (c === '"') quoted = false;
      else field += c;
      i += 1;
      continue;
    }
    if (c === '"' && field === '') quoted = true;
    else if (c === ',') endField();
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      endField();
      rows.push(row);
      row = [];
    } else field += c;
    i += 1;
  }
  if (quoted) throw new Error('csv: unterminated quote');
  if (field !== '' || row.length) {
    endField();
    rows.push(row);
  }
  const [header, ...body] = rows;
  if (!header) return [];
  return body.map((r, n) => {
    if (r.length !== header.length) throw new Error(`csv: row ${n + 2} has ${r.length} fields, header has ${header.length}`);
    return Object.fromEntries(header.map((h, j) => [h, r[j]!]));
  });
}

export const readCsv = (path: string) => parseCsv(readFileSync(path, 'utf8'));

/** One field as Python's csv.writer writes it (QUOTE_MINIMAL). */
export const csvField = (v: string): string => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
