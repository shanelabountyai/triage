// triage:serve [-- --port N --ledger <jsonl> --data <dir>] — task 3.4 (D-56). The triage.http.v1 handler for N9.
// Port 6300 is the project default (the table in ~/.claude/CLAUDE.md); PORT or --port overrides it. Loads .env.local for
// TRIAGE_HTTP_TOKEN and the live gate (D-40); the token is never printed. A live POST still needs TRIAGE_LIVE=1, a key and
// cap headroom inside triageRun; nothing here relaxes a cap, and the OVER_CAP latch can only be acknowledged from triage:run.
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { capsFromEnv } from '../src/io/caps.js';
import { CONTRACT, createTriageServer } from '../src/io/http.js';
import { liveFromEnv } from '../src/providers/live.js';

const DEFAULT_PORT = 6300;
const { values: v } = parseArgs({ options: {
  port: { type: 'string' }, ledger: { type: 'string', default: 'data/runs.jsonl' }, data: { type: 'string', default: 'data/http' },
} });
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const port = Number(v.port ?? process.env['PORT'] ?? DEFAULT_PORT);
try {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`PORT_INVALID: ${JSON.stringify(v.port ?? process.env['PORT'])}`);
  const server = createTriageServer({ token: process.env['TRIAGE_HTTP_TOKEN'] ?? '', ledgerPath: v.ledger, dataDir: v.data,
    live: (c) => liveFromEnv(process.env, c), caps: capsFromEnv(process.env) });
  server.listen(port, () => console.log(`triage:serve ${CONTRACT} on http://localhost:${port} · ledger ${v.ledger} · runs under ${v.data} · live needs TRIAGE_LIVE=1, a key and cap headroom (D-19)`));
} catch (e) {
  console.error(`triage:serve refused: ${(e as Error).message}`);
  process.exit(1);
}
