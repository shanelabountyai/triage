// Model-output parsing (task 1.6, brief §7, D-8). The text block is checked against schemas/triage.v1.json
// in the oracle's order (triagelib.parse_result): JSON → shape → missing (required order) → extra key →
// enums → integer ranges → remaining types. A miss is a typed code, never a default label.
import { BPS } from './num.js';
import { type Schema, validate } from './validate.js';

export interface Parsed {
  category: string;
  categoryBps: number;
  priority: string;
  priorityBps: number;
  needsHuman: boolean;
  needsHumanBps: number;
  language: string;
  secondaryCategory: string;
  reason: string;
}

/** Normalised from `usage` and `usage.cache_creation` (src/io/results.ts). */
export interface Usage { input: number; cacheRead: number; cacheCreation5m: number; cacheCreation1h: number; output: number }

/** One Batches result line after the reader checked its shape (D-9). */
export interface BatchResult {
  customId: string;
  type: 'succeeded' | 'errored' | 'expired' | 'canceled';
  model: string | null;
  text: string | null;
  usage: Usage | null;
}

/** A tier's outcome: parsed, or failure = the API result type, `missing`, or a PARSE_* code. */
export interface TierResult { model: string | null; parsed: Parsed | null; failure: string; usage: Usage | null }

// JSON.parse turns 9000.0 into 9000; Python keeps a float, and GP-08 says a float is PARSE_RANGE.
// The reviver's source text (ES2025, V8 ≥ 11.4) marks any non-integer literal so the integer check fails.
const FLOAT = Symbol('float');
type Reviver = (this: unknown, k: string, v: unknown, ctx?: { source?: string }) => unknown;
const markFloats: Reviver = (_k, v, ctx) => (typeof v === 'number' && /[.eE]/.test(ctx?.source ?? '') ? FLOAT : v);

export function parseResult(text: string, schema: Schema): { parsed: Parsed } | { failure: string } {
  let o: unknown;
  try {
    o = JSON.parse(text, markFloats as Parameters<typeof JSON.parse>[1]);
  } catch {
    return { failure: 'PARSE_JSON' };
  }
  if (typeof o !== 'object' || o === null || Array.isArray(o)) return { failure: 'PARSE_SHAPE' };
  const r = o as Record<string, unknown>;
  const props = Object.entries(schema.properties ?? {});
  const required = schema.required ?? [];
  const missing = required.find((k) => !Object.hasOwn(r, k));
  if (missing) return { failure: `PARSE_MISSING:${missing}` };
  if (Object.keys(r).some((k) => !required.includes(k))) return { failure: 'PARSE_EXTRA_KEY' };
  const out: Record<string, unknown> = {};
  for (const [k, p] of props.filter(([, p]) => p.enum)) {
    const v = r[k];
    const u = typeof v === 'string' ? v.toUpperCase() : v;
    if (validate(u, p).length) return { failure: `PARSE_ENUM:${k}` };
    out[k] = u;
  }
  for (const [k, p] of props.filter(([, p]) => p.type === 'integer')) {
    const v = r[k];
    if (validate(v, p).length || (v as number) < 0 || (v as number) > Number(BPS)) return { failure: `PARSE_RANGE:${k}` };
    out[k] = v;
  }
  for (const [k, p] of props.filter(([, p]) => !p.enum && p.type !== 'integer')) {
    const v = r[k];
    if (validate(v, p).length) return { failure: `PARSE_TYPE:${k}` };
    // brief §7: ISO 639-1, compared lowercase
    if (k === 'language' && !/^[a-z]{2}$/.test((v as string).toLowerCase())) return { failure: 'PARSE_TYPE:language' };
    out[k] = k === 'language' ? (v as string).toLowerCase() : v;
  }
  return {
    parsed: {
      category: out['category'] as string,
      categoryBps: out['category_confidence_bps'] as number,
      priority: out['priority'] as string,
      priorityBps: out['priority_confidence_bps'] as number,
      needsHuman: out['needs_human'] as boolean,
      needsHumanBps: out['needs_human_confidence_bps'] as number,
      language: out['language'] as string,
      secondaryCategory: out['secondary_category'] as string,
      reason: out['reason'] as string,
    },
  };
}

/** A result line (or its absence) as the policy sees it. */
export function tierResult(r: BatchResult | undefined, schema: Schema): TierResult {
  if (!r) return { model: null, parsed: null, failure: 'missing', usage: null };
  if (r.type !== 'succeeded') return { model: r.model, parsed: null, failure: r.type, usage: r.usage };
  const p = parseResult(r.text ?? '', schema);
  return 'parsed' in p
    ? { model: r.model, parsed: p.parsed, failure: '', usage: r.usage }
    : { model: r.model, parsed: null, failure: p.failure, usage: r.usage };
}
