// Task 2.5: the recorder. A fake-client live run writes recordings/<batch>/ that --provider recorded replays to the same
// decisions. Nothing here reaches the network (D-2); the root is a temp copy, so the committed recordings/ is untouched.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { topUpTierB, triageRun } from '../src/io/run.js';
import { provider } from '../src/providers/index.js';
import { readTickets } from '../src/io/tickets.js';
import { percentile } from '../src/pipeline/num.js';
import { type BatchClient, type BatchRequest, liveProvider } from '../src/providers/live.js';

const label = (bps: number) => JSON.stringify({ category: 'BILLING', category_confidence_bps: bps, priority: 'P3', priority_confidence_bps: bps,
  needs_human: false, needs_human_confidence_bps: bps, language: 'en', secondary_category: 'NONE', reason: 'r' });

function fake(bpsFor: (id: string) => number = () => 5000) {
  const sent: BatchRequest[][] = [];
  const client: BatchClient = { messages: { batches: {
    create: async (b) => { sent.push(b.requests); return { id: `msgbatch_${sent.length}` }; },
    retrieve: async (id) => ({ id, processing_status: 'ended' }),
    results: async () => (async function* () { // reversed: results arrive in any order
      for (const r of [...sent.at(-1)!].reverse()) yield { custom_id: r.custom_id, result: { type: 'succeeded', message: { model: r.params.model, stop_reason: 'end_turn',
        content: [{ type: 'text', text: label(bpsFor(r.custom_id)) }], usage: { input_tokens: 40, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } };
    })(),
  } }, models: { list: () => (async function* () { yield { id: 'claude-haiku-5-5' }; yield { id: 'claude-sonnet-5-5' }; })() } };
  return { client, sent };
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
      live: (c) => liveProvider({ ...c, client: fake().client, sleep: async () => {}, clock: s.clock }) }); // 5000 bps: every ticket escalates, so A and B both run
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
    expect(lines('recordings/rec')).toBe(lines('out1')); // D-49: the recording carries the live run's decisions
    expect(replay.row).toMatchObject({ latency_s_p50: null, latency_s_p95: null });
  });

  it('never overwrites a recording', async () => {
    const s = setup();
    mkdirSync(join(s.root, 'recordings/rec'), { recursive: true });
    writeFileSync(join(s.root, 'recordings/rec/tierA.jsonl'), 'keep\n');
    await expect(triageRun({ ...s.base, provider: 'live', outDir: join(s.root, 'out1'), caps: { runCents: 300, projectCents: 1500 },
      live: (c) => liveProvider({ ...c, client: fake().client, sleep: async () => {} }) })).rejects.toThrow(/RECORDING_EXISTS/);
    expect(readFileSync(join(s.root, 'recordings/rec/tierA.jsonl'), 'utf8')).toBe('keep\n');
    expect(existsSync(join(s.root, 'recordings/rec/meta.json'))).toBe(false);
    expect(existsSync(join(s.root, 'runs.jsonl'))).toBe(false); // refused before anything was sent
  });

  it('top-up (2.9, D-50): tier B over the non-escalated tickets is appended, meta notes the batch, decisions are unchanged, never twice', async () => {
    const s = setup();
    const odd = (id: string) => (Number(id.slice(-1)) % 2 ? 9000 : 5000); // B1-0001, -0003, -0005 stay on tier A; -0002, -0004 escalate
    const f = fake(odd); // one fake across both runs, so batch ids keep counting
    const live = (c: Omit<Parameters<typeof liveProvider>[0], 'client'>) => liveProvider({ ...c, client: f.client, sleep: async () => {}, clock: s.clock });
    const caps = { runCents: 300, projectCents: 1500 };
    await triageRun({ ...s.base, provider: 'live', outDir: join(s.root, 'out1'), caps, live });
    const rec = join(s.root, 'recordings', 'rec');
    const linesOf = (f: string) => readFileSync(join(rec, f), 'utf8').trim().split('\n');
    expect(linesOf('tierB.jsonl')).toHaveLength(2);
    const before = readFileSync(join(rec, 'decisions.jsonl'), 'utf8');

    const top = await topUpTierB({ ...s.base, caps, live });
    expect(top).toMatchObject({ targets: 3, escalated: 2, row: { provider: 'live', tickets: 3, cap_status: 'OK', topup_of: rec } });
    expect(linesOf('tierB.jsonl')).toHaveLength(5);
    expect(linesOf('tierB.jsonl').slice(0, 2)).toEqual(JSON.parse(JSON.stringify(linesOf('tierB.jsonl').slice(0, 2)))); // recorded lines untouched
    const meta = JSON.parse(readFileSync(join(rec, 'meta.json'), 'utf8'));
    expect(meta).toMatchObject({ tiers: { A: { requests: 5 }, B: { requests: 2 } }, topup: { tier: 'B', batch_id: 'msgbatch_3', requests: 3, latency_s_p50: 30 } });
    expect(readFileSync(join(s.root, 'runs.jsonl'), 'utf8').trim().split('\n')).toHaveLength(2);

    // the replay at the policy T still takes the live run's decisions (D-49), and tier B now covers every ticket for the sweep
    await triageRun({ ...s.base, provider: 'recorded', outDir: join(s.root, 'out2') });
    expect(readFileSync(join(s.root, 'out2/decisions.jsonl'), 'utf8')).toBe(before);
    const { tickets } = readTickets(s.base.inPath);
    expect((await provider('recorded', s.root)('B', tickets, s.base.inPath)).size).toBe(5);

    await expect(topUpTierB({ ...s.base, caps, live })).rejects.toThrow(/TOPUP_EXISTS/);
    expect(linesOf('tierB.jsonl')).toHaveLength(5);
  });

  it('top-up refuses without a recording and under the latch, sending nothing', async () => {
    const s = setup();
    const live = () => { throw new Error('must not be built'); };
    await expect(topUpTierB({ ...s.base, caps: { runCents: 300, projectCents: 1500 }, live })).rejects.toThrow(/TOPUP_NO_RECORDING/);
    expect(existsSync(join(s.root, 'runs.jsonl'))).toBe(false);
  });
});
