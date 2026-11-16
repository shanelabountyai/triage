# Hand-off to A4 Footnote

Task 3.6, D-58. What Triage hands the next step, what it keeps back, and what each field is and is not a promise of. Doc only; the shape it describes is the decisions JSONL contract as is (O-9) and `POST /triage`'s synchronous `decision` (D-57, `docs/http-contract.md`). A change to a field here is a change to O-9 and a `docs/decisions.md` entry.

Synthetic data only. Footnote drafts answers from a knowledge base; N9 (support ticket deflection, an n8n flow) joins the two. Triage's job ends at four labels, a route and a "needs a person" flag. Nothing below is a claim about a production inbox; every number names its denominator and its source (`docs/EVAL.md`).

## What Footnote receives

**Only auto-handled decisions: `needs_human: false`.** One row per ticket, the `decisions.jsonl` row unchanged, either as an element of `GET /runs/<id>`'s `decisions` array (batch path) or as `POST /triage`'s `decision` (sync path, O-10). Same row, same reader, both paths; the sync path is the batch path's bytes and gate (D-57).

The row, with what each field is good for downstream:

| Field | Type | What it is | What Footnote may do with it |
|---|---|---|---|
| `ticket_id` | string, `^[a-zA-Z0-9_-]{1,64}$` | N9's id, passed through unchanged | Join back to the ticket. Triage never rewrites it. |
| `category` | enum, `routing/policy.v1.json` `labels.category` | Final tier's label | Pick the knowledge-base slice to draft from. |
| `priority` | enum `P1`–`P4` | Final tier's label, SPAM floored to P4 | Tone and SLA are N9's; a P1 never reaches Footnote (see below). |
| `route` | enum `labels.route` | Derived from category and priority by the table, never asked of the model (D-13) | Which team's voice and macros apply. `NONE` is SPAM: nothing to draft. |
| `needs_human` | boolean | Always `false` on a row Footnote sees | A guard, not information: refuse the row if `true`. |
| `language` | string | The model's language guess; always `en` on a row Footnote sees (an unsupported language is a needs_human rule) | Draft in English. |
| `min_bps` | integer 0..10000 | The final tier's minimum over its three confidences (category, priority, needs_human), basis points | ≥ 6000 by construction (below that is a needs_human rule). A value in 6000–7499 means tier B answered after tier A was unsure. Use it to decide how assertive a draft is; do not turn it into a probability, it is one model's self-report. |
| `flags` | string[] | `SECONDARY:<category>` (a second ask in the ticket; the model's note, never routed on), `TIER_A_FAILED:<PARSE_*>` (tier B answered after a tier A failure) | `SECONDARY:` says the ticket asks two things; draft for the primary and name the second. `INJECTION_SUSPECTED`, `UNSUPPORTED_LANGUAGE:*`, `FINAL_TIER_FAILED:*` never appear on an auto-handled row (each forces needs_human). |
| `reasons` | string[] | `escalate:<why>` when tier B was called (`LOW_CONFIDENCE:<min><7500`, `CATEGORY_ALWAYS_B:<c>`, `TIER_A_FAILED`). Never a `human:*` or `screen:*` reason on a row Footnote sees | Audit trail; nothing to act on. |
| `path` | `A` or `A>B` | Which tiers answered | Audit trail. `A>B>H` and `A>H` never reach Footnote. |
| `final_tier` | `A` or `B` | Whose labels these are (`claude-haiku-5-5` or `claude-sonnet-5-5`, O-1, from the policy file) | Audit trail. |
| `tier_a_min_bps` | integer | Tier A's minimum confidence before any escalation | Audit trail. |
| `cost_pico_batch`, `cost_pico_standard` | decimal strings, pico-USD | This ticket's cost at batch and standard prices from the usage fields (non-negotiable 7) | Accounting. The ledger row says which one was billed (`live` → batch, `messages` → standard). |
| `human_touched` | boolean | `needs_human` OR the audit sample (D-21: about 10% of auto-handled tickets by seeded hash, `audit_sample_bps: 1000`) | `true` with `needs_human: false` marks an audit-sampled ticket: the label is still the pipeline's and Footnote may draft from it, but a person will re-label it afterwards for the override-rate drift signal. Whether N9 holds the reply until then is N9's call. |
| `overridden` | `null` | Set only by a person's correction (`overrides:add`), never in a fresh run | Ignore; always `null` at hand-off. |

Beside the row, from the envelope: **`run_id`** (`<accepted time>-<provider>`, the ledger key; the same id on the ledger row that carries the five policy hashes, D-26, so any decision can be traced to the exact prompt, schema, policy, prices and drift config that produced it) and **`x-triage-contract: triage.http.v1`** on every response. Footnote should store both with the draft: a later question "which prompt wrote this label" is answered by `ledger:show --run <id>`, nothing else.

## What Footnote never receives

- **Any ticket with `needs_human: true`.** It goes to the per-route human queue (the BILLING_OPS queue, the ENGINEERING queue, …; route `NONE` tickets sit in TIER1's) and the delivered label is the person's, not the pipeline's. The rules, from `routing/policy.v1.json` `needs_human_when`, any one of which holds a ticket back: the final tier said so · final priority P1 · final category PRIVACY_DATA · final minimum confidence < 6000 · language not `en` · category HOW_TO or FEATURE_REQUEST with a secondary category (D-51) · the screen fired (a suspected injection; the text of a ticket is data, never an instruction, non-negotiable 11) · the final tier failed (a `PARSE_*` code; the row carries placeholder OTHER/P3 for queue placement only and the eval counts it as a failure, never as a label).
- **So, by construction, Footnote never sees:** a P1, a PRIVACY_DATA ticket, a non-English ticket, a ticket the screen flagged, a parse failure's placeholder label, or a how-to that straddles a second category.
- **The ticket text itself.** Triage returns labels keyed by `ticket_id`; Footnote reads the ticket from N9, not from Triage.
- **A reply, a draft, a macro, a knowledge-base hit.** Out of scope by the PRD; that is Footnote.
- **Anything from the batch path for up to 24 hours.** A Batches request may legally take that long (p50 364 s, p95 423 s measured on the batch 1 recording). A ticket N9 marks time-sensitive goes through `POST /triage` with `provider: messages` and gets its row in 1.5–5.7 s (5-ticket smoke, D-57) at standard prices. A `503` on that path means fall back to the batch path; the ticket is not lost, and nothing was labelled.
- **The human queue's later corrections.** A person's override is a new row in `data/overrides.jsonl` (O-6, D-36); it feeds the drift report and is not pushed to Footnote.

## What Triage promises, per field

- **Determinism.** Same ticket text, same tier results, same policy hash → the same row, byte for byte (`src/pipeline/` is pure; the eval replays 1,200 of 1,200 decisions equal). Held by `npm test` and `triage:eval` in CI with no key.
- **Enums close.** `category`, `priority`, `route` are always members of the policy file's lists; a value outside them is a `PARSE_ENUM` failure upstream and never reaches a row (non-negotiable 3). Footnote can switch on them exhaustively.
- **Route is a function of (category, priority)** through the table and its one override row (ACCOUNT_ACCESS + P1 → TRUST_PRIVACY), never a model output. Footnote can recompute it and must get the same answer.
- **`min_bps` ≥ 6000 and `language = en` on every auto-handled row**, because below 6000 and non-`en` are needs_human rules. A row violating either is a Triage bug, not a Footnote edge case.
- **Every row is priced from the usage fields** at the price table's rates, under the run and project caps. An unknown model id throws rather than guesses.
- **Every row is traceable** through `run_id` to the policy hashes on the ledger row. A prompt, schema, model or threshold change moves a hash and ships with a fresh `docs/EVAL.md` (D-16).
- **The contract is versioned.** Adding a field keeps `triage.http.v1`; renaming, removing or re-typing one is v2 and a decisions entry.

## What Triage does not promise

- **No accuracy claim without the EVAL row.** The only measurements that exist are on 1,200 synthetic tickets against an answer key written by the same author, two models, one recording each (2026-10-25, replayed under policy v1 after D-51). From `docs/EVAL.md`, recorded column:

| | batch 1 (700) | batch 2 (500) |
|---|---|---|
| needs_human recall · false negatives | 203/203 · 0 | 217/217 · 0 |
| P1 tickets not in the human queue | 0 of 42 | 0 of 70 |
| Delivered category accuracy, auto-handled only | 375/391 (95.91%) | 190/197 (96.45%) |
| … batch 1 test split at T = 7500 | 96.23% of 159 | — |
| Delivered priority accuracy, auto-handled only | 95.14% of 391 | 95.94% of 197 |
| Delivered route accuracy, auto-handled only | 100.00% of 391 | 100.00% of 197 |
| Human queue (never sent to Footnote) | 309 (44.14%) | 303 (60.60%) |
| Cents per 1,000 tickets, batch / standard | 66 / 131 | 79 / 158 |

  Read it as: of the rows Footnote would have received, about 1 in 25 carries a category the key disagrees with. That is a number about synthetic tickets and this key; a production inbox has its own distribution, its own key, and no measurement yet. The scripted column in EVAL.md is a plumbing check of the arithmetic, not a model measurement (D-23), and must never be quoted as one.
- **`min_bps` is not calibrated.** ECE over the final tier's category confidence is 8.33% (batch 1, n 699) and 10.21% (batch 2, n 499). A row at 9000 is not 90% likely to be right.
- **The screen's 21 of 21 and 15 of 15 is an upper bound.** The injection strings and the screen share an author. An injection the screen misses and both tiers obey would reach Footnote as an ordinary row; the measured system-level compliance is 0 of 21 and 0 of 15, on those strings only.
- **No promise of a per-category floor.** The models under-call OUTAGE and PRIVACY_DATA (recall 59–70% and 62–85% as pipeline labels over all tickets) and over-call HOW_TO (precision 78–80%). Both under-called categories are escalation and needs_human rules, so the delivered rows are protected by the queue, not by the model; the over-call means a HOW_TO row Footnote sees is the likeliest to be something else.
- **No latency promise on the batch path** beyond the API's 24-hour ceiling. The sync path's 1.5–5.7 s is one 5-ticket smoke, not a distribution.
- **No stability across a policy change.** When a hash moves, the same ticket may get a different row; the drift report (`drift:report`) is how that is noticed, and its eight signals are over label mix, escalation, queue share, low confidence, language, parse failures and the override rate, not over Footnote's drafts.
- **Nothing about the reply.** Whether a correct label yields a correct draft is Footnote's measurement.

## The seam, named

Footnote's input today is one row per ticket keyed by `ticket_id`. If Footnote wants the reason text the model wrote (it exists in the recording, `reason` in the parsed answer) or the secondary category as a field rather than a flag, that is an O-9 revision: add the field, keep v1, record it in `docs/decisions.md`, and say so in a fresh EVAL only if a hash moves. Not built until asked.
