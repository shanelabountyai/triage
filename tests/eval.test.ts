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

describe('triage:eval (recorded, D-49)', () => {
  it('is held to the live run\'s own decisions, is deterministic, and prints the real cache-read share', async () => {
    const a = await evalReport('recorded');
    const b = await evalReport('recorded');
    expect(a.diffs).toEqual([]);
    expect(a.tickets).toBe(1200);
    expect(a.heldTo).toBe('recordings/batch{1,2}/decisions.jsonl');
    expect(a.lines).toEqual(b.lines);
    expect(a.lines.filter((l) => l.startsWith('cache (from usage fields): tier A read '))).toHaveLength(2);
    expect(a.lines.filter((l) => l.startsWith('recording: run ') && l.endsWith('prompt, schema and model ids current'))).toHaveLength(2);
  }, 30_000);

  it('every sweep row is measured once the top-up covers tier B for all of batch 1 (D-50); without it, rows above T are n/a', async () => {
    const { lines } = await evalReport('recorded');
    const sweep = lines.filter((l) => /^  \d{4} /.test(l));
    expect(sweep).toHaveLength(8);
    expect(sweep.every((l) => !l.includes('n/a'))).toBe(true);
    expect(lines.find((l) => l.startsWith('recording: run '))).toContain('top-up B msgbatch_');

    const root = mkdtempSync(join(tmpdir(), 'triage-eval-topup-'));
    for (const d of ['fixtures', 'routing', 'pricing', 'schemas', 'monitoring', 'prompts', 'recordings']) cpSync(d, join(root, d), { recursive: true });
    const p = join(root, 'recordings/batch1/tierB.jsonl');
    writeFileSync(p, readFileSync(p, 'utf8').split('\n').slice(0, 424).join('\n') + '\n'); // the recorded lines only, as before the top-up
    const without = (await evalReport('recorded', root)).lines.filter((l) => /^  \d{4} /.test(l));
    expect(without.slice(0, 4).every((l) => !l.includes('n/a'))).toBe(true);
    expect(without.slice(4).every((l) => / escalated tickets have no recorded tier-B result$/.test(l))).toBe(true);
  }, 60_000);

  it('reports a per-ticket difference when a committed decision is edited', async () => {
    const root = mkdtempSync(join(tmpdir(), 'triage-eval-rec-'));
    for (const d of ['fixtures', 'routing', 'pricing', 'schemas', 'monitoring', 'prompts', 'recordings']) cpSync(d, join(root, d), { recursive: true });
    const p = join(root, 'recordings/batch2/decisions.jsonl');
    const lines = readFileSync(p, 'utf8').split('\n');
    lines[3] = lines[3]!.replace(/"needs_human":(true|false)/, (_, v) => `"needs_human":${v === 'true' ? 'false' : 'true'}`);
    writeFileSync(p, lines.join('\n'));
    const r = await evalReport('recorded', root);
    expect(r.diffs).toHaveLength(1);
    expect(r.diffs[0]).toContain('batch 2 recordings/batch2/decisions.jsonl line 4');
  }, 30_000);
});
