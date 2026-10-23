// Task 2.3: the D-19 caps around a live run, driven by a fake Batches client. Nothing here reaches the network (D-2).
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { capsFromEnv, headroomPico, ledgerState } from '../src/io/caps.js';
import { PICO_PER_CENT, picoToCents } from '../src/pipeline/num.js';
import { triageRun } from '../src/io/run.js';
import { projectPico, type Prices } from '../src/pipeline/cost.js';
import { type BatchClient, type BatchRequest, liveProvider } from '../src/providers/live.js';

const prices = JSON.parse(readFileSync('pricing/prices.v1.json', 'utf8')) as Prices;
const label = (bps: number) => JSON.stringify({ category: 'BILLING', category_confidence_bps: bps, priority: 'P3', priority_confidence_bps: bps,
  needs_human: false, needs_human_confidence_bps: bps, language: 'en', secondary_category: 'NONE', reason: 'r' });

/** Answers every request it is sent with one succeeded line at the given usage. */
function fake(output_tokens: number, bps = 9000) {
  const sent: BatchRequest[][] = [];
  const client: BatchClient = { messages: { batches: {
    create: async (b) => { sent.push(b.requests); return { id: `msgbatch_${sent.length}` }; },
    retrieve: async (id) => ({ id, processing_status: 'ended' }),
    results: async () => (async function* () {
      for (const r of sent.at(-1)!) yield { custom_id: r.custom_id, result: { type: 'succeeded', message: { model: r.params.model, stop_reason: 'end_turn',
        content: [{ type: 'text', text: label(bps) }], usage: { input_tokens: 40, output_tokens, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } };
    })(),
  } }, models: { list: () => (async function* () { yield { id: 'claude-haiku-5-5' }; yield { id: 'claude-sonnet-5-5' }; })() } };
  return { client, sent };
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'triage-caps-'));
  const input = join(dir, 'tickets_in.jsonl');
  writeFileSync(input, readFileSync('fixtures/tickets_batch1.jsonl', 'utf8').split('\n').slice(0, 5).join('\n') + '\n');
  // the recorder writes under <root>/recordings, so the run gets a temp copy of the policy files, never the repo's
  for (const d of ['routing', 'pricing', 'schemas', 'prompts', 'monitoring']) cpSync(d, join(dir, d), { recursive: true });
  mkdirSync(join(dir, 'docs')); cpSync('docs/decisions.md', join(dir, 'docs/decisions.md'));
  let n = 0;
  const run = (f: ReturnType<typeof fake>, caps: { runCents: number; projectCents: number }, acknowledgeOverCap = false) => {
    n++;
    const inPath = join(dir, `tickets_t${n}.jsonl`); // one recording per run: a recording is never overwritten
    cpSync(input, inPath);
    return triageRun({ inPath, root: dir, provider: 'live', outDir: join(dir, `out${n}`), ledgerPath: join(dir, 'runs.jsonl'), auditSeed: 20261019,
      now: () => `2026-10-22T10:00:0${n}.000Z`, caps, acknowledgeOverCap,
      live: (c) => liveProvider({ ...c, client: f.client, sleep: async () => {} }) });
  };
  const ledger = () => readFileSync(join(dir, 'runs.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  return { dir, run, ledger };
}

describe('D-19 caps (fake client)', () => {
  it('caps default to 300¢ (D-44) and 1500¢; anything but whole cents refuses', () => {
    expect(capsFromEnv({})).toEqual({ runCents: 300, projectCents: 1500 });
    expect(capsFromEnv({ TRIAGE_RUN_CAP_CENTS: '50', TRIAGE_PROJECT_CAP_CENTS: '' })).toEqual({ runCents: 50, projectCents: 1500 });
    for (const bad of ['-1', '1.5', 'none', ' 5']) expect(() => capsFromEnv({ TRIAGE_RUN_CAP_CENTS: bad })).toThrow(/CAP_INVALID/);
  });

  it('the projection is a ceiling: 1h cache write on the prefix, estTokens input, max_tokens output, batch prices', () => {
    // haiku: 8 tokens prefix × 200000 + 1 token user × 100000 + 1024 × 500000 = 513,700,000; × 1/2
    expect(projectPico('claude-haiku-5-5', 'x'.repeat(32), ['abcd', 'efg'], 1024, prices)).toBe(2n * 256_850_000n);
    expect(() => projectPico('claude-nope', '', ['a'], 1, prices)).toThrow(/COST_UNKNOWN_MODEL/);
    expect(headroomPico({ runCents: 200, projectCents: 1500 }, 1400n * PICO_PER_CENT, 0n)).toBe(100n * PICO_PER_CENT);
    expect(headroomPico({ runCents: 200, projectCents: 1500 }, 0n, 50n * PICO_PER_CENT)).toBe(150n * PICO_PER_CENT);
  });

  it('refused by projection: nothing is created and no ledger row is written', async () => {
    const s = setup(), f = fake(80);
    await expect(s.run(f, { runCents: 0, projectCents: 1500 })).rejects.toThrow(/CAP_PROJECTION: tier A, 5 requests/);
    expect(f.sent).toHaveLength(0);
    expect(() => s.ledger()).toThrow(/ENOENT/);
  });

  it('a run under both caps sends, records its real cost from usage fields, and is OK', async () => {
    const s = setup(), f = fake(80);
    const { row } = await s.run(f, { runCents: 200, projectCents: 1500 });
    expect(f.sent).toHaveLength(1); // 9000 bps BILLING: nothing escalates, so tier B is never submitted
    // 5 × (40 × 100000 + 80 × 500000) / 2 at haiku batch prices
    expect(row).toMatchObject({ provider: 'live', tickets: 5, cap_status: 'OK', acknowledges: [], cost_pico_batch: String(5n * 22_000_000n) });
  });

  it('the project cap counts live rows across the ledger, never a replay\'s notional cost', async () => {
    const s = setup();
    const row = (provider: string, cents: bigint) => JSON.stringify({ run_id: `r-${provider}`, provider, cost_pico_batch: String(cents * PICO_PER_CENT), cap_status: provider === 'live' ? 'OK' : 'n/a' }) + '\n';
    appendFileSync(join(s.dir, 'runs.jsonl'), row('scripted', 100_000n)); // a replay "costs" 1000 USD and spends nothing
    expect((await s.run(fake(80), { runCents: 200, projectCents: 1500 })).row.cap_status).toBe('OK');
    appendFileSync(join(s.dir, 'runs.jsonl'), row('live', 1500n)); // live spend now at the project cap
    expect(ledgerState(join(s.dir, 'runs.jsonl')).livePico).toBe(1500n * PICO_PER_CENT + 5n * 22_000_000n);
    const f = fake(80);
    await expect(s.run(f, { runCents: 200, projectCents: 1500 })).rejects.toThrow(/CAP_PROJECTION: tier A.*project cap 1500¢/);
    expect(f.sent).toHaveLength(0);
  });

  it('the latch: real cost over the cap marks OVER_CAP, refuses the next live run, until --acknowledge-over-cap', async () => {
    const s = setup();
    // projection 5 × ~0.04¢ fits a 1¢ cap; 400,000 output tokens each is 5 × 100¢ for real
    const first = (await s.run(fake(400_000), { runCents: 1, projectCents: 1500 })).row;
    expect(first.cap_status).toBe('OVER_CAP');
    expect(first.cost_cents).toBe(picoToCents(5n * 400_000n * 500_000n / 2n));

    const f = fake(80);
    await expect(s.run(f, { runCents: 200, projectCents: 1500 })).rejects.toThrow(new RegExp(`CAP_LATCHED: ${first.run_id}`));
    expect(f.sent).toHaveLength(0);

    const acked = (await s.run(f, { runCents: 200, projectCents: 1500 }, true)).row;
    expect(acked).toMatchObject({ cap_status: 'OK', acknowledges: [first.run_id] });
    expect((await s.run(fake(80), { runCents: 200, projectCents: 1500 })).row.cap_status).toBe('OK'); // latch released
  });

  it('tier B refused after tier A spent: the spend is on the ledger as INCOMPLETE, and B was never sent', async () => {
    const s = setup(), f = fake(80, 5000); // 5000 bps: every ticket escalates
    await expect(s.run(f, { runCents: 1, projectCents: 1500 })).rejects.toThrow(/CAP_PROJECTION: tier B, 5 requests/);
    expect(f.sent).toHaveLength(1);
    expect(s.ledger()).toMatchObject([{ provider: 'live', tickets: 0, cap_status: 'INCOMPLETE', cost_pico_batch: String(5n * 22_000_000n) }]);
  });
});
