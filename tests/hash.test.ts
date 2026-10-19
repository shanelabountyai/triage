import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { recordedHashes, sha256File } from '../src/io/hash.js';

describe('content hash', () => {
  it('equals shasum -a 256 on routing/policy.v1.json', () => {
    const shell = execFileSync('shasum', ['-a', '256', 'routing/policy.v1.json'], { encoding: 'utf8' }).split(' ')[0];
    expect(sha256File('routing/policy.v1.json')).toBe(shell);
  });
  it('equals the five hashes recorded in D-26', () => {
    const rec = recordedHashes();
    expect(Object.keys(rec).sort()).toEqual([
      'monitoring/drift.v1.json', 'pricing/prices.v1.json', 'prompts/classify.v1.md',
      'routing/policy.v1.json', 'schemas/triage.v1.json',
    ]);
    for (const [path, hash] of Object.entries(rec)) expect(sha256File(path), path).toBe(hash);
  });
});
