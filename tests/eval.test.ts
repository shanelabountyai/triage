import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evalReport, parseCsv } from '../src/eval/report.js';
import { recordedHashes } from '../src/io/hash.js';
import type { Policy } from '../src/pipeline/decide.js';
import { routeFor } from '../src/pipeline/decide.js';
import { eceBps, prf } from '../src/pipeline/evalmath.js';
import { fmtBps } from '../src/pipeline/num.js';

const policy = JSON.parse(readFileSync('routing/policy.v1.json', 'utf8')) as Policy;

describe('eval goldens (GE)', () => {
  it('GE-01 prf', () => expect(prf(90, 10, 30)).toEqual([9000, 7500, 8182]));
  it('GE-02 prf undefined', () => expect(prf(0, 0, 0)).toEqual([0, 0, 0]));
  it('GE-03 ece', () => expect(eceBps([...Array(4).fill([9500, true]), [5500, true], [5500, false]])).toBe(500));
  it('GE-04 route table', () => expect([routeFor('BUG', 'P3', policy), routeFor('ACCOUNT_ACCESS', 'P1', policy),
    routeFor('ACCOUNT_ACCESS', 'P2', policy), routeFor('SPAM', 'P4', policy)]).toEqual(['ENGINEERING', 'TRUST_PRIVACY', 'TIER1', 'NONE']));
  it('fmtBps by digits', () => expect([0, 7, 912, 10000].map(fmtBps)).toEqual(['0.00%', '0.07%', '9.12%', '100.00%']));
  it('parseCsv keeps a quoted JSON field whole', () =>
    expect(parseCsv('a,b,c\nx,"{""k"": 1, ""j"": 2}",\n')).toEqual([{ a: 'x', b: '{"k": 1, "j": 2}', c: '' }]));
});

describe('triage:eval (scripted)', () => {
  it('prints the reference output line for line and matches every per-ticket decision', async () => {
    const r = await evalReport('scripted');
    expect(r.lines).toEqual(readFileSync('fixtures/samples/reference_pipeline.output.txt', 'utf8').trimEnd().split('\n'));
    expect(r.diffs).toEqual([]);
    expect(r.tickets).toBe(1200);
    // The header's result-source hashes are policy:lint's (D-26).
    const want = Object.values(recordedHashes()).map((x) => x.slice(0, 12));
    expect(r.lines[1]!.match(/[0-9a-f]{12}/g)!.sort()).toEqual(want.sort());
  }, 30_000);

  it('reports per-ticket differences when the policy moves (T 7500 → 7000)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'triage-eval-'));
    for (const d of ['fixtures', 'routing', 'pricing', 'schemas', 'monitoring', 'prompts']) cpSync(d, join(root, d), { recursive: true });
    const p = join(root, 'routing/policy.v1.json');
    writeFileSync(p, readFileSync(p, 'utf8').replace('"min_confidence_bps_below": 7500', '"min_confidence_bps_below": 7000'));
    const r = await evalReport('scripted', root);
    expect(r.lines[0]).toContain('(T=7000)');
    expect(r.diffs.length).toBeGreaterThan(0);
  }, 30_000);
});
