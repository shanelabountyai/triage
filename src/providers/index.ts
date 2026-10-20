// Three providers behind one type (PRD, D-2, D-9): `scripted` replays the fixture files,
// `recorded` replays a saved run, `live` will call the Message Batches API in Phase 2 and does
// not exist before then. The stub-behind-one-interface pattern is Use-Case Studio
// src/lib/kickoff/provider.ts (`getProvider` returning a stub or the real client); see D-35.
// Every provider returns Message Batches result lines, so the pipeline cannot tell them apart.
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { readResults } from '../io/results.js';
import type { ResultLine } from '../pipeline/parse.js';
import type { Tier } from '../pipeline/types.js';

export type ProviderName = 'scripted' | 'recorded' | 'live';
export const PROVIDERS: readonly ProviderName[] = ['scripted', 'recorded', 'live'];

export interface Provider {
  name: ProviderName;
  /** True when results are priced as a Message Batch (all three providers model the Batches path, O-4). */
  batch: boolean;
  /** One result line per requested ticket id that the provider has; a missing id becomes the failure "missing". */
  results(tier: Tier, ticketIds: readonly string[]): Promise<Map<string, ResultLine>>;
  /** Where the result lines came from, for the ledger row. */
  source(tier: Tier): string;
}

export class ProviderError extends Error {
  constructor(readonly code: string, message: string) {
    super(`${code}: ${message}`);
  }
}

/** A provider that replays two committed results files. Only the requested ids are returned, as a live batch would. */
function replay(name: 'scripted' | 'recorded', files: Record<Tier, string>): Provider {
  for (const f of Object.values(files)) if (!existsSync(f)) throw new ProviderError('RESULTS_NOT_FOUND', `${name} provider: ${f} does not exist`);
  return {
    name,
    batch: true,
    source: (tier) => files[tier],
    async results(tier, ids) {
      const { results, errors } = readResults(files[tier]);
      if (errors.length) throw new ProviderError('RESULTS_INVALID', `${files[tier]}: ${errors.map((e) => `line ${e.line} ${e.code} ${e.detail}`).join('; ')}`);
      const want = new Set(ids);
      return new Map([...results].filter(([id]) => want.has(id)));
    },
  };
}

export interface ProviderOptions {
  /** The ticket file; `scripted` finds `scripted_tier{A,B}_<name>.jsonl` beside `tickets_<name>.jsonl`. */
  input: string;
  /** `recorded`: a directory holding tierA.jsonl and tierB.jsonl (recordings/<run>/, Phase 2). */
  recording?: string;
  env?: Record<string, string | undefined>;
}

export function getProvider(name: string, opts: ProviderOptions): Provider {
  switch (name) {
    case 'scripted': {
      const m = /^tickets_(.+)\.jsonl$/.exec(basename(opts.input));
      if (!m) throw new ProviderError('SCRIPTED_INPUT', `scripted provider needs an input named tickets_<name>.jsonl, got ${opts.input}`);
      const dir = dirname(opts.input);
      return replay('scripted', { A: join(dir, `scripted_tierA_${m[1]}.jsonl`), B: join(dir, `scripted_tierB_${m[1]}.jsonl`) });
    }
    case 'recorded': {
      if (!opts.recording) throw new ProviderError('RECORDING_REQUIRED', 'recorded provider needs --recording <dir> with tierA.jsonl and tierB.jsonl');
      return replay('recorded', { A: join(opts.recording, 'tierA.jsonl'), B: join(opts.recording, 'tierB.jsonl') });
    }
    case 'live': {
      // D-2: needs TRIAGE_LIVE=1 and a key, never selected by a test, and absent before Phase 2.
      const env = opts.env ?? {};
      if (env['TRIAGE_LIVE'] !== '1' || !env['ANTHROPIC_API_KEY']) {
        throw new ProviderError('LIVE_REFUSED', 'the live provider needs TRIAGE_LIVE=1 and ANTHROPIC_API_KEY');
      }
      throw new ProviderError('LIVE_NOT_AVAILABLE_IN_PHASE_1', 'the live provider arrives in Phase 2 with @anthropic-ai/sdk; nothing was sent');
    }
    default:
      throw new ProviderError('UNKNOWN_PROVIDER', `unknown provider ${JSON.stringify(name)}; one of ${PROVIDERS.join(', ')}`);
  }
}
