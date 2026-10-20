// Cost from usage fields and the price table (brief §8, D-11, D-18). Ported from the shape of
// opsagent src/opsagent/models.py (`PRICES`, `cost_usd`: a price table keyed by model id, cost
// over the usage kinds, an unknown model raises) by way of triagelib.cost_pico; forked to
// integer pico-USD, the 1h cache write and the batch multiplier (D-27, D-34).
import { ceilDiv, roundHalfUp } from './num.js';
import type { PriceRow, Prices, Usage } from './types.js';

const big = (n: number): bigint => {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`cost: not a non-negative integer: ${n}`);
  return BigInt(n);
};

/** Total input tokens of one request: the figure Haiku's long-prompt row is chosen by. */
export const totalInput = (u: Usage): number => u.input + u.cacheRead + u.cacheCreation5m + u.cacheCreation1h;

/** The price row for a model and a request's total input tokens. Unknown model id throws; nothing guesses. */
export function priceRow(prices: Prices, model: string, totalInputTokens: number): PriceRow {
  const row = prices.models[model];
  if (row === undefined) throw new Error(`no price for model ${JSON.stringify(model)}; never guess`);
  if (row.prompt_tokens_max !== undefined && totalInputTokens > row.prompt_tokens_max) {
    const long = prices.models[`${model}:long`];
    if (long === undefined) throw new Error(`no long-prompt price for model ${model}`);
    return long;
  }
  return row;
}

/** pico-USD for one response: each usage kind × its price; × the batch multiplier, rounded half up, when batched. */
export function costPico(prices: Prices, model: string, usage: Usage, batch: boolean): bigint {
  const r = priceRow(prices, model, totalInput(usage));
  const total = big(usage.input) * big(r.input) + big(usage.cacheRead) * big(r.cache_read)
    + big(usage.cacheCreation5m) * big(r.cache_write_5m) + big(usage.cacheCreation1h) * big(r.cache_write_1h)
    + big(usage.output) * big(r.output);
  if (!batch) return total;
  const m = prices.batch_multiplier;
  return roundHalfUp(total * big(m.num), big(m.den));
}

/**
 * Token ESTIMATE, ceil(utf-8 bytes / 4): only for the pre-run projection and the scripted model,
 * never for a cost the ledger reports (D-18). Callers label it "estimate" wherever it is printed.
 */
export const estTokens = (text: string): number => ceilDiv(new TextEncoder().encode(text).length, 4);
