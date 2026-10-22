// Where tier results come from (task 1.9). One type, three providers: `scripted` replays fixtures/,
// `recorded` replays recordings/ (written by the Phase 2 recorder), `live` (src/providers/live.ts) submits Batches.
// The stub-behind-one-type pattern is from use-case-studio src/lib/kickoff/provider.ts (D-35).
import { basename, dirname, join } from 'node:path';
import type { Ticket } from '../io/tickets.js';
import { readResults } from '../io/results.js';
import type { BatchResult } from '../pipeline/parse.js';

export type Tier = 'A' | 'B';
/** Result lines for exactly these tickets; a ticket with no line is absent (tierResult calls it `missing`). */
export type Provider = (tier: Tier, tickets: Ticket[], inPath: string) => Promise<Map<string, BatchResult>>;
export const PROVIDERS = ['scripted', 'recorded', 'live'] as const;
export type ProviderName = (typeof PROVIDERS)[number];

const replay = (file: (tier: Tier, inPath: string) => string): Provider => async (tier, tickets, inPath) => {
  const path = file(tier, inPath);
  const { results, errors } = readResults(path);
  if (errors.length) throw new Error(`${path}: ${errors.length} bad result line(s), first: line ${errors[0]!.line} ${errors[0]!.code} ${errors[0]!.detail}`);
  const ids = new Set(tickets.map((t) => t.ticket_id));
  return new Map([...results].filter(([id]) => ids.has(id)));
};

/** fixtures/tickets_batch1.jsonl → fixtures/scripted_tier{A,B}_batch1.jsonl */
function stem(inPath: string): string {
  const m = /^tickets_(.+)$/.exec(basename(inPath));
  if (!m) throw new Error(`replay input must be named tickets_<name>.jsonl, got ${basename(inPath)}`);
  return m[1]!;
}

export function provider(name: ProviderName): Provider {
  switch (name) {
    case 'scripted': return replay((tier, p) => join(dirname(p), `scripted_tier${tier}_${stem(p)}`));
    case 'recorded': return replay((tier, p) => join('recordings', stem(p).replace(/\.jsonl$/, ''), `tier${tier}.jsonl`));
    // only triageRun builds the live provider, behind the D-19 projection (task 2.3); the eval never reaches it
    case 'live': return async () => { throw new Error('LIVE_ONLY_VIA_RUN: the live provider is reached only through triage:run, behind the D-19 caps; nothing was sent'); };
  }
}
