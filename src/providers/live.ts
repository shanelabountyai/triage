// The live provider (task 2.2, Phase 2): one Message Batch per tier. Tests drive it with a fake client;
// nothing under tests/ reaches the network (D-2). Results go through the same D-9 reader as the replays,
// so a live line and a recorded line are judged by one parser.
import Anthropic from '@anthropic-ai/sdk';
import type { Ticket } from '../io/tickets.js';
import { parseResults } from '../io/results.js';
import type { BatchResult } from '../pipeline/parse.js';
import type { Provider, Tier } from './index.js';

/** The slice of the SDK client the provider uses; the real `Anthropic` client satisfies it. */
export interface BatchClient {
  messages: { batches: {
    create(body: { requests: BatchRequest[] }): PromiseLike<{ id: string }>;
    retrieve(id: string): PromiseLike<{ id: string; processing_status: string }>;
    results(id: string): PromiseLike<AsyncIterable<unknown>>;
  } };
}

export interface BatchRequest {
  custom_id: string;
  params: {
    model: string; max_tokens: number;
    system: { type: 'text'; text: string; cache_control: { type: 'ephemeral'; ttl: '1h' } }[];
    messages: { role: 'user'; content: string }[];
    output_config: { effort: 'low'; format: { type: 'json_schema'; schema: Record<string, unknown> } };
  };
}

export interface LiveConfig {
  client: BatchClient;
  models: Record<Tier, string>;
  system: string; // prompts/classify.v1.md, as bytes on disk
  schema: Record<string, unknown>; // schemas/triage.v1.json
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
}

// D-42: the 2.3 projection allows this many output tokens per request (D-40 item 3).
export const MAX_TOKENS = 1024;

/** The ticket as the user turn. Data, never an instruction (non-negotiable 11); the screen already ran. */
export const userTurn = (t: Ticket) => `Subject: ${t.subject}\n\n${t.body}`;

export function buildRequests(tier: Tier, tickets: Ticket[], c: Pick<LiveConfig, 'models' | 'system' | 'schema'>): BatchRequest[] {
  // `$comment` is documentation for people, not part of the API's schema subset (D-42).
  const { $comment: _doc, ...schema } = c.schema;
  return tickets.map((t) => ({
    custom_id: t.ticket_id,
    params: {
      model: c.models[tier], max_tokens: MAX_TOKENS,
      system: [{ type: 'text', text: c.system, cache_control: { type: 'ephemeral', ttl: '1h' } }], // O-7
      messages: [{ role: 'user', content: userTurn(t) }],
      // no prefill, no sampling params, no budget_tokens: each is a 400 on the 5.5 models; effort per D-40
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    },
  }));
}

/** Non-negotiable 8: the cached prefix (system + schema) is byte-identical across the batch, or nothing is sent. */
export function assertPrefixIdentical(requests: BatchRequest[]): void {
  const prefix = (r: BatchRequest) => JSON.stringify([r.params.system, r.params.output_config]);
  const first = requests[0] && prefix(requests[0]);
  const bad = requests.find((r) => prefix(r) !== first);
  if (bad) throw new Error(`PREFIX_NOT_IDENTICAL: ${bad.custom_id} differs from ${requests[0]!.custom_id}; nothing was sent`);
}

export function liveProvider(c: LiveConfig): Provider {
  const sleep = c.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  return async (tier, tickets) => {
    if (!tickets.length) return new Map<string, BatchResult>();
    const requests = buildRequests(tier, tickets, c);
    assertPrefixIdentical(requests);
    const b = c.client.messages.batches;
    const { id } = await b.create({ requests });
    while ((await b.retrieve(id)).processing_status !== 'ended') await sleep(c.pollMs ?? 60_000);
    const lines: string[] = [];
    for await (const r of await b.results(id)) lines.push(JSON.stringify(r));
    const { results, errors } = parseResults(lines.join('\n'));
    if (errors.length) throw new Error(`batch ${id}: ${errors.length} bad result line(s), first: ${errors[0]!.code} ${errors[0]!.detail}`);
    const ids = new Set(tickets.map((t) => t.ticket_id));
    const stray = [...results.keys()].find((k) => !ids.has(k));
    if (stray) throw new Error(`batch ${id}: result for ${stray}, which was not submitted`);
    return results; // keyed by custom_id: results arrive in any order
  };
}

/** Refuses unless TRIAGE_LIVE=1 and a key are both set (D-19); nothing is constructed or sent otherwise. */
export function liveFromEnv(env: Record<string, string | undefined>, c: Omit<LiveConfig, 'client'>): Provider {
  if (env['TRIAGE_LIVE'] !== '1') throw new Error('LIVE_REFUSED: TRIAGE_LIVE=1 is not set; nothing was sent');
  if (!env['ANTHROPIC_API_KEY']) throw new Error('LIVE_REFUSED: ANTHROPIC_API_KEY is not set; nothing was sent');
  return liveProvider({ ...c, client: new Anthropic({ apiKey: env['ANTHROPIC_API_KEY'] }) });
}
