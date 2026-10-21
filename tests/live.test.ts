// Task 2.2: the live provider against a fake client. Nothing here reaches the network (D-2).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { tierResult } from '../src/pipeline/parse.js';
import type { Schema } from '../src/pipeline/validate.js';
import { assertPrefixIdentical, type BatchClient, type BatchRequest, buildRequests, liveFromEnv, liveProvider, MAX_TOKENS } from '../src/providers/live.js';
import { provider } from '../src/providers/index.js';
import type { Ticket } from '../src/io/tickets.js';

const system = readFileSync('prompts/classify.v1.md', 'utf8');
const schema = JSON.parse(readFileSync('schemas/triage.v1.json', 'utf8')) as Record<string, unknown>;
const models = { A: 'claude-haiku-5-5', B: 'claude-sonnet-5-5' };
const tickets: Ticket[] = ['T1', 'T2', 'T3', 'T4', 'T5'].map((id) => ({ ticket_id: id, subject: `s ${id}`, body: `b ${id}` }));
const good = JSON.stringify({ category: 'BILLING', category_confidence_bps: 9000, priority: 'P3', priority_confidence_bps: 9000,
  needs_human: false, needs_human_confidence_bps: 9000, language: 'en', secondary_category: 'NONE', reason: 'r' });
const usage = { input_tokens: 20, output_tokens: 80, cache_read_input_tokens: 1316, cache_creation_input_tokens: 0 };
const msg = (stop_reason: string) => ({ type: 'succeeded', message: { model: models.A, stop_reason, content: [{ type: 'text', text: good }], usage } });

/** Records every call; results come back out of submission order, one per result.type. */
function fake(statuses = ['in_progress', 'in_progress', 'ended']) {
  const calls: { create: BatchRequest[][]; retrieve: number; sleeps: number[] } = { create: [], retrieve: 0, sleeps: [] };
  const lines = [
    { custom_id: 'T5', result: msg('refusal') },
    { custom_id: 'T3', result: { type: 'expired' } },
    { custom_id: 'T1', result: msg('end_turn') },
    { custom_id: 'T4', result: { type: 'canceled' } },
    { custom_id: 'T2', result: { type: 'errored', error: { type: 'error', error: { type: 'overloaded_error', message: 'x' } } } },
  ];
  const client: BatchClient = { messages: { batches: {
    create: async (b) => { calls.create.push(b.requests); return { id: 'msgbatch_fake' }; },
    retrieve: async (id) => ({ id, processing_status: statuses[Math.min(calls.retrieve++, statuses.length - 1)]! }),
    results: async () => (async function* () { yield* lines; })(),
  } } };
  return { client, calls, sleep: async (ms: number) => { calls.sleeps.push(ms); } };
}

describe('live provider (fake client)', () => {
  it('request shape: cached system block, schema in output_config, effort low, nothing the 5.5 models reject', () => {
    const [r] = buildRequests('B', tickets, { models, system, schema });
    expect(r).toEqual({ custom_id: 'T1', params: {
      model: 'claude-sonnet-5-5', max_tokens: MAX_TOKENS,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral', ttl: '1h' } }],
      messages: [{ role: 'user', content: 'Subject: s T1\n\nb T1' }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: expect.not.objectContaining({ $comment: expect.anything() }) } },
    } });
    const { $comment: _c, ...sent } = schema;
    expect(r!.params.output_config.format.schema).toEqual(sent);
    for (const k of ['temperature', 'top_p', 'top_k', 'thinking', 'fallbacks']) expect(r!.params).not.toHaveProperty(k);
    expect(r!.params.messages.every((m) => m.role === 'user')).toBe(true); // no assistant prefill
  });

  it('byte-identity assert: one changed system or schema byte refuses the batch', () => {
    const rs = buildRequests('A', tickets, { models, system, schema });
    expect(() => assertPrefixIdentical(rs)).not.toThrow();
    const sys = structuredClone(rs);
    sys[3]!.params.system[0]!.text += ' ';
    expect(() => assertPrefixIdentical(sys)).toThrow(/PREFIX_NOT_IDENTICAL: T4/);
    const sch = [...rs];
    sch[2] = structuredClone(rs[2]!); // every request shares one schema object; change only this one
    (sch[2]!.params.output_config.format.schema as { type: string }).type = 'Object';
    expect(() => assertPrefixIdentical(sch)).toThrow(/PREFIX_NOT_IDENTICAL: T3/);
  });

  it('submits once, polls until ended, keys results by custom_id, maps every result.type', async () => {
    const f = fake();
    const res = await liveProvider({ client: f.client, models, system, schema, sleep: f.sleep, pollMs: 5 })('A', tickets, 'unused');
    expect(f.calls.create).toHaveLength(1);
    expect(f.calls.create[0]!.map((r) => r.custom_id)).toEqual(['T1', 'T2', 'T3', 'T4', 'T5']);
    expect(f.calls.retrieve).toBe(3);
    expect(f.calls.sleeps).toEqual([5, 5]);
    const s = schema as Schema;
    expect(Object.fromEntries(tickets.map((t) => [t.ticket_id, tierResult(res.get(t.ticket_id), s).failure]))).toEqual(
      { T1: '', T2: 'errored', T3: 'expired', T4: 'canceled', T5: 'PARSE_REFUSAL' });
    expect(res.get('T1')?.usage).toEqual({ input: 20, cacheRead: 1316, cacheCreation5m: 0, cacheCreation1h: 0, output: 80 });
  });

  it('no tickets, no batch', async () => {
    const f = fake();
    expect((await liveProvider({ client: f.client, models, system, schema, sleep: f.sleep })('B', [], 'unused')).size).toBe(0);
    expect(f.calls.create).toHaveLength(0);
  });

  it('refuses without TRIAGE_LIVE=1 and a key; triage:run cannot reach it before the caps (2.3)', async () => {
    const c = { models, system, schema };
    expect(() => liveFromEnv({ ANTHROPIC_API_KEY: 'k' }, c)).toThrow(/LIVE_REFUSED: TRIAGE_LIVE=1/);
    expect(() => liveFromEnv({ TRIAGE_LIVE: 'true', ANTHROPIC_API_KEY: 'k' }, c)).toThrow(/LIVE_REFUSED: TRIAGE_LIVE=1/);
    expect(() => liveFromEnv({ TRIAGE_LIVE: '1' }, c)).toThrow(/LIVE_REFUSED: ANTHROPIC_API_KEY/);
    await expect(provider('live')('A', tickets, 'unused')).rejects.toThrow(/LIVE_NOT_WIRED/);
  });
});
