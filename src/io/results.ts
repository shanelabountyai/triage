// Reader for Message Batches results files (D-9): one JSON line per request with custom_id and
// result. The scripted fixtures, the Phase 2 recordings and the live provider all use this shape,
// so the pipeline cannot tell them apart. A malformed line is a typed error, never a guess; the
// model's own text is not checked here (that is parse.ts, where a bad answer is a PARSE_* code).
import { readFileSync } from 'node:fs';
import type { ResultLine, ResultType } from '../pipeline/parse.js';
import type { Usage } from '../pipeline/types.js';

export type ResultsCode = 'RESULT_JSON' | 'RESULT_SHAPE' | 'RESULT_DUPLICATE_ID';
export interface ResultsError { line: number; code: ResultsCode; detail: string }

const TYPES = new Set<string>(['succeeded', 'errored', 'expired', 'canceled']);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const count = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;

function usageOf(u: unknown): Usage | string {
  if (!isObj(u)) return 'usage is not an object';
  const opt = (k: string): unknown => u[k] ?? 0;
  for (const k of ['input_tokens', 'output_tokens']) if (!count(u[k])) return `usage.${k} is not a non-negative integer`;
  for (const k of ['cache_read_input_tokens', 'cache_creation_input_tokens']) if (!count(opt(k))) return `usage.${k} is not a non-negative integer`;
  const cc = u['cache_creation'] ?? {};
  if (!isObj(cc)) return 'usage.cache_creation is not an object';
  const h1 = cc['ephemeral_1h_input_tokens'] ?? 0;
  if (!count(h1)) return 'usage.cache_creation.ephemeral_1h_input_tokens is not a non-negative integer';
  const total = opt('cache_creation_input_tokens') as number;
  if (h1 > total) return 'usage: 1h cache writes exceed cache_creation_input_tokens';
  return {
    input: u['input_tokens'] as number,
    cacheRead: opt('cache_read_input_tokens') as number,
    cacheCreation5m: total - h1,
    cacheCreation1h: h1,
    output: u['output_tokens'] as number,
  };
}

function lineOf(o: unknown): ResultLine | string {
  if (!isObj(o)) return 'not an object';
  if (typeof o['custom_id'] !== 'string') return 'custom_id is not a string';
  const r = o['result'];
  if (!isObj(r) || typeof r['type'] !== 'string' || !TYPES.has(r['type'])) return 'result.type is not succeeded/errored/expired/canceled';
  const type = r['type'] as ResultType;
  if (type !== 'succeeded') return { custom_id: o['custom_id'], type };
  const m = r['message'];
  if (!isObj(m) || typeof m['model'] !== 'string' || !Array.isArray(m['content'])) return 'succeeded result without message.model and message.content';
  const usage = usageOf(m['usage']);
  if (typeof usage === 'string') return usage;
  // The text the model wrote: every text block, in order, joined (as the oracle reads it).
  const text = m['content'].filter((b): b is Record<string, unknown> => isObj(b) && b['type'] === 'text')
    .map((b) => (typeof b['text'] === 'string' ? b['text'] : '')).join('');
  return { custom_id: o['custom_id'], type, message: { model: m['model'], text, usage } };
}

export function parseResults(text: string): { results: Map<string, ResultLine>; errors: ResultsError[] } {
  const results = new Map<string, ResultLine>();
  const errors: ResultsError[] = [];
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
    const r = lineOf(o);
    if (typeof r === 'string') {
      errors.push({ line, code: 'RESULT_SHAPE', detail: r });
      return;
    }
    if (results.has(r.custom_id)) {
      errors.push({ line, code: 'RESULT_DUPLICATE_ID', detail: r.custom_id });
      return;
    }
    results.set(r.custom_id, r);
  });
  return { results, errors };
}

export const readResults = (path: string) => parseResults(readFileSync(path, 'utf8'));
