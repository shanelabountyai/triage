// TypeScript shapes of the data files (the JSON contracts are in contracts.ts) and of the
// values that move between pipeline stages. Types only; the data stays in routing/, monitoring/,
// pricing/ and schemas/ (non-negotiable 4).
import type { Schema } from './validate.js';

export interface Policy {
  version: string;
  labels: { category: string[]; priority: string[]; route: string[] };
  supported_languages: string[];
  tiers: { A: { model: string }; B: { model: string } };
  escalate_to_tier_b_when: { min_confidence_bps_below: number; category_in: string[]; tier_a_failed: boolean };
  needs_human_when: {
    model_says_needs_human: boolean; priority_in: string[]; category_in: string[]; final_min_confidence_bps_below: number;
    screen_flagged: boolean; language_not_supported: boolean; final_tier_failed: boolean;
  };
  route_by_category: Record<string, string>;
  route_overrides: { when: { category?: string; priority?: string }; route: string }[];
  spam_floor: { category: string; priority: string; route: string };
  audit_sample_bps: number;
}

export interface DriftSignal { id: string; kind: 'distance' | 'delta' | 'absolute'; field?: string; threshold_bps: number }
export interface DriftConfig { version: string; min_window_items: number; signals: DriftSignal[] }

export interface PriceRow {
  prompt_tokens_max?: number;
  input: number; output: number; cache_write_5m: number; cache_write_1h: number; cache_read: number;
}
export interface Prices { version: string; batch_multiplier: { num: number; den: number }; models: Record<string, PriceRow> }

/** The loaded data files, as the pipeline receives them (it never reads a file itself). */
export interface PolicyData { policy: Policy; drift: DriftConfig; prices: Prices; schema: Schema }

export type Tier = 'A' | 'B';

/** One model result's usage, normalised from `usage` and `usage.cache_creation` (D-18). */
export interface Usage { input: number; cacheRead: number; cacheCreation5m: number; cacheCreation1h: number; output: number }

/** A model result the schema accepted. Enums are upper case, language lower case. */
export interface Parsed {
  category: string; category_confidence_bps: number;
  priority: string; priority_confidence_bps: number;
  needs_human: boolean; needs_human_confidence_bps: number;
  language: string; secondary_category: string; reason: string;
}

/**
 * One model call as the pipeline sees it: parsed, or a typed failure (D-8). `failure` is "" when
 * parsed; otherwise the API result type (errored, expired, canceled), "missing" when no line came
 * back for the ticket, or a PARSE_* code. `usage` is null when the API returned no message.
 */
export interface TierResult { tier: Tier; model: string; parsed: Parsed | null; failure: string; usage: Usage | null }
