// Model result parsing (brief §7, D-7, D-8, D-9). The model's text is checked against
// schemas/triage.v1.json; any miss is a typed PARSE_* code, never a default label.
//
// Check order (the first miss wins, as triagelib.parse_result): JSON → object → every required
// key (schema order) → no key outside the schema → enum strings → integer bps fields → booleans →
// plain strings. Enums compare upper-cased; language must be two letters and is lower-cased.
//
// JSON.parse cannot tell 9000 from 9000.0, and Python can (GP-08). The reviver reads each number's
// source text (Node 22+, V8's JSON.parse source access) and replaces anything that is not integer
// syntax with a NonInteger marker, which fails every type check below as a float fails in Python.
import { BPS } from './num.js';
import type { Parsed, Tier, TierResult, Usage } from './types.js';
import type { Schema } from './validate.js';

class NonInteger {
  constructor(readonly source: string) {}
}
const INTEGER_SYNTAX = /^-?(?:0|[1-9][0-9]*)$/;
const LANGUAGE = /^[a-z]{2}$/;
const MAX_BPS = Number(BPS);

type Ctx = { source?: string } | undefined;
function reviver(this: unknown, _key: string, value: unknown, ctx?: Ctx): unknown {
  if (typeof value !== 'number') return value;
  if (ctx?.source === undefined) throw new Error('JSON.parse source text access is required (Node 22+)');
  return INTEGER_SYNTAX.test(ctx.source) ? value + 0 : new NonInteger(ctx.source); // + 0 turns -0 into 0
}
const parseJson = JSON.parse as (text: string, reviver: (this: unknown, key: string, value: unknown, ctx?: Ctx) => unknown) => unknown;
parseJson('[1]', reviver); // fail closed at import if the runtime cannot report number sources

export type ParseOutcome = { ok: true; parsed: Parsed } | { ok: false; code: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof NonInteger);

/** Parse one model text block against the result schema. */
export function parseResult(text: string, schema: Schema): ParseOutcome {
  let obj: unknown;
  try {
    obj = parseJson(text, reviver);
  } catch {
    return { ok: false, code: 'PARSE_JSON' };
  }
  if (!isRecord(obj)) return { ok: false, code: 'PARSE_SHAPE' };
  const props = schema.properties ?? {};
  for (const k of schema.required ?? []) if (!Object.hasOwn(obj, k)) return { ok: false, code: `PARSE_MISSING:${k}` };
  if (Object.keys(obj).some((k) => !Object.hasOwn(props, k))) return { ok: false, code: 'PARSE_EXTRA_KEY' };

  const out: Record<string, unknown> = {};
  const fields = Object.entries(props);
  for (const [k, p] of fields.filter(([, p]) => p.type === 'string' && p.enum)) {
    const v = obj[k];
    const u = typeof v === 'string' ? v.toUpperCase() : undefined;
    if (u === undefined || !p.enum!.includes(u)) return { ok: false, code: `PARSE_ENUM:${k}` };
    out[k] = u;
  }
  for (const [k] of fields.filter(([, p]) => p.type === 'integer')) {
    const v = obj[k];
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > MAX_BPS) return { ok: false, code: `PARSE_RANGE:${k}` };
    out[k] = v;
  }
  for (const [k] of fields.filter(([, p]) => p.type === 'boolean')) {
    if (typeof obj[k] !== 'boolean') return { ok: false, code: `PARSE_TYPE:${k}` };
    out[k] = obj[k];
  }
  for (const [k] of fields.filter(([, p]) => p.type === 'string' && !p.enum)) {
    const v = obj[k];
    if (typeof v !== 'string') return { ok: false, code: `PARSE_TYPE:${k}` };
    if (k === 'language') {
      if (!LANGUAGE.test(v.toLowerCase())) return { ok: false, code: 'PARSE_TYPE:language' };
      out[k] = v.toLowerCase();
    } else out[k] = v;
  }
  return { ok: true, parsed: out as unknown as Parsed };
}

/** The minimum of the three confidence fields: what escalation and the low-confidence rule read (D-12). */
export const minBps = (p: Parsed): number =>
  Math.min(p.category_confidence_bps, p.priority_confidence_bps, p.needs_human_confidence_bps);

// ---------------------------------------------------------------- Message Batches result lines (D-9)

export type ResultType = 'succeeded' | 'errored' | 'expired' | 'canceled';
export interface ResultLine {
  custom_id: string;
  type: ResultType;
  /** Present only when type is succeeded. */
  message?: { model: string; text: string; usage: Usage };
}

/**
 * One tier's outcome for one ticket. `line` is undefined when the provider returned nothing for it.
 * A non-succeeded line keeps the policy's model id and no usage: the API does not bill errored,
 * expired or canceled requests (brief §8). A succeeded line is priced by the model it reports.
 */
export function tierResult(tier: Tier, policyModel: string, line: ResultLine | undefined, schema: Schema): TierResult {
  if (line === undefined) return { tier, model: policyModel, parsed: null, failure: 'missing', usage: null };
  if (line.type !== 'succeeded' || !line.message) return { tier, model: policyModel, parsed: null, failure: line.type, usage: null };
  const { model, text, usage } = line.message;
  const r = parseResult(text, schema);
  return r.ok
    ? { tier, model, parsed: r.parsed, failure: '', usage }
    : { tier, model, parsed: null, failure: r.code, usage };
}
