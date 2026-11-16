// Cost from usage fields and the price table (CLAUDE.md non-negotiable 7, brief §8). Ported from
// triagelib.price_row / cost_pico / est_tokens; shape from opsagent src/opsagent/models.py cost_usd,
// forked for bigint pico, the 1h cache write and the batch multiplier (D-34).
import { ceilDiv, roundHalfUp } from './num.js';
import type { Usage } from './parse.js';

export interface PriceRow {
  prompt_tokens_max?: number;
  input: number; output: number; cache_write_5m: number; cache_write_1h: number; cache_read: number;
}
export interface Prices { batch_multiplier: { num: number; den: number }; models: Record<string, PriceRow> }

/** The row for a model at this request's total input tokens. An unknown model id throws; never guess a price. */
export function priceRow(model: string, totalInputTokens: number, prices: Prices): PriceRow {
  const row = prices.models[model];
  if (!row) throw new Error(`COST_UNKNOWN_MODEL: no price for ${JSON.stringify(model)}`);
  if (row.prompt_tokens_max !== undefined && totalInputTokens > row.prompt_tokens_max) {
    const long = prices.models[`${model}:long`];
    if (!long) throw new Error(`COST_UNKNOWN_MODEL: no long-prompt row for ${model}`);
    return long;
  }
  return row;
}

/** pico-USD for one response. Null usage (no response) costs 0, but the model must still be priced. */
export function costPico(model: string, usage: Usage | null, batch: boolean, prices: Prices): bigint {
  const u = usage ?? { input: 0, cacheRead: 0, cacheCreation5m: 0, cacheCreation1h: 0, output: 0 };
  const row = priceRow(model, u.input + u.cacheRead + u.cacheCreation5m + u.cacheCreation1h, prices);
  const b = BigInt;
  const total = b(u.input) * b(row.input) + b(u.cacheRead) * b(row.cache_read) + b(u.cacheCreation5m) * b(row.cache_write_5m)
    + b(u.cacheCreation1h) * b(row.cache_write_1h) + b(u.output) * b(row.output);
  if (!batch) return total;
  const m = prices.batch_multiplier;
  return roundHalfUp(total * b(m.num), b(m.den));
}

/** ESTIMATE, not a measurement: ceil(utf-8 bytes / 4). Only for the pre-submit cap projection. */
export function estTokens(text: string): number {
  return Number(ceilDiv(BigInt(new TextEncoder().encode(text).length), 4n));
}

/** CEILING, not a measurement (D-19, D-40 item 3): per request, the prefix is written to the 1h cache (the cache is
 *  assumed to miss), the user turn is input by estTokens, and the whole max_tokens allowance is output. Batch prices
 *  unless `batch` is false (the synchronous `messages` path, task 3.5, pays standard prices). */
export function projectPico(model: string, prefix: string, userTurns: string[], maxTokens: number, prices: Prices, batch = true): bigint {
  const write = estTokens(prefix);
  return userTurns.reduce((s, u) => s + costPico(model,
    { input: estTokens(u), cacheRead: 0, cacheCreation5m: 0, cacheCreation1h: write, output: maxTokens }, batch, prices), 0n);
}
