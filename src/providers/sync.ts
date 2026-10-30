// The synchronous `messages` provider (task 3.5, O-10): one client.messages.create per ticket per tier, for the
// time-sensitive ticket N9 cannot leave in a batch for up to 24 hours. Each request is the Batches request's `params`
// verbatim (buildRequests), so the cached prefix (system + output_config) is byte-identical to the batch path by
// construction (non-negotiable 8); the test holds the sent params equal to the batch request's. Standard prices: the
// cost is the caller's to take at `batch: false`. Adapted from use-case-studio src/lib/kickoff/claude.ts callStructured
// (D-53): no retry on a bad answer (D-8; transport retries stay the SDK's default), and a `max_tokens` stop is truncated
// text that fails the parser. The response is re-wrapped as a Batches result line and read by the D-9 reader, so a sync
// answer and a batch answer are judged by one parser and a recorded replay of a sync call needs no second reader.
import Anthropic from '@anthropic-ai/sdk';
import { parseResults } from '../io/results.js';
import type { BatchResult } from '../pipeline/parse.js';
import type { Provider, Tier } from './index.js';
import { assertLiveEnv, assertModelsListed, type BatchClient, type BatchRequest, buildRequests, type LiveConfig } from './live.js';

/** The slice of the SDK client the provider uses; the real `Anthropic` client satisfies it. */
export interface MessagesClient {
  messages: { create(params: BatchRequest['params']): PromiseLike<unknown> };
  models: BatchClient['models'];
}

/** One request, as made: the result line in the Batches shape, and the wall-clock around the call (O-10). */
export interface CallInfo { tier: Tier; ticketId: string; startedMs: number; endedMs: number; line: string }

export interface SyncConfig extends Pick<LiveConfig, 'models' | 'system' | 'schema' | 'clock'> {
  client: MessagesClient;
  /** called after every request, before its line is parsed (the recorder in src/io/sync.ts) */
  onCall?: (c: CallInfo) => void;
}

export function syncProvider(c: SyncConfig): Provider {
  let listed: Promise<void> | undefined; // D-47: one list call per provider, before the first request
  const clock = c.clock ?? Date.now;
  return async (tier, tickets) => {
    const results = new Map<string, BatchResult>();
    if (!tickets.length) return results;
    await (listed ??= assertModelsListed(c.client, c.models));
    for (const r of buildRequests(tier, tickets, c)) {
      const startedMs = clock();
      const message = await c.client.messages.create(r.params);
      const endedMs = clock();
      const line = JSON.stringify({ custom_id: r.custom_id, result: { type: 'succeeded', message } });
      c.onCall?.({ tier, ticketId: r.custom_id, startedMs, endedMs, line });
      const { results: parsed, errors } = parseResults(line);
      if (errors.length) throw new Error(`messages ${r.custom_id}: ${errors[0]!.code} ${errors[0]!.detail}`);
      results.set(r.custom_id, parsed.get(r.custom_id)!);
    }
    return results;
  };
}

/** Refuses unless TRIAGE_LIVE=1 and a key are both set (D-19), as liveFromEnv does; nothing is constructed or sent otherwise. */
export function messagesFromEnv(env: Record<string, string | undefined>, c: Omit<SyncConfig, 'client'>): Provider {
  return syncProvider({ ...c, client: new Anthropic({ apiKey: assertLiveEnv(env) }) });
}
