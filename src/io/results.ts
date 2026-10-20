// Message Batches results reader (D-9). One shape for scripted, recorded and live results. A malformed
// line is a typed error, not a guess: cost is computed from these usage fields, so none is defaulted
// except the cache counters the API omits when no cache was touched.
import { readFileSync } from 'node:fs';
import type { BatchResult, Usage } from '../pipeline/parse.js';

export type ResultCode = 'RESULT_JSON' | 'RESULT_SHAPE' | 'RESULT_DUPLICATE_ID';
export interface ResultError { line: number; code: ResultCode; detail: string }

const TYPES = new Set(['succeeded', 'errored', 'expired', 'canceled']);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const count = (v: unknown, dflt?: number): number | null =>
  v === undefined && dflt !== undefined ? dflt : Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : null;

function usageOf(u: unknown): Usage | string {
  if (!isObj(u)) return 'usage is not an object';
  const input = count(u['input_tokens']);
  const output = count(u['output_tokens']);
  const cacheRead = count(u['cache_read_input_tokens'], 0);
  const created = count(u['cache_creation_input_tokens'], 0);
  if (input === null || output === null || cacheRead === null || created === null) return 'usage token count missing or not a non-negative integer';
  const cc = u['cache_creation'];
  if (cc === undefined) return { input, cacheRead, cacheCreation5m: created, cacheCreation1h: 0, output };
  if (!isObj(cc)) return 'usage.cache_creation is not an object';
  const w5 = count(cc['ephemeral_5m_input_tokens'], 0);
  const w1 = count(cc['ephemeral_1h_input_tokens'], 0);
  if (w5 === null || w1 === null || w5 + w1 !== created) return 'usage.cache_creation does not sum to cache_creation_input_tokens';
  return { input, cacheRead, cacheCreation5m: w5, cacheCreation1h: w1, output };
}

function resultOf(o: unknown): BatchResult | string {
  if (!isObj(o) || typeof o['custom_id'] !== 'string') return 'no custom_id';
  const res = o['result'];
  if (!isObj(res) || !TYPES.has(res['type'] as string)) return 'result.type not one of succeeded/errored/expired/canceled';
  const customId = o['custom_id'];
  const type = res['type'] as BatchResult['type'];
  if (type !== 'succeeded') return { customId, type, model: null, text: null, usage: null };
  const m = res['message'];
  if (!isObj(m) || typeof m['model'] !== 'string' || !Array.isArray(m['content'])) return 'succeeded without message.model and message.content';
  const usage = usageOf(m['usage']);
  if (typeof usage === 'string') return usage;
  const text = m['content'].filter((b) => isObj(b) && b['type'] === 'text' && typeof b['text'] === 'string').map((b) => b['text']).join('');
  return { customId, type, model: m['model'], text, usage };
}

export function parseResults(text: string): { results: Map<string, BatchResult>; errors: ResultError[] } {
  const results = new Map<string, BatchResult>();
  const errors: ResultError[] = [];
  text.split('\n').forEach((raw, i) => {
    const line = i + 1;
    if (raw.trim() === '') return;
    let o: unknown;
    try {
      o = JSON.parse(raw);
    } catch (e) {
      errors.push({ line, code: 'RESULT_JSON', detail: (e as Error).message });
      return;
    }
    const r = resultOf(o);
    if (typeof r === 'string') errors.push({ line, code: 'RESULT_SHAPE', detail: r });
    else if (results.has(r.customId)) errors.push({ line, code: 'RESULT_DUPLICATE_ID', detail: r.customId });
    else results.set(r.customId, r);
  });
  return { results, errors };
}

export const readResults = (path: string) => parseResults(readFileSync(path, 'utf8'));
