// Content hash = sha256 of the file bytes, as triagelib.content_hash and `sha256sum` (D-26, D-28).
// Not Adjuster's canonical JSON: that hashes a re-serialisation, which `sha256sum` cannot reproduce.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const sha256File = (path: string): string =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

/** The five hashes recorded in the D-26 row of docs/decisions.md, keyed by repo-relative path. */
export function recordedHashes(decisionsPath = 'docs/decisions.md'): Record<string, string> {
  const row = readFileSync(decisionsPath, 'utf8').split('\n').find((l) => l.startsWith('| D-26 |'));
  if (!row) throw new Error('D-26 row not found in ' + decisionsPath);
  return Object.fromEntries([...row.matchAll(/`([\w./-]+)` `([0-9a-f]{64})`/g)].map((m) => [m[1]!, m[2]!]));
}
