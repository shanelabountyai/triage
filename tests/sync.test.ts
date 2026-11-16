// Task 3.5 (D-57): the synchronous `messages` provider and triageOne against a fake client. Nothing here reaches the
// network (D-2); the root is a temp copy, so the committed recordings/ is untouched.
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ledgerState } from '../src/io/caps.js';
import { readTickets } from '../src/io/tickets.js';
import { triageOne } from '../src/io/sync.js';
import { PICO_PER_CENT } from '../src/pipeline/num.js';
import { type BatchRequest, buildRequests } from '../src/providers/live.js';
import { messagesFromEnv, type MessagesClient, syncProvider } from '../src/providers/sync.js';

const system = readFileSync('prompts/classify.v1.md', 'utf8');
const schema = JSON.parse(readFileSync('schemas/triage.v1.json', 'utf8')) as Record<string, unknown>;
const models = { A: 'claude-haiku-5-5', B: 'claude-sonnet-5-5' };
const label = (bps: number) => JSON.stringify({ category: 'BILLING', category_confidence_bps: bps, priority: 'P3', priority_confidence_bps: bps,
  needs_human: false, needs_human_confidence_bps: bps, language: 'en', secondary_category: 'NONE', reason: 'r' });
// hand-written usage: haiku standard = 20 × 100000 + 1316 × 10000 + 80 × 500000 = 55,160,000 pico; batch = half
const usage = { input_tokens: 20, output_tokens: 80, cache_read_input_tokens: 1316, cache_creation_input_tokens: 0 };
const HAIKU_STD = 55_160_000n;

/** Answers every request with one message; `truncate` makes it a max_tokens stop with the JSON cut short. */
function fake(bps = 9000, truncate = false) {
  const sent: BatchRequest['params'][] = [];
  const client: MessagesClient = {
    messages: { create: async (p) => { sent.push(p); return { id: `msg_${sent.length}`, type: 'message', role: 'assistant', model: p.model,
      stop_reason: truncate ? 'max_tokens' : 'end_turn', content: [{ type: 'text', text: truncate ? label(bps).slice(0, 40) : label(bps) }], usage }; } },
    models: { list: () => (async function* () { yield { id: models.A }; yield { id: models.B }; })() },
  };
  return { client, sent };
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'triage-sync-'));
  for (const d of ['routing', 'pricing', 'schemas', 'prompts', 'monitoring']) cpSync(d, join(root, d), { recursive: true });
  mkdirSync(join(root, 'docs')); cpSync('docs/decisions.md', join(root, 'docs/decisions.md'));
  const first = readFileSync('fixtures/tickets_batch1.jsonl', 'utf8').split('\n')[0]! + '\n'; // B1-0001
  let n = 0;
  const one = (f: ReturnType<typeof fake> | null, caps = { runCents: 400, projectCents: 1500 }, provider: 'messages' | 'recorded' = 'messages') => {
    n++;
    const dir = join(root, `run${n}`);
    mkdirSync(dir);
    writeFileSync(join(dir, 'tickets_sync.jsonl'), first);
    let t = 1_000_000;
    return triageOne({ inPath: join(dir, 'tickets_sync.jsonl'), provider, outDir: join(dir, 'out'), ledgerPath: join(root, 'runs.jsonl'), auditSeed: 20261019,
      root, now: () => `2026-10-29T10:00:0${n}.000Z`, caps, ...(f ? { sync: (c) => syncProvider({ ...c, client: f.client, clock: () => (t += 1500) }) } : {}) });
  };
  const ledger = () => readFileSync(join(root, 'runs.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
  return { root, one, ledger };
}

describe('messages provider (fake client)', () => {
  it('sends the batch request params verbatim: same system block, same schema bytes, effort low, no sampling params', async () => {
    const f = fake();
    const { tickets } = readTickets('fixtures/tickets_batch1.jsonl');
    const three = tickets.slice(0, 3);
    const res = await syncProvider({ client: f.client, models, system, schema })('B', three, 'unused');
    expect(f.sent).toEqual(buildRequests('B', three, { models, system, schema }).map((r) => r.params));
    expect(JSON.stringify([f.sent[0]!.system, f.sent[0]!.output_config])).toBe(JSON.stringify([f.sent[2]!.system, f.sent[2]!.output_config]));
    expect(f.sent[0]!.output_config.effort).toBe('low');
    expect(res.get('B1-0001')).toMatchObject({ type: 'succeeded', model: models.B, stopReason: 'end_turn', usage: { input: 20, cacheRead: 1316, output: 80 } });
    expect(res.size).toBe(3);
  });

  it('refuses without TRIAGE_LIVE=1 and a key, and triageOne refuses without a builder and caps', async () => {
    const c = { models, system, schema };
    expect(() => messagesFromEnv({ ANTHROPIC_API_KEY: 'k' }, c)).toThrow(/LIVE_REFUSED: TRIAGE_LIVE=1/);
    expect(() => messagesFromEnv({ TRIAGE_LIVE: '1' }, c)).toThrow(/LIVE_REFUSED: ANTHROPIC_API_KEY/);
    const s = setup();
    await expect(s.one(null)).rejects.toThrow(/LIVE_ONLY_VIA_RUN/);
    expect(existsSync(join(s.root, 'runs.jsonl'))).toBe(false);
  });
});

describe('triageOne (D-19 per call, standard prices)', () => {
  it('one call, cost at standard rates from the usage fields, batch notional beside it; the ledger counts the standard cost', async () => {
    const s = setup(), f = fake();
    const { decision, row } = await s.one(f);
    expect(f.sent).toHaveLength(1); // 9000 bps BILLING: no escalation
    expect(decision).toMatchObject({ ticket_id: 'B1-0001', path: 'A', final_tier: 'A', category: 'BILLING', cost_pico_standard: String(HAIKU_STD), cost_pico_batch: String(HAIKU_STD / 2n) });
    expect(row).toMatchObject({ provider: 'messages', tickets: 1, cap_status: 'OK', cost_pico_standard: String(HAIKU_STD), cost_pico_batch: String(HAIKU_STD / 2n), cost_cents: 0,
      tokens: { input: 20, cache_read: 1316, cache_write_5m: 0, cache_write_1h: 0, output: 80 },
      latency_s_p50: 2, latency_s_p95: 2, latency_ms_per_call: [{ tier: 'A', ms: 1500 }], submitted_at: '1970-01-01T00:16:41.500Z', completed_at: '1970-01-01T00:16:43.000Z' });
    expect(row.run_id).toBe('20261029T100001.000Z-messages');
    expect(ledgerState(join(s.root, 'runs.jsonl')).livePico).toBe(HAIKU_STD);
    expect(readFileSync(join(s.root, 'run1/out/decisions.jsonl'), 'utf8')).toBe(JSON.stringify(decision) + '\n');
  });

  it('refused by projection at standard prices: nothing is sent and no row is written', async () => {
    const s = setup(), f = fake();
    await expect(s.one(f, { runCents: 0, projectCents: 1500 })).rejects.toThrow(/CAP_PROJECTION: tier A, 1 requests project \d+¢ \(ceiling: .*standard prices\)/);
    expect(f.sent).toHaveLength(0);
    expect(existsSync(join(s.root, 'runs.jsonl'))).toBe(false);
  });

  it('tier B refused after tier A was paid for: INCOMPLETE row with A\'s standard cost; the latch then refuses the next call', async () => {
    const s = setup(), f = fake(5000); // escalates; a 1¢ run cap fits haiku's ceiling, not sonnet's
    await expect(s.one(f, { runCents: 1, projectCents: 1500 })).rejects.toThrow(/CAP_PROJECTION: tier B, 1 requests/);
    expect(f.sent).toHaveLength(1);
    expect(s.ledger()[0]).toMatchObject({ provider: 'messages', tickets: 0, tokens: null, cap_status: 'INCOMPLETE', cost_pico_standard: String(HAIKU_STD), error: expect.stringMatching(/CAP_PROJECTION: tier B/) });
    appendFileSync(join(s.root, 'runs.jsonl'), JSON.stringify({ run_id: 'r-over', provider: 'live', cost_pico_batch: String(PICO_PER_CENT), cap_status: 'OVER_CAP' }) + '\n');
    const g = fake();
    await expect(s.one(g)).rejects.toThrow(/CAP_LATCHED: r-over/);
    expect(g.sent).toHaveLength(0);
  });

  it('a max_tokens stop is truncated JSON: tier A fails to B, B fails to the human queue, both calls paid for', async () => {
    const s = setup(), f = fake(9000, true);
    const { decision, row } = await s.one(f);
    expect(f.sent.map((p) => p.model)).toEqual([models.A, models.B]);
    expect(decision).toMatchObject({ path: 'A>B>H', final_tier: '', category: 'OTHER', priority: 'P3', needs_human: true,
      flags: ['TIER_A_FAILED:PARSE_JSON', 'FINAL_TIER_FAILED:PARSE_JSON'], reasons: ['escalate:TIER_A_FAILED:PARSE_JSON', 'human:final_tier_failed'] });
    // sonnet standard: 20 × 2000000 + 1316 × 100000 + 80 × 10000000 = 971,600,000
    expect(row).toMatchObject({ cap_status: 'OK', cost_pico_standard: String(HAIKU_STD + 971_600_000n), latency_ms_per_call: [{ tier: 'A', ms: 1500 }, { tier: 'B', ms: 1500 }] });
  });

  it('records under recordings/sync/ once per ticket, and --provider recorded replays the same decision', async () => {
    const s = setup(), f = fake();
    const first = (await s.one(f)).decision;
    const second = (await s.one(f)).decision; // the same ticket again is sent again (it is live) but recorded once
    expect(f.sent).toHaveLength(2);
    const rec = join(s.root, 'recordings/sync');
    expect(readFileSync(join(rec, 'tierA.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1);
    expect(existsSync(join(rec, 'tierB.jsonl'))).toBe(false);
    expect(readFileSync(join(rec, 'decisions.jsonl'), 'utf8')).toBe(JSON.stringify(first) + '\n' + JSON.stringify(second) + '\n');
    const calls = readFileSync(join(rec, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(calls.map((c) => c['run_id'])).toEqual(['20261029T100001.000Z-messages', '20261029T100002.000Z-messages']);
    expect(calls[0]).toMatchObject({ ticket_id: 'B1-0001', models, path: 'A', cost_pico_standard: String(HAIKU_STD) });
    const replay = await s.one(null, undefined, 'recorded');
    expect(replay.decision).toEqual(first);
    expect(replay.row).toMatchObject({ provider: 'recorded', cap_status: 'n/a', latency_s_p50: null, cost_cents: 0 });
    expect(ledgerState(join(s.root, 'runs.jsonl')).livePico).toBe(2n * HAIKU_STD); // the replay spends nothing
  });
});
