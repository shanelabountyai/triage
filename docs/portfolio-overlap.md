# Triage — Portfolio Overlap Check

Checked 2026-10-19 against the build-log card list and the sibling repos readable from the kickoff workspace: `use-case-studio`, `opsagent`, `adjuster`, `loanbook`, `housefile` (kit), `bracketry`, `li-lead-gen-tools`. **The source trees of use-case-studio, opsagent, adjuster and loanbook were read**; the "Where" column names real paths. Purpose: keep Triage from re-teaching what a sibling built, and keep the comfortable parts (a classifier prompt, a JSON parser) from eating the new part (the LLM as a batch step with cost, routing and drift measured).

## Verdict

The card lists five chips. Read literally, two are already built somewhere:

| Card chip | Already in the portfolio? | What Triage does instead |
|---|---|---|
| classification | **Partly** — Adjuster intake extracts typed fields from documents with a schema and a confidence in bps; Use-Case Studio's planner/critic are structured-output calls | A closed-vocabulary label set as data, with the *route* derived by table rather than asked of the model, and precision/recall per label value against a key |
| batch + caching | **No.** Every sibling calls `messages.create` once per action; opsagent sets one `cache_control` breakpoint on the system block for its agent loop (D-23 there) | **New:** the Message Batches API as the primary path, one batch per tier per run, a 1h cached prefix asserted byte-identical, the cache-read share printed from usage fields |
| model routing | **No.** opsagent's ablation *compares* model tiers across whole runs; nothing routes an item to a tier by a per-item rule | **New, and the core:** cheap tier for everything, strong tier for the uncertain set, the rule as data, chosen on dev and reported on test with cost beside accuracy |
| cost per item | **Partly** — opsagent `ledger.py` + `models.py` price each run from usage and enforce a $25 build cap; Use-Case Studio `pricing.ts` prices a run flat per token | Per *item* in integer pico-USD from the full usage field set (cache read, 5m/1h write, input, output, batch multiplier), cents per 1,000 in every report, projection before and cap after |
| drift monitoring | **No.** Nothing in the portfolio compares a window of model behaviour against a baseline | **New:** eight signals as data (label-mix TVD, override rate, escalation share, queue share, low-confidence share, language share, parse failures) with thresholds and a fixture batch designed to move them |

Suggested card chips once it ships: `batches + 1h cached prefix (cache-read share printed)` · `two-tier routing, threshold chosen on dev / reported on test` · `cost per 1,000 tickets from usage fields, capped` · `needs_human recall + P1 missed as the headline` · `8 drift signals with thresholds as data`.

## Reuse — port, do not rebuild

| Capability | Donor | Where to read first | Triage use |
|---|---|---|---|
| Stub provider behind the same interface as the real one; live tests excluded by default and run only with an env flag | Use-Case Studio | `src/lib/kickoff/provider.ts` (`getProvider`, `stubPlanner`), `*.live.test.ts` headers, `vitest.config.ts` `exclude` | `scripted` / `recorded` / `live` providers behind one type; `*.live.test.ts` never run in CI |
| Structured output re-validated against the same schema after the call; one retry on a schema miss; truncation and refusal are failures | Use-Case Studio | `src/lib/kickoff/claude.ts` (`callStructured`) | Phase 2 live provider; Triage does not retry inside a batch — a failed line falls through to the next tier (D-8) |
| Golden corpus + deterministic red-team + invariants as the launch gate | Use-Case Studio | `src/lib/kickoff/harness.ts`, `invariants.ts`, `judge.ts` (judge trusted only after human agreement) | `triage:eval` shape; the D-24 hand judgements are the "human-rated set" idea |
| Price table with source URL and checked date; `cost_usd` over all usage kinds; unknown model raises | opsagent | `src/opsagent/models.py` (`PRICES`, `cost_usd`) | `pricing/prices.v1.json` + `costPico`; same "never guess" rule, pico integers instead of floats |
| Hard build cap enforced where the money is spent; projection refuses early; spend ledger as a view over an append-only log | opsagent | `src/opsagent/ledger.py` (`guard`, `replay`), its decisions D-5, D-23, D-26, D-28 | `TRIAGE_RUN_CAP_CENTS`, `TRIAGE_PROJECT_CAP_CENTS`, the `OVER_CAP` latch, `data/runs.jsonl` |
| Injection screen: regex rules over untrusted text, a hit taints the run and never blocks the read; honest scope note | opsagent | `src/opsagent/screen.py` (`RULES`, `scan`, `DATA_POLICY`) | `src/pipeline/screen.ts` with five rules kept and three added (brief §5); the prompt's data-policy paragraph |
| Red-team scored at two levels (model attempted / system let it through), each 0 explained by the layer that stopped it | opsagent | `src/opsagent/redteam.py` header and `_hit` | The injection line in `triage:eval` |
| Fake model with scripted responses, no API calls anywhere in tests | opsagent | `tests/fakes.py` | `tools/scripted_model.py` writes what a fake would say, in the API's own result shape, so the TypeScript side needs no fake at all |
| One `cache_control` breakpoint on the system block so every item in a run shares the prefix | opsagent | D-23 in `docs/DECISIONS.md`, `loop.py` request build | The live provider's request shape, with `ttl: "1h"` for batches |
| Typed facts from a model's text; a parse failure is a typed failure, never a default; schemas with every key required, no nullables, enum case-insensitive | Adjuster intake | `src/intake/schema.ts`, CLAUDE.md intake rules 1 and 10 | D-7, D-8; `parseResult` |
| Dev/test split by seeded hash; the test split never chooses a prompt, tier or threshold; a change ships with a fresh scorecard | Adjuster | `eval/README.md`, `eval/split.json`, CLAUDE.md intake rule 9 (D91) | D-16; the sweep on dev, the one line on test; `docs/EVAL.md` |
| Canonical JSON + sha256 content hash; safe integers only, floats throw | Adjuster | `src/rules/canonical.ts` (`canonicalJson`, `sha256Hex`) | Hashes of policy, drift, prices, schema, prompt on every ledger row |
| Money as integers, one module, one rounding rule, boundary guards that refuse non-integers | LoanBook | `src/ledger/money.ts` (`assertCents`, `assertInteger`) | `roundHalfUp`, `bps`, `picoToCents`; BigInt for pico sums |
| Frozen fixtures + Python oracle + golden answers + two-run hash check; answer key read only by the eval | Housefile kit | `tools/build_fixtures.py`, `verify_fixtures.py`, `golden_answers.py`, `reference_matcher.py`; brief §12 | Same workflow: `build_fixtures.py`, `scripted_model.py`, `reference_pipeline.py`, `golden_answers.py`, `verify_fixtures.py` |
| "Never optimal / never accurate without the number"; measured values with their denominators in screens and commits | Bracketry, Housefile | their CLAUDE.md rules | CLAUDE.md non-negotiable 9 |
| Frontmatter model tier per subagent, model pin in settings | opsagent / gridline | `.claude/settings.json` | D-4 |

## New — each with the fixture that proves it

| # | Lesson | Not in any sibling because | Proven by |
|---|---|---|---|
| 1 | The LLM as a batch step: Message Batches, one batch per tier per run, results streamed and matched by `custom_id` | Siblings call once per action | Phase 2 recording; D-9 result shape read by every test from Phase 1 |
| 2 | A cached prefix that is proven, not assumed: byte-identical across requests, `ttl: "1h"`, cache-read share printed | opsagent caches for one agent loop, never measures the hit | §11 cache-read share (94.3% on the scripted usage; real in Phase 2) |
| 3 | Two-tier routing by a per-item rule as data, with the threshold chosen on dev and reported on test, cost beside accuracy | opsagent compares tiers; nothing routes | §11 sweep; GT-02, GT-14 |
| 4 | Cost per item from the full usage field set in integer pico-USD, projection before, cap after, project cap over the ledger | opsagent prices runs in floats with one cap | GC-01..GC-09; D-19 |
| 5 | A needs_human rule set whose false-negative count is the headline, with P1-missed printed every run | Adjuster's PEND is per fact, not per item for a person | §11 needs_human fn and P1 missed |
| 6 | A screen on inbound text whose two numbers (model-level, system-level) are printed with its false positives | opsagent screens tool results, not inbound items, and prints flag rates without the FP count | §11 injection line |
| 7 | Hard cases as fixture data (ambiguous, multi-issue, injection, non-English, churn, new topic, spam) with per-kind accuracy | No sibling labels *why* an item is hard | §11 hard-case table |
| 8 | Self-reported confidence treated as a claim: calibration (ECE) measured, threshold chosen on delivered accuracy | Adjuster thresholds confidence but does not print calibration | §11 ECE |
| 9 | Drift monitoring: eight signals with thresholds as data, a window that cannot fire when small, and a fixture batch designed to move the mix | Nothing in the portfolio watches model behaviour over time | §11 drift table; GD-01..GD-12 |
| 10 | Override intake as the human signal, with an audit sample so auto-handled items are seen | Housefile's review queue records decisions, not a rate against a baseline | D-21; §11 override rates and the lag finding |
| 11 | A CI that never holds a key and never spends a token, on a project whose product is API calls | Siblings skip live tests; Triage has no live test at all until Phase 2, and then only behind a flag | D-2; CI workflow in task 1.1 |
| 12 | Thirty hand judgements of the human queue by the owner, compared with the pipeline's reasons | Siblings' oracles are the only truth | `eval/labels/shane-30.json` (Phase 2 task 2.6) |

## Guardrails — lessons Triage must not take

| Lesson | Owner | Rule here |
|---|---|---|
| Reply drafting with citations, retrieval, groundedness | A4 Footnote | Output stops at labels; no retrieval, no answer |
| Tool-using agent, proposals, human approval of writes, hash-chained audit | A2 opsagent | No tools, no writes to any system, no approval UI; the screen and the cap are the only ported defenses |
| Document extraction, OCR, per-field confidence with intervals | A3 Claims Intake (adjuster) | Input is short text; no PDFs, no images |
| Rules engine, authoring UI, impact diff | 09 Adjuster | The policy is a closed set of fields; no editor |
| Evaluation of a use case's fitness, planner/critic | Use-Case Studio | Triage does not judge whether triage is a good idea |
| Entity resolution, merge/undo | 22 Housefile | Tickets are never deduplicated |
| n8n orchestration, deflection flow, SLA, notifications | N9 | Triage exposes a CLI and (Phase 3) one HTTP contract; the flow is N9's |
| Fine-tuned or learned classifiers | — | The levers are prompt, schema, threshold, model pair; each change is a scorecard |
| Multi-tenant SaaS, auth, billing, UI | 19/20 and the foundation | Not cloned (D-3) |

## How this was checked

- Read: use-case-studio `package.json`, `vitest.config.ts`, `src/lib/kickoff/{provider,claude,pricing,limits,judge,harness.test,fixtures}.ts`, `*.live.test.ts` headers, `docs/build-kickoff/deep-dive-support-ticket-deflection/PRD.md` (N9's cousin: drafts, never auto-sends; its "no confident draft" state is Triage's needs_human); opsagent `README.md`, `src/opsagent/{screen,redteam,ledger,models}.py`, `tests/fakes.py`, `docs/DECISIONS.md` D-5/D-12/D-17/D-19/D-23/D-26/D-28/D-29; adjuster `src/rules/canonical.ts`, `src/intake/`, `eval/README.md`, CLAUDE.md intake rules; loanbook `src/ledger/money.ts`; the housefile kickoff kit in full; bracketry and li-lead-gen-tools CLAUDE.md.
- Anthropic docs read 2026-10-19 (platform.claude.com): models overview, pricing, batch processing, prompt caching, structured outputs, model ids and versions. Every number quoted from them is in brief §7–§8 and `pricing/prices.v1.json` with the URL.
- `reuse-scan.py` was not reachable from the kickoff workspace; KICKOFF step 6 runs it and records the result either way.
