// Shapes of the three policy data files (task 1.4), in the validate.ts subset. Structural only:
// label lists, route names and model ids stay data (non-negotiable 4), so no enum here repeats them.
// Every object is closed, so a misspelt key fails lint instead of being silently ignored.
import type { Schema } from './validate.js';

const str: Schema = { type: 'string' };
const int: Schema = { type: 'integer' };
const bool: Schema = { type: 'boolean' };
const arr = (items: Schema): Schema => ({ type: 'array', items });
const map = (values: Schema): Schema => ({ type: 'object', additionalProperties: values });
const obj = (properties: Record<string, Schema>, optional: string[] = []): Schema => ({
  type: 'object', properties, additionalProperties: false,
  required: Object.keys(properties).filter((k) => !optional.includes(k)),
});

const tier = obj({ model: str, role: str });

export const POLICY_SCHEMA = obj({
  version: str, description: str,
  labels: obj({ category: arr(str), priority: arr(str), route: arr(str) }),
  supported_languages: arr(str),
  tiers: obj({ A: tier, B: tier }),
  escalate_to_tier_b_when: obj({ min_confidence_bps_below: int, category_in: arr(str), tier_a_failed: bool }),
  needs_human_when: obj({
    model_says_needs_human: bool, priority_in: arr(str), category_in: arr(str), final_min_confidence_bps_below: int,
    screen_flagged: bool, language_not_supported: bool, final_tier_failed: bool,
  }),
  route_by_category: map(str),
  // triagelib.route_for: a missing `when` key matches any value.
  route_overrides: arr(obj({ when: obj({ category: str, priority: str }, ['category', 'priority']), route: str, why: str })),
  spam_floor: obj({ category: str, priority: str, route: str, note: str }),
  audit_sample_bps: int, audit_sample_note: str,
});

export const DRIFT_SCHEMA = obj({
  version: str, description: str, baseline: str, min_window_items: int,
  signals: arr(obj({
    id: str, kind: { type: 'string', enum: ['distance', 'delta', 'absolute'] }, field: str, threshold_bps: int, what: str,
  }, ['field'])),
});

export const PRICES_SCHEMA = obj({
  version: str, source: str, model_ids_source: str, read_on: str, unit: str,
  batch_multiplier: obj({ num: int, den: int }), batch_multiplier_note: str,
  models: map(obj({
    display: str, prompt_tokens_max: int, prompt_tokens_min_exclusive: int,
    input: int, output: int, cache_write_5m: int, cache_write_1h: int, cache_read: int, min_cacheable_tokens: int,
  }, ['prompt_tokens_max', 'prompt_tokens_min_exclusive'])),
  notes: arr(str),
});
