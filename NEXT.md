# NEXT

## ▶ Next session: task 2.10 (`docs/phase-2-tasks.md`) — Shane's 30 (D-24), then re-decide O-3 and the needs_human rules

**2026-10-26: task 2.9 done (D-50). T stays 7500. Spend to date 127¢** (ledger: 4¢ INCOMPLETE + 46¢ + 40¢ + top-ups 25¢ + 12¢). The recorded sweep was only measurable at T ≤ 7500 because a recording holds Sonnet lines for escalated tickets only; the rows above replayed as tier-B failures. Fixed by (1) printing `n/a` on an unmeasurable row and (2) `triage:run --provider live --top-up-tier-b`, which sent Sonnet the 276 + 130 non-escalated tickets and appended them to `recordings/batch{1,2}/tierB.jsonl` (meta.json `topup`, own ledger rows). Decisions unchanged: 1,200 of 1,200 still equal.

Sweep, batch 1 dev split, recorded (D-50): 7000 → 93.80% of 258 auto-handled at 41¢/1k · **7500 → 95.44% of 241 at 64¢** · 8000 → 95.45% of 242 at 71¢ · 9500 → 95.44% of 241 at 102¢. Flat above, falling below; no policy hash change, no new EVAL. Test split at 7500: 94.15% of 171.

**For 2.10:** pick 30 human-queue tickets from `recordings/batch1/decisions.jsonl` (needs_human true; 288 of 700), record Shane's judgement per ticket in `eval/labels/shane-30.json`, print agreement with the pipeline's reasons and the share he would have auto-handled. Include AMB-05 and AMB-07 tickets deliberately: they carry the 18 recall false negatives (D-49) and the key rule for them is what 2.10 adjudicates. Then re-decide O-3 and the needs_human rules (D-24). A key change regenerates fixtures per brief §12 with a decisions entry; the recordings stay valid if `tickets_batch*.jsonl` stay byte-identical.

**Open, carried:** (1) one `max_tokens` stop per batch on Sonnet, counted as `FINAL_TIER_FAILED:PARSE_JSON` (D-8). (2) D-48 restore note: run cap 400¢ → 300¢; the real tier-B costs are now known (42¢, 36¢, top-ups 25¢, 12¢ against ceilings of 312¢ and ~206¢), so this can be judged. (3) Refusal smokes must move `.env.local` aside: `scripts/run.ts` loads it for any `live` run (D-50 process note).

Gate at this checkpoint: typecheck 0 errors · policy:lint OK · fixtures:check OK · `npm test` 14 files, 87 tests passed · triage:eval scripted 1,200 of 1,200 equal and stdout byte-identical, exit 0 · triage:eval recorded 1,200 of 1,200 equal to `recordings/batch{1,2}/decisions.jsonl`, exit 0, every sweep row measured. Spend to date: **127¢** of the 1500¢ project cap.

## Older

**2026-10-25: task 2.8 done (D-49). Spend to date 90¢ (nothing spent this session).** `triage:eval --provider recorded` is held to `recordings/batch{1,2}/decisions.jsonl`, the live run's own decisions (the recorder now writes that file; the two first recordings got theirs from `data/live/`). Replay: 1,200 of 1,200 equal, deterministic, in CI without a key. Recorded-only lines: NOTE, `recording:` (run id, model and batch ids, STALE check on prompt/schema/model ids) and `cache (from usage fields):`. Scripted stdout stays byte-identical to the reference.

First recorded numbers (answer key as judge, synthetic tickets; D-22 targets in brackets):

| | batch 1 (700) | batch 2 (500) |
|---|---|---|
| needs_human recall [≥ 98%] | **95.57%**, 9 fn of 203 | **95.85%**, 9 fn of 217 |
| P1 missed [0] | 0 of 42 | 0 of 70 |
| delivered category accuracy [≥ 95% test split] | 94.90% of 412; **test split 94.15% of 171** | 94.62% of 223 |
| escalated to B | 60.57% | 74.00% |
| cache-read share of tier-A input | 96.83% | 96.84% |
| cents per 1,000, batch prices | 66 | 79 |

**The 18 false negatives are two templates, not 18 misses.** Every one is AMB-05 (`Deposits`: "How do deposits work? Who keeps the money if a client no-shows and do you charge us a fee?", key BILLING/P3) or AMB-07 (`Group bookings`: "Can two clients book one slot together...? If not, could that be added?", key FEATURE_REQUEST/P4). The generator sets `needs_human = True` for every AMBIGUOUS ticket by rule (`tools/build_fixtures.py` line 247). Haiku and Sonnet both say `needs_human: false` at 7000–8500 bps on these two and flag all eight other AMBIGUOUS templates (the per-template table is in D-49's reasoning; rerun: join `recordings/batchN/decisions.jsonl` with the key on `hard_case == AMBIGUOUS`). AMB-05 is also a category disagreement (model HOW_TO with BILLING secondary; key BILLING with HOW_TO secondary), which is most of the delivered-accuracy gap.

**How to fix, in order (decide in 2.9/2.10, not in passing):**
1. **2.10 first, on these two templates.** If Shane reads them as answerable, the key rule is wrong for them: change `build_fixtures.py` so AMB-05/AMB-07 carry `needs_human = False` (and decide AMB-05's primary category), regenerate the fixtures per brief §12 with a decisions entry, re-run both evals. The recordings stay valid: the tickets' text does not change (check the ten sha256s; `tickets_batch*.jsonl` must be byte-identical or the recordings are of other tickets). If Shane agrees with the key, the gap is a prompt lesson (D-16: a prompt change needs a new recording, ~86¢) or a policy rule; no code rule in `needs_human_when` catches "answerable-looking but ambiguous" without catching every SECONDARY-flagged ticket (226 of 700 and 200 of 500 carry one).
2. **2.9 cannot fix recall.** T moves tickets from A to B; on these 18 both tiers agree, and 9 of them went to B already. T is for the delivered-accuracy and cost columns.
3. **Not taken:** `final_min_confidence_bps_below` 6000 → 7000 as a needs_human rule. It would catch the A>B ones with min 6500–7000 (about 10 of 18) and swell the queue (the human-queue share is already 41% and 55%).

Open carried from 2.7: (1) one `max_tokens` stop per batch on Sonnet, counted as `FINAL_TIER_FAILED:PARSE_JSON` (D-8). (3) D-48 restore note: 400¢ → 300¢ once the ceiling-over-real-cost (338¢ over 46¢) is judged. (4) answered by D-49.

Gate at this checkpoint: typecheck 0 errors · policy:lint OK · fixtures:check OK · `npm test` 14 files, 84 tests passed · triage:eval scripted 1,200 of 1,200 equal and stdout byte-identical, exit 0 · triage:eval recorded 1,200 of 1,200 equal to `recordings/batch{1,2}/decisions.jsonl`, exit 0. Spend to date: **90¢** of the 1500¢ project cap.

