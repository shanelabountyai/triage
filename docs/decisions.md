# Triage — Resolved Decisions & Open Items

The PRD leaves several rules open. The golden tickets and measurements in `docs/domain-brief.md` §10–§11 encode the answers below. If you change a decision, change `tools/triagelib.py`, the data file, the brief and the fixtures deliberately, not the tests. **This file outranks PRD text.**

## Resolved

### Owner decisions (Shane, 2026-10-19)

| # | Decision | Why |
|---|----------|-----|
| D-1 | **Tickets are synthetic with hard cases injected on purpose and a ground-truth answer key.** `tools/build_fixtures.py` (Python 3, stdlib, a test oracle never imported by product code) generates two batches for the fictional company Fernwick: batch 1 (700, baseline mix) and batch 2 (500, a drifted mix: outage surge, more non-English, a new "waitlist" topic). Hard cases per brief §3: ambiguous, multi-issue, injection text, non-English, churn/legal threat, new topic, spam. Seed 20261019; sha256 of every file in brief §12 and `fixtures/MANIFEST.json`. | No real inbox, ever. A key is the only way to report precision, recall and the needs_human miss count as numbers |
| D-2 | **No test or CI path calls the Claude API.** Tier results are replayed from committed files in the Message Batches results shape: `fixtures/scripted_tier*.jsonl` (from `tools/scripted_model.py`, a designed error model) until Phase 2, then `recordings/` (real responses, recorded once under the cap). The `live` provider needs `TRIAGE_LIVE=1`, a key, and is never selected by a test. | Tokens cost money and nondeterminism costs time; opsagent D-12 and Use-Case Studio's stub-provider pattern |
| D-3 | **Stack: TypeScript on Node 22, no framework, no database, not a saas-foundation clone.** vitest for tests, `tsx` to run scripts, `@anthropic-ai/sdk` as the only runtime dependency and only from Phase 2. State is append-only JSONL under `data/` (run ledger, overrides) and `recordings/`. A `node:http` handler for N9 lands in Phase 3. Python only in `tools/`. | The product is a batch step with no users, orgs, UI or billing; the foundation's weight would hide the lesson. TypeScript keeps it consistent with the repos N9 and A4 will sit beside. Postgres is a seam: the ledger's row shape is the table |
| D-4 | **Model pinned to Claude Fable 5.1** (`claude-fable-5-1`) in `.claude/settings.json` for specs and build. The *pipeline's* models are O-1 and live in `routing/policy.v1.json`, never in code. | Owner's call; the build model and the product model are different questions |
| D-5 | **Public repo.** No secrets; `.env.example` carries variable names only; `.gitignore` covers `.env`, `.env.*`, `*.pem`, `*.key`, `data/` and `recordings/scratch/`; recordings are committed per run on purpose (D-2). The first push and every push after runs `git ls-files | grep -iE "\.env$|secret|credential|\.pem$|\.key$"` and expects only `.env.example`. | The build log links here |

### Vocabulary and contracts

| # | Decision | Why |
|---|----------|-----|
| D-6 | **Labels are a closed vocabulary as data** in `routing/policy.v1.json`: 10 categories, 4 priorities, 6 routes (brief §2). Adding a value needs a decision, a golden ticket and a prompt version bump. | Adjuster D1 reasoning; a label the prompt does not define is a label the model invents |
| D-7 | **The model returns category, priority, needs_human, each with an integer confidence in basis points, plus language, secondary_category and a one-sentence reason** (`schemas/triage.v1.json`): every key required, no nullable types, `additionalProperties: false`, enum comparison case-insensitive, confidence range checked after parsing because the API's schema subset has no numeric bounds (structured-outputs docs, read 2026-10-19). | Same schema rules as Adjuster intake rule 10 |
| D-8 | **A parse failure is a typed failure, never a default.** Codes `PARSE_JSON`, `PARSE_SHAPE`, `PARSE_MISSING:<k>`, `PARSE_EXTRA_KEY`, `PARSE_ENUM:<k>`, `PARSE_RANGE:<k>`, `PARSE_TYPE:<k>`, plus the API's `errored`, `expired`, `canceled`. Tier A failure → tier B; final-tier failure → human queue with the placeholder `OTHER/P3`, flagged `FINAL_TIER_FAILED:<code>`, counted as a failure in the eval and never as a label. | Adjuster intake rule 1 ("the model transcribes; code converts"); GT-08, GT-09 |
| D-9 | **One result shape for every provider: the Message Batches results line** (`custom_id`, `result.type ∈ succeeded/errored/expired/canceled`, `result.message.content[].text`, `result.message.usage`). The scripted model writes it, the recorder writes it, the parser reads it. `custom_id` = ticket id, checked against `^[a-zA-Z0-9_-]{1,64}$` at intake (batch-processing docs, read 2026-10-19). | The pipeline cannot tell a fixture from a recording from a live result, so the tests exercise the real parse path |
| D-10 | **Integers only.** Confidence and every share, rate and distance are basis points (0..10000). Money is pico-USD per token and per ticket (1 USD = 10^12; `$0.10/MTok` = 100,000), summed as integers (BigInt in TypeScript), shown as cents per 1,000 tickets. One `roundHalfUp` over an exact rational, in one module, used once per printed number. | LoanBook rule 4/5; pico keeps every listed price and the 50% batch multiplier integer |
| D-11 | **Prices are data with a source and a read date** (`pricing/prices.v1.json`: platform.claude.com pricing and models pages, read 2026-10-19). Per model: input, output, 5m write, 1h write, cache read; the batch multiplier 1/2 applies to all usage; Haiku 5.5 has a second row for prompts over 100,000 tokens picked by the request's total input tokens. An unknown model id raises; nothing guesses. | Shane's money; opsagent `models.py` lineage; the Haiku rule is on the pricing page |

### Routing policy

| # | Decision | Why |
|---|----------|-----|
| D-12 | **Two tiers, both read from the policy:** A = `claude-haiku-5-5` for every ticket, B = `claude-sonnet-5-5` for escalations. Escalate when the tier-A **minimum** of the three confidence fields is below 7500 bps (O-3), or the category is PRIVACY_DATA or OUTAGE, or tier A failed. Tier B's labels replace tier A's when it runs. | The minimum, not the category confidence alone, because a wrong priority on a P1 is the expensive error (GT-14). Privacy and outage always get the stronger model because their cost of error is not symmetric |
| D-13 | **The model is not asked for route.** Route = `route_by_category[category]` plus override rows (`ACCOUNT_ACCESS` at P1 → TRUST_PRIVACY). A route is a team's name and a team's name is Mei's to change without a prompt edit. | One fewer field to be wrong about; the table is readable by the support lead; GT-11 |
| D-14 | **needs_human is the union of a closed rule set** (policy `needs_human_when`): the model said so; priority P1; category PRIVACY_DATA; final minimum confidence below 6000; the screen fired; language not in `supported_languages` (en); the final tier failed. Reasons are listed on the decision in rule order. SPAM is floored to P4/NONE and auto-handled unless another rule fires. | Every rule names why a person sees a ticket; the false-negative count is the headline error (P0-7) |
| D-15 | **The screen is code, runs before the model, and never changes a label.** Ported from opsagent `src/opsagent/screen.py` (role marker, fake tool output, addressed-to-agent, override, approval claim) plus three rules for this pipeline's surface (label directive, harness names, exfiltration). A hit → `INJECTION_SUSPECTED` and needs_human. One hit per rule. The eval prints model-level compliance (the tier output what the attacker asked for) and system-level compliance (the final output matched the attacker and no person saw it) as two numbers, never blended. | opsagent redteam two-number discipline; the code layer does not depend on the model obeying the prompt's data policy |
| D-16 | **Thresholds are chosen on the dev split and reported on the test split.** Each ticket's split is `sha256("split:" + ticket_id)` first 8 hex mod 100 < 60 → dev. The eval prints the sweep (T = 6000..9500) on dev only and the policy T on test. Changing T, the prompt, the schema or a model id ships with a fresh `docs/EVAL.md`. | Adjuster D91 rule 9: the test split is never used to choose a prompt, tier or threshold |

### Batches, caching, cost

| # | Decision | Why |
|---|----------|-----|
| D-17 | **Live path uses the Message Batches API, one batch per (tier, run), cached prefix with `ttl: "1h"`.** The prefix = system prompt + output schema, byte-identical across every request in the batch (asserted in code). Limits from the docs (read 2026-10-19): 100,000 requests or 256 MB per batch, results within 24 hours or the request expires, results downloadable for 29 days, 50% off all usage; caching inside batches is best-effort and the docs recommend the 1-hour TTL because a batch can outlive 5 minutes. `max_tokens: 0` pre-warming is not available in batches. Structured output via `output_config.format` with `type: json_schema`. | The card's point: a pipeline step, not a call per click. 1h costs 2× base to write once and 0.1× (Haiku) to read 1,199 times |
| D-18 | **Cost is computed from usage fields only:** `input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` split by `cache_creation.ephemeral_1h_input_tokens` / `ephemeral_5m_input_tokens`, `output_tokens`, each × its price row, × 1/2 when the run was a batch. Printed per ticket (pico), per run (cents) and per 1,000 tickets (cents); the cache-read share of input tokens is printed beside it. Token *estimates* (`ceil(bytes/4)`) appear only in the scripted fixtures and the pre-run projection, labelled "estimate". | A cost nobody can reproduce from the bill is a guess |
| D-19 | **Hard caps.** `TRIAGE_RUN_CAP_CENTS` default 200: before submit, project (estimated tokens × price, cache assumed to miss) and refuse if over; after results, sum real cost and if over mark the run `OVER_CAP` and refuse further live runs until `--acknowledge-over-cap`. `TRIAGE_PROJECT_CAP_CENTS` default 1500 over the whole ledger. No override flag removes a cap; a higher cap is a config change recorded here. | opsagent D-5/D-23 lineage; the projection refuses early, the ledger refuses late |

### Drift and overrides

| # | Decision | Why |
|---|----------|-----|
| D-20 | **Eight drift signals as data** (`monitoring/drift.v1.json`), all in bps, each with a threshold and a kind: *distance* (total variation distance of the category and priority mix vs. baseline), *delta* (override rate, escalation share, human-queue share, low-confidence share, unsupported-language share, each minus the baseline's), *absolute* (parse-failure rate). A signal fires at `value ≥ threshold`; a window with fewer than 100 items never fires. TVD is exact-then-rounded: `round_half_up(10000 × Σ|a_i/n_a − b_i/n_b| / 2)`. Prompt, schema, model id and policy are content-hashed and the hash is on every ledger row, so a change in them is visible next to any change in the signals. | A mix that moves 10 points, a queue that grows 8 points or an override rate up 5 points is something Mei wants to hear about from the system, not from Tomas |
| D-21 | **Override rate is measured on human-touched items only:** the human queue plus a reproducible audit sample (`sha256(seed:audit:ticket_id)` mod 10000 < 1000, i.e. 10%) of auto-handled tickets; an override is a category or priority that the person changed. On the fixtures the answer key stands in for the person (O-6). | Only a person's correction is an override; the audit sample is what makes the rate say anything about auto-handled tickets, and on the fixtures it did not fire when the mix signals did (brief §11) — a lagging signal, which is the point of having eight |

### Evaluation

| # | Decision | Why |
|---|----------|-----|
| D-22 | **`triage:eval` reports the same fields as `tools/reference_pipeline.py`** and must reproduce `fixtures/decisions_batch{1,2}.csv` ticket for ticket; CI fails on drift. Targets are stated as targets: needs_human recall ≥ 0.98, P1 missed = 0, delivered category accuracy ≥ 0.95 on the test split. Kickoff reference (scripted): batch 1 needs_human recall 99.01% (2 fn), P1 missed 0, delivered accuracy 97.60%, test split 97.25%; batch 2 100.00% (0 fn), 0, 96.46%. | PRD goals 4 and 7 |
| D-23 | **Scripted numbers are labelled as plumbing checks.** Every print, write-up and commit message that quotes a number from the scripted fixtures says: scripted model, designed error rates, same author; the real numbers arrive with the Phase 2 recordings and are reported beside them, never instead of them. | Overclaiming is the failure mode this owner cares most about; Housefile D-30 |
| D-24 | **Shane reads 30 human-queue tickets by hand** (Phase 2 task 2.6) from the first recorded run and records, per ticket, whether a person needed to see it and why, in `eval/labels/shane-30.json`. The eval prints agreement with the pipeline's reasons and the share he would have auto-handled. Then O-3 and the needs_human rules are re-decided. | A person checks the queue, not the generator |
| D-25 | **Fixtures are committed in full (2.3 MB)**, not samples: the scripted tier files are the replay source for every test and must be present on a clean checkout. `fixtures/samples/` holds the reference output only. | D-2 depends on it |
| D-26 | **Data-file hashes at kickoff** (sha256, checked by `policy:lint` and printed by the eval header): `routing/policy.v1.json` `1853dfe9c9193911b9f324fe132f6684016cd4d66dec2d8f4f8d6036b954722b` · `monitoring/drift.v1.json` `6df58154d1c2be79790cc6720ef801bfac9c2eb0f9000a55dc8cae75f3c0dc41` · `pricing/prices.v1.json` `bc2d7fed5aadcda19a062c4014416b233f22946a6fd0f4cbb1c1cbef18c76b33` · `schemas/triage.v1.json` `c94a2c1d4e8d03524a3e810437366b84fa34e852af015bec0676dc5b2bf35569` · `prompts/classify.v1.md` `97b5dcb644b00236fa7c8a8c57aad1b4266b000c04ad012056a45c0d4f6b5918`. A change to any of them updates this row in the same commit. | The hash on every ledger row has to mean something |

## Open — need Shane's call (defaults are in force until changed)

| # | Question | Default | Why it's open |
|---|----------|---------|---------------|
| O-1 | Model pair for tiers A and B | **`claude-haiku-5-5` / `claude-sonnet-5-5`** (ids from the models overview, read 2026-10-19) | Cheapest sensible pair: Haiku at $0.10/$0.50 per MTok, Sonnet at $2/$10, halved in batches. Opus 5.5 as a third tier for PRIVACY_DATA is P1. Confirm the ids against `models.list()` before the first live call |
| O-2 | Live API key and caps | **No key until Phase 2; `TRIAGE_RUN_CAP_CENTS=200`, `TRIAGE_PROJECT_CAP_CENTS=1500`** | Projected Phase 2 recording of both batches on the default pair: under 1 dollar at batch prices by the scripted token estimates (26–32 cents per 1,000); the cap is 6× that so a wrong model id or a cache miss is caught, not a loop |
| O-3 | Escalation threshold T | **7500 bps** | Chosen on the scripted dev split (brief §11 sweep); re-choose on the first recordings, report on test |
| O-4 | Live path: Batches or Messages | **Batches** | N9 may want a synchronous path for a single ticket; a `messages` provider with the same cached prefix is a seam, priced at standard rates |
| O-5 | Drift thresholds | **As in `drift.v1.json`** (1000 / 500 / 800 / 800 / 800 / 500 / 200 bps) | Set by hand, checked only against the scripted batch 2; re-set after the first recorded week |
| O-6 | Who is the human in the override signal | **The answer key, assumed perfect** | A real reviewer disagrees with the key sometimes; two-reviewer agreement is P1 |
| O-7 | Cache TTL | **1h** | 5m is cheaper to write (1.25× vs 2×) and would hit if the batch finishes fast; measured in cents in Phase 4 |
| O-8 | Non-English tickets | **Human queue, labelled by the model anyway** | Translation or a multilingual prompt is a seam; Fernwick supports English only by its own fiction |
| O-9 | What N9 receives | **The decisions JSONL contract as is** | N9's kickoff may want the reason and flags shaped differently; the contract is versioned |
| O-10 | Batch cadence and the P1 latency problem | **Submit a batch every 15 minutes; the ledger records submit-to-result latency per run (p50/p95, integer seconds) from Phase 2; N9 gets a synchronous `messages` provider (standard prices, same cached prefix) in Phase 3 for tickets it marks time-sensitive** | The docs say most batches finish within an hour and any request can wait up to 24 hours; a P1 outage ticket cannot. The batch path is for volume, the sync path for urgency, and the measured latency says where the line is |

## Not modeled (seams only)

Reply drafting (A4) · actions on accounts · a ticket UI · fine-tuning · translation · paging/alerting · a database · auth and tenancy · per-category thresholds · a third tier · reviewer agreement.

## Review log (2026-10-19)

### Build findings (from running the oracle while writing the kit)

| Finding | How found | Outcome |
|---|---|---|
| Three of 21 injection tickets in batch 1 did not contain the injection text at all: the generator's mid-body placement silently did nothing when the body had no ". " | Reading the reference output: the screen "missed" 3 and one attacker "succeeded" at system level | Generator falls back to appending and asserts the text is present; regenerated; screen 21/21, system-level 0 |
| Escalation share 65.71% on the first scripted run: the cheap tier escalated two of three tickets, which is not a routing lesson | First reference run | Scripted confidence ranges re-designed (brief §10) to 44.57%; still a designed number |
| needs_human precision 73.96%: the scripted tier A said "needs human" wrongly on 15% of clean tickets and the queue was 38% of the batch | First reference run | Scripted `nh_ok` 0.85 → 0.93 (A), 0.90 → 0.96 (B); queue 34.43%; the brief says the fixture's hard-case density (23% of batch 1) is far above a real inbox on purpose |
| The screen returned two hits for one rule (`<tool_result>` and `</tool_result>`), which a port would reproduce by accident or not | GS-02 | One hit per rule, first match; GS-02 re-derived |
| "mark this as BILLING" was not a label directive because category names were not in the pattern | GS-03 | Category names added to `label_directive`; false positives on the 1,164 non-injection tickets: 0 |
| TVD for category and priority printed the same value (1426) | Reference output | Checked by hand on both count tables; a coincidence; after the scripted re-design they differ (1423 / 1429) |
| Tier B's cache write never appears in the eval because the scripted file puts it on its first line and the first ticket is not escalated | Reference output tokens line | Documented as a ≤1,316-token approximation in brief §10; the recorder writes real usage and the issue disappears in Phase 2 |
| Override-rate delta did not fire on the drift batch (262 bps < 500) while four other signals did (five with language) | Reference output | Kept and written up (D-21): a lagging signal is the reason for having eight; the audit sample is O-5's lever. Not taken: raising the audit sample to make the fixture fire the signal |

### Fresh-eyes review (product owner + support-operations lead lenses)

No subagent runner was available in the kickoff workspace, so the pass was done by the kit's author re-reading every document and data file against the reference output under the two lenses, after the build findings above were closed. It is a second pass, not an independent reviewer; Shane's read of the kit is the independent one.

| Finding | Lens | Outcome |
|---|---|---|
| "Seven signals" in the PRD, decisions, overlap and README; `drift.v1.json` has eight (the parse-failure rate is the eighth) | PO | Eight everywhere; PRD goal 5 says five fired, matching §11 |
| A P1 outage ticket submitted in a batch can legally wait 24 hours; nothing in the kit said how urgent tickets get through | Support ops | O-10: 15-minute cadence default, latency p50/p95 on the ledger, a synchronous provider for N9 in Phase 3 |
| `spam_floor` in the policy carried `"needs_human": false`, which read as "force false" while the rule text says "unless another rule fires" | PO, from GT-06 | Key replaced by a note; policy hash changed; fixtures regenerated |
| D-5 said `.gitignore` covers "anything under recordings/ not explicitly added"; the file ignores only `recordings/scratch/` | PO | D-5 reworded to match the file |
| "Human queue" did not say whose queue; a ticket with needs_human and route BILLING_OPS must land with billing, not in one undifferentiated pile, and route NONE items need a home | Support ops | Brief §2: queue is per route, NONE sits with TIER1; what happens to an auto-handled ticket is N9's |
| Two needs_human misses in batch 1 were both churn/ambiguity cases the model did not flag and no code rule catches | Support ops | Noted in §11 as a prompt lesson. **Not taken:** a keyword list for cancel/lawyer/regulator in the policy, because it would be written from the generator's own three sentences — the same upper-bound trap as the screen; re-decide on recordings |
| Nothing said what the ledger row records for latency, so Phase 2 could not measure O-10 | PO | Task 1.9 ledger row gains `submitted_at`, `completed_at`, `latency_s_p50`, `latency_s_p95` (null for replays) |
| The kit's template count said 53; the generator has 52 English templates | PO | Fixed |

