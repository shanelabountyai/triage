// ledger:show [-- --ledger <jsonl>] [--run <run_id>] — task 3.1. The ledger as a table; --run adds that run's decisions summary.
import { parseArgs } from 'node:util';
import { ledgerTable, runDetail } from '../src/io/ledger.js';

const { values: v } = parseArgs({ options: { ledger: { type: 'string', default: 'data/runs.jsonl' }, run: { type: 'string' } } });
try {
  console.log((v.run ? runDetail(v.ledger, v.run) : ledgerTable(v.ledger)).join('\n'));
} catch (e) {
  console.error(`ledger:show refused: ${(e as Error).message}`);
  process.exit(1);
}
