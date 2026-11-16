// Content hashes (src/io/hash.ts, src/io/lint.ts hashErrors): the TypeScript sha256 over file bytes
// equals the oracle's content_hash, the brief §12 table and MANIFEST.json for every frozen fixture,
// and the D-26 reader fails loudly rather than quietly checking fewer files.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { recordedHashes, sha256File } from '../src/io/hash.js';
import { hashErrors } from '../src/io/lint.js';

const briefTable = (): Record<string, string> => Object.fromEntries(
  [...readFileSync('docs/domain-brief.md', 'utf8').matchAll(/^\| (\w+\.(?:jsonl|csv))[^|]*\| \d+ \| `([0-9a-f]{64})` \|$/gm)].map((m) => [m[1]!, m[2]!]),
);

describe('fixture hashes', () => {
  it('all ten fixtures hash to the brief §12 table', () => {
    const table = briefTable();
    expect(Object.keys(table)).toHaveLength(10);
    for (const [f, h] of Object.entries(table)) expect(sha256File(`fixtures/${f}`), f).toBe(h);
  });

  it('MANIFEST.json sha256 entries agree with the brief §12 table', () => {
    const m = JSON.parse(readFileSync('fixtures/MANIFEST.json', 'utf8')).sha256 as Record<string, string>;
    const table = briefTable();
    for (const [f, h] of Object.entries(m)) expect(table[f], f).toBe(h);
  });

  it('equals triagelib.content_hash for the five data files', () => {
    const files = Object.keys(recordedHashes());
    const py = `import json,sys
sys.path.insert(0,'tools')
from triagelib import content_hash
print(json.dumps({f: content_hash(f) for f in json.load(sys.stdin)}))`;
    const oracle = JSON.parse(execFileSync('python3', ['-c', py], { input: JSON.stringify(files), encoding: 'utf8' }));
    expect(Object.fromEntries(files.map((f) => [f, sha256File(f)]))).toEqual(oracle);
  });

  it('hashes bytes, not text: a CRLF copy of the prompt hashes differently', () => {
    const dir = mkdtempSync(join(tmpdir(), 'triage-hash-'));
    const p = join(dir, 'p.md');
    writeFileSync(p, readFileSync('prompts/classify.v1.md', 'utf8').replace(/\n/g, '\r\n'));
    expect(sha256File(p)).not.toBe(sha256File('prompts/classify.v1.md'));
    writeFileSync(p, '');
    expect(sha256File(p)).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('D-26 reader', () => {
  const copy = () => {
    const root = mkdtempSync(join(tmpdir(), 'triage-d26-'));
    for (const d of ['routing', 'monitoring', 'pricing', 'schemas', 'prompts', 'docs']) cpSync(d, join(root, d), { recursive: true });
    return root;
  };

  it('throws when the D-26 row is gone instead of checking nothing', () => {
    const root = copy();
    const p = join(root, 'docs/decisions.md');
    writeFileSync(p, readFileSync(p, 'utf8').replace('| D-26 |', '| D-26x |'));
    expect(() => hashErrors(root)).toThrow(/D-26 row not found/);
  });

  it('reports each changed file by path, one line per file', () => {
    const root = copy();
    for (const f of ['prompts/classify.v1.md', 'pricing/prices.v1.json']) writeFileSync(join(root, f), readFileSync(f, 'utf8') + ' ');
    const errs = hashErrors(root);
    expect(errs.map((e) => e.split(' ')[0]).sort()).toEqual(['pricing/prices.v1.json', 'prompts/classify.v1.md']);
  });
});
