// Task 2.5: the recorder. A fake-client live run writes recordings/<batch>/ that --provider recorded replays to the same
// decisions. Nothing here reaches the network (D-2); the root is a temp copy, so the committed recordings/ is untouched.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { triageRun } from '../src/io/run.js';
import { percentile } from '../src/pipeline/num.js';
import { type BatchClient, type BatchRequest, liveProvider } from '../src/providers/live.js';

const label = (bps: number) => JSON.stringify({ category: 'BILLING', category_confidence_bps: bps, priority: 'P3', priority_confidence_bps: bps,
  needs_human: false, needs_human_confidence_bps: bps, language: 'en', secondary_category: 'NONE', reason: 'r' });

function fake() {
  const sent: BatchRequest[][] = [];
  const client: BatchClient = { messages: { batches: {
    create: async (b) => { sent.push(b.requests); return { id: `msgbatch_${sent.length}` }; },
    retrieve: async (id) => ({ id, processing_status: 'ended' }),
    results: async () => (async function* () { // reversed: results arrive in any order
      for (const r of [...sent.at(-1)!].reverse()) yield { custom_id: r.custom_id, result: { type: 'succeeded', message: { model: r.params.model, stop_reason: 'end_turn',
        content: [{ type: 'text', text: label(5000) }], usage: { input_tokens: 40, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } };
    })(),
  } } };
  return client;
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'triage-rec-'));
  for (const d of ['routing', 'pricing', 'schemas', 'prompts', 'monitoring']) cpSync(d, join(root, d), { recursive: true });
  mkdirSync(join(root, 'docs')); cpSync('docs/decisions.md', join(root, 'docs/decisions.md'));
  const inPath = join(root, 'tickets_rec.jsonl');
  writeFileSync(inPath, readFileSync('fixtures/tickets_batch1.jsonl', 'utf8').split('\n').slice(0, 5).join('\n') + '\n');
  let t = 1_000_000;
  const clock = () => (t += 30_000); // every read is 30 s later: submit→ready is 30 s per tier
  const base = { inPath, root, ledgerPath: join(root, 'runs.jsonl'), auditSeed: 20261019, now: () => '2026-10-23T10:00:00.000Z' };
  return { root, base, clock };
}

describe('recorder', () => {
  it('nearest-rank percentile on integers', () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([9, 1, 5, 3], 50)).toBe(3);
    expect(percentile([9, 1, 5, 3], 95)).toBe(9);
  });

  it('a live run writes tier files and meta.json; --provider recorded replays to the same decisions', async () => {
    const s = setup();
    const live = await triageRun({ ...s.base, provider: 'live', outDir: join(s.root, 'out1'), caps: { runCents: 300, projectCents: 1500 },
      live: (c) => liveProvider({ ...c, client: fake(), sleep: async () => {}, clock: s.clock }) }); // 5000 bps: every ticket escalates, so A and B both run
    const rec = join(s.root, 'recordings', 'rec');
    expect(readFileSync(join(rec, 'tierA.jsonl'), 'utf8').trim().split('\n')).toHaveLength(5);
    expect(readFileSync(join(rec, 'tierB.jsonl'), 'utf8').trim().split('\n')).toHaveLength(5);
    const meta = JSON.parse(readFileSync(join(rec, 'meta.json'), 'utf8'));
    expect(meta).toMatchObject({ latency_s_p50: 30, latency_s_p95: 30, models: live.row.models, hashes: live.row.hashes,
      tiers: { A: { batch_id: 'msgbatch_1', requests: 5 }, B: { batch_id: 'msgbatch_2', requests: 5 } } });
    expect(live.row).toMatchObject({ latency_s_p50: 30, latency_s_p95: 30 });

    const replay = await triageRun({ ...s.base, provider: 'recorded', outDir: join(s.root, 'out2') });
    const lines = (d: string) => readFileSync(join(s.root, d, 'decisions.jsonl'), 'utf8');
    expect(lines('out2')).toBe(lines('out1'));
    expect(replay.row).toMatchObject({ latency_s_p50: null, latency_s_p95: null });
  });

  it('never overwrites a recording', async () => {
    const s = setup();
    mkdirSync(join(s.root, 'recordings/rec'), { recursive: true });
    writeFileSync(join(s.root, 'recordings/rec/tierA.jsonl'), 'keep\n');
    await expect(triageRun({ ...s.base, provider: 'live', outDir: join(s.root, 'out1'), caps: { runCents: 300, projectCents: 1500 },
      live: (c) => liveProvider({ ...c, client: fake(), sleep: async () => {} }) })).rejects.toThrow(/RECORDING_EXISTS/);
    expect(readFileSync(join(s.root, 'recordings/rec/tierA.jsonl'), 'utf8')).toBe('keep\n');
    expect(existsSync(join(s.root, 'recordings/rec/meta.json'))).toBe(false);
    expect(existsSync(join(s.root, 'runs.jsonl'))).toBe(false); // refused before anything was sent
  });
});
