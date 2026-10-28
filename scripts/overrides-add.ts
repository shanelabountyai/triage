// overrides:add -- --run <run_id> --ticket <ticket_id> --category <C> --priority <P> --by <name> [--ledger <jsonl>] [--overrides <jsonl>]
// Task 3.2 (D-54): one person's labels for one ticket, appended to data/overrides.jsonl; a correction is a new row (D-36).
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import type { Policy } from '../src/pipeline/decide.js';
import { addOverride } from '../src/io/overrides.js';

const { values: v } = parseArgs({ options: {
  run: { type: 'string' }, ticket: { type: 'string' }, category: { type: 'string' }, priority: { type: 'string' }, by: { type: 'string' },
  ledger: { type: 'string', default: 'data/runs.jsonl' }, overrides: { type: 'string', default: 'data/overrides.jsonl' },
} });
if (!v.run || !v.ticket || !v.category || !v.priority || !v.by) {
  console.error('usage: overrides:add -- --run <run_id> --ticket <ticket_id> --category <C> --priority <P> --by <name> [--ledger <jsonl>] [--overrides <jsonl>]');
  process.exit(2);
}
try {
  const policy = JSON.parse(readFileSync('routing/policy.v1.json', 'utf8')) as Policy;
  const row = addOverride({ ledgerPath: v.ledger, overridesPath: v.overrides, policy,
    row: { run_id: v.run, ticket_id: v.ticket, category: v.category, priority: v.priority, by: v.by, at: new Date().toISOString() } });
  console.log(`overrides:add: ${row.ticket_id} in ${row.run_id} → ${row.category}/${row.priority} by ${row.by} → ${v.overrides}`);
} catch (e) {
  console.error(`overrides:add refused: ${(e as Error).message}`);
  process.exit(1);
}
