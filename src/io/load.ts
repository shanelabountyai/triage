// Loads the four data files and the prompt, checks each against its contract, and returns them
// with their content hashes (D-26). The pipeline receives this object; it never reads a file.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DRIFT_SCHEMA, POLICY_SCHEMA, PRICES_SCHEMA } from '../pipeline/contracts.js';
import type { DriftConfig, Policy, PolicyData, Prices } from '../pipeline/types.js';
import { schemaErrors, validate, type Schema } from '../pipeline/validate.js';
import { sha256File } from './hash.js';

export const DATA_FILES = {
  policy: 'routing/policy.v1.json',
  drift: 'monitoring/drift.v1.json',
  prices: 'pricing/prices.v1.json',
  schema: 'schemas/triage.v1.json',
  prompt: 'prompts/classify.v1.md',
} as const;

export type Hashes = Record<keyof typeof DATA_FILES, string>;

/**
 * Cross-file rules no single contract can state: every category has a route, every override and
 * the spam floor name known labels, both tier models have a price, and the result schema's enums
 * are the policy's labels. Task 1.4 left these to the stages that depend on them (D-30).
 */
export function consistencyErrors(d: PolicyData): string[] {
  const { policy: p, prices, schema } = d;
  const cats = new Set(p.labels.category), pris = new Set(p.labels.priority), routes = new Set(p.labels.route);
  const errs: string[] = [];
  for (const c of cats) if (!routes.has(p.route_by_category[c] ?? '')) errs.push(`route_by_category has no known route for ${c}`);
  for (const c of Object.keys(p.route_by_category)) if (!cats.has(c)) errs.push(`route_by_category names unknown category ${c}`);
  for (const o of p.route_overrides) {
    if (o.when.category !== undefined && !cats.has(o.when.category)) errs.push(`route override names unknown category ${o.when.category}`);
    if (o.when.priority !== undefined && !pris.has(o.when.priority)) errs.push(`route override names unknown priority ${o.when.priority}`);
    if (!routes.has(o.route)) errs.push(`route override names unknown route ${o.route}`);
  }
  if (!cats.has(p.spam_floor.category) || !pris.has(p.spam_floor.priority) || !routes.has(p.spam_floor.route)) errs.push('spam_floor names an unknown label');
  for (const t of ['A', 'B'] as const) if (!prices.models[p.tiers[t].model]) errs.push(`tier ${t} model ${p.tiers[t].model} has no price`);
  const enumOf = (k: string) => schema.properties?.[k]?.enum ?? [];
  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
  if (!same(enumOf('category'), p.labels.category)) errs.push('schema category enum differs from policy labels');
  if (!same(enumOf('priority'), p.labels.priority)) errs.push('schema priority enum differs from policy labels');
  if (!same(enumOf('secondary_category'), ['NONE', ...p.labels.category])) errs.push('schema secondary_category enum is not NONE + policy categories');
  return errs;
}

export function loadPolicyData(root = '.'): { data: PolicyData; hashes: Hashes } {
  const read = (p: string): unknown => JSON.parse(readFileSync(join(root, p), 'utf8'));
  const checked = <T>(path: string, s: Schema): T => {
    const v = read(path);
    const errs = validate(v, s);
    if (errs.length) throw new Error(`${path}: ${errs.join('; ')}`);
    return v as T;
  };
  const schema = read(DATA_FILES.schema);
  const se = schemaErrors(schema);
  if (se.length) throw new Error(`${DATA_FILES.schema}: ${se.join('; ')}`);
  const data: PolicyData = {
    policy: checked<Policy>(DATA_FILES.policy, POLICY_SCHEMA),
    drift: checked<DriftConfig>(DATA_FILES.drift, DRIFT_SCHEMA),
    prices: checked<Prices>(DATA_FILES.prices, PRICES_SCHEMA),
    schema: schema as Schema,
  };
  const ce = consistencyErrors(data);
  if (ce.length) throw new Error(`policy data inconsistent: ${ce.join('; ')}`);
  const hashes = Object.fromEntries(Object.entries(DATA_FILES).map(([k, p]) => [k, sha256File(join(root, p))])) as Hashes;
  return { data, hashes };
}
