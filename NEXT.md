# NEXT

## ▶ Next session: Phase 3, task 3.2 (`docs/phase-3-tasks.md`)

**2026-10-27: tasks 3.0 and 3.1 done. Spend to date 127¢ (nothing spent this session).** 3.0 (D-53): the scanner returned 0 items on the checkbox list; 3.1–3.8 were bucketed by hand against the donors (reuse the in-repo readers; adapt opsagent `ledger.py`/`web.py` and use-case-studio `callStructured`; new: pooled drift, the HTTP contract, the hand-off doc). 3.1: `npm run ledger:show [-- --ledger <jsonl>] [--run <run_id>]` in `src/io/ledger.ts` (`readLedger`, `ledgerTable`, `runDetail`) over `ledgerState`, `runDecisions`-style reads and the now-exported `per1k` from `src/eval/report.ts`; the totals line is `picoToCents(ledgerState(path).livePico)`, the same sum the project cap reads. Real ledger today: **9 runs, live spend 127¢ over 5 live rows, 4 replay rows**. `--run` prints input sha, out dir, path counts, human-queue share, `FINAL_TIER_FAILED:*` counts and cents per 1,000; a top-up row (out null) says it takes no decisions; a gone out dir says `not found`; an unknown id is `LEDGER_UNKNOWN_RUN`. Test over the committed `tests/samples/runs.jsonl` (three rows; the live row's `out` is `recordings/batch1`, so the detail numbers are the recording's: 309 of 700 queued, 44.14%, 66¢ per 1,000, one PARSE_JSON failure), every expected value derived by hand. Note: `data/live/batch1/decisions.jsonl` is the pre-D-51 live output (queue 288), while `recordings/batch1/decisions.jsonl` was regenerated under D-51 (309); `--run` on the live row shows the former by design.

**For 3.2 (override intake):** `npm run overrides:add -- --run <id> --ticket <id> --category <C> --priority <P> --by <name>` appends one row via `appendOverrides` (`src/io/overrides.ts`); refuse a run not in the ledger (`readLedger`), a ticket not in that run's `decisions.jsonl` (`runDecisions`, `src/io/drift.ts`), a label outside `routing/policy.v1.json` enums; each refusal a typed error code. CLI shape: `scripts/overrides-standin.ts`. Acceptance: GD goldens still pass, three refusal tests, `drift:report` reads the rows unchanged. Then 3.3 (pooled drift windows, `--last N` = N ledger runs per D-52). `/model` per item: 3.2 is Sonnet-shaped; 3.3 and 3.4 are Opus-shaped (drift math, auth boundary).

**Open, carried (3.7):** (1) one `max_tokens` stop per batch on Sonnet, counted as `FINAL_TIER_FAILED:PARSE_JSON` (D-8); `ledger:show --run` now prints it. (2) D-48 restore note: run cap 400¢ → 300¢. (3) Refusal smokes must move `.env.local` aside (D-50 process note). (4) B1-0584 judged "human, other reason" with no note.

Gate at this checkpoint: typecheck 0 errors · policy:lint OK · fixtures:check OK · `npm test` 15 files, 95 tests passed · triage:eval scripted 1,200 of 1,200 equal and stdout byte-identical, exit 0 · triage:eval recorded 1,200 of 1,200 equal to `recordings/batch{1,2}/decisions.jsonl`, exit 0. Spend to date: **127¢** of the 1500¢ project cap.

## Older

**2026-10-27: task 2.11 done. Phase 2 exit criteria all met. Spend to date 127¢ (nothing spent this session).** `docs/EVAL.md` rewritten with scripted and recorded side by side: headline table against the D-22 targets, full table, per-category and per-priority, the sweep in both columns, Shane's 30, drift, the D-26 hashes, the fixture hashes, a recordings table (run ids, batch ids, tier-file and `decisions.jsonl` sha256s, the pre-D-51 policy hash the recordings were made under) and both verbatim outputs. Recorded column: needs_human recall 203/203 and 217/217, P1 missed 0 of 42 and 0 of 70, delivered category accuracy 375/391 (95.91%) and 190/197 (96.45%), batch 1 test split 96.23% of 159, queue 44.14% and 60.60%, 66¢ and 79¢ per 1,000, cache-read share 96.83% and 96.84%. Scripted column unchanged and labelled a plumbing check (D-23). No code changed; no hash moved; no decisions entry needed.

**Phase 3 task list drafted at the gate and reviewed: `docs/phase-3-tasks.md`.** 3.0 reuse scan · 3.1 ledger views · 3.2 override intake CLI · 3.3 drift over a sliding window of runs · 3.4 `node:http` handler for N9 on port **6300** (proposed; add the global table row with the config) · 3.5 synchronous `messages` provider (O-10, spends a little) · 3.6 Footnote hand-off doc · 3.7 the carried items decided · 3.8 README refresh. **Answered at the gate (D-52):** port 6300 (global table row lands with 3.4's config); bearer token from `TRIAGE_HTTP_TOKEN`; 3.5 spends one 5-ticket smoke (~1¢); `--last N` is N runs. Start the next session with 3.0 (reuse scan, one command, record in decisions) then 3.1; `/model` per item.

**Open, carried (now 3.7):** (1) one `max_tokens` stop per batch on Sonnet, counted as `FINAL_TIER_FAILED:PARSE_JSON` (D-8). (2) D-48 restore note: run cap 400¢ → 300¢; the real tier-B costs are known (42¢, 36¢, top-ups 25¢, 12¢). (3) Refusal smokes must move `.env.local` aside: `scripts/run.ts` loads it for any `live` run (D-50 process note). (4) B1-0584 was judged "human, other reason" with no note.

Gate at this checkpoint: typecheck 0 errors · policy:lint OK · fixtures:check OK · `npm test` 14 files, 88 tests passed · triage:eval scripted 1,200 of 1,200 equal and stdout byte-identical, exit 0 · triage:eval recorded 1,200 of 1,200 equal to `recordings/batch{1,2}/decisions.jsonl`, exit 0. Spend to date: **127¢** of the 1500¢ project cap.

## Older


**2026-10-27: task 2.10 done (D-51). Spend to date 127¢ (nothing spent this session).** Shane's 30 recorded in `eval/labels/shane-30.json` (30 of batch 1's 288 human-queue tickets as of commit 0081758, by seeded hash; `npm run shane:pick` made the file once and refuses to overwrite): **30 of 30 human-needed, 0 of 30 would have auto-handled, pipeline reason agreed 29 of 30**, labels ok 30 of 30. Both false-negative templates (AMB-05, AMB-07) judged "a person should see it", so the key stands and the 18 misses were closed by a policy rule, not a prompt change: `needs_human_when.secondary_with_category_in: [HOW_TO, FEATURE_REQUEST]`, reason `human:secondary_<secondary>`, GT-15. O-3 stays 7500.

Recorded, answer key as judge, after D-51 (before in brackets): needs_human recall **203/203** [194/203] and **217/217** [208/217]; human queue 309 of 700 (44.14%) [288] and 303 of 500 (60.60%) [277]; delivered category accuracy 375/391 (95.91%) [94.90% of 412] and 190/197 (96.45%) [94.62% of 223]; batch 1 test split 96.23% of 159 [94.15% of 171]; P1 missed 0 of 42 and 0 of 70; cents per 1,000 unchanged at 66 and 79. 29 of the 47 tickets the rule moved are key-auto (over-flags). `triage:eval --provider recorded` prints the Shane's 30 section (recorded only; scripted stdout still byte-identical to the oracle).

**For 2.11:** rewrite `docs/EVAL.md` with the scripted and recorded columns side by side, each with its denominator, its source and its fixture or recording hash; the recorded column is the first real measurement, the scripted column stays labelled a plumbing check (D-23). Sources: `npm run -s triage:eval` and `npm run -s triage:eval -- --provider recorded` (both exit 0, 1,200 of 1,200 equal); brief §11 for the table shape; D-49, D-50, D-51 for the numbers' history. EVAL.md's hashes and verbatim scripted output were already refreshed for D-51; its recorded half does not exist yet. Then the Phase 2 exit criteria are all met; write the Phase 3 task list at the gate and stop for review.

**Open, carried:** (1) one `max_tokens` stop per batch on Sonnet, counted as `FINAL_TIER_FAILED:PARSE_JSON` (D-8). (2) D-48 restore note: run cap 400¢ → 300¢; the real tier-B costs are known (42¢, 36¢, top-ups 25¢, 12¢ against ceilings of 312¢ and ~206¢). (3) Refusal smokes must move `.env.local` aside: `scripts/run.ts` loads it for any `live` run (D-50 process note). (4) B1-0584 was judged "human, other reason" with no note; same text as two tickets judged "reason right".

Gate at this checkpoint: typecheck 0 errors · policy:lint OK · fixtures:check OK · `npm test` 14 files, 88 tests passed · triage:eval scripted 1,200 of 1,200 equal and stdout byte-identical, exit 0 · triage:eval recorded 1,200 of 1,200 equal to `recordings/batch{1,2}/decisions.jsonl`, exit 0, every sweep row measured. Spend to date: **127¢** of the 1500¢ project cap.



**2026-10-26: task 2.9 done (D-50). T stays 7500. Spend to date 127¢** (ledger: 4¢ INCOMPLETE + 46¢ + 40¢ + top-ups 25¢ + 12¢). The recorded sweep was only measurable at T ≤ 7500 because a recording holds Sonnet lines for escalated tickets only; the rows above replayed as tier-B failures. Fixed by (1) printing `n/a` on an unmeasurable row and (2) `triage:run --provider live --top-up-tier-b`, which sent Sonnet the 276 + 130 non-escalated tickets and appended them to `recordings/batch{1,2}/tierB.jsonl` (meta.json `topup`, own ledger rows). Decisions unchanged: 1,200 of 1,200 still equal.

Sweep, batch 1 dev split, recorded (D-50): 7000 → 93.80% of 258 auto-handled at 41¢/1k · **7500 → 95.44% of 241 at 64¢** · 8000 → 95.45% of 242 at 71¢ · 9500 → 95.44% of 241 at 102¢. Flat above, falling below; no policy hash change, no new EVAL. Test split at 7500: 94.15% of 171.

**For 2.10:** pick 30 human-queue tickets from `recordings/batch1/decisions.jsonl` (needs_human true; 288 of 700), record Shane's judgement per ticket in `eval/labels/shane-30.json`, print agreement with the pipeline's reasons and the share he would have auto-handled. Include AMB-05 and AMB-07 tickets deliberately: they carry the 18 recall false negatives (D-49) and the key rule for them is what 2.10 adjudicates. Then re-decide O-3 and the needs_human rules (D-24). A key change regenerates fixtures per brief §12 with a decisions entry; the recordings stay valid if `tickets_batch*.jsonl` stay byte-identical.

**Open, carried:** (1) one `max_tokens` stop per batch on Sonnet, counted as `FINAL_TIER_FAILED:PARSE_JSON` (D-8). (2) D-48 restore note: run cap 400¢ → 300¢; the real tier-B costs are now known (42¢, 36¢, top-ups 25¢, 12¢ against ceilings of 312¢ and ~206¢), so this can be judged. (3) Refusal smokes must move `.env.local` aside: `scripts/run.ts` loads it for any `live` run (D-50 process note).

Gate at this checkpoint: typecheck 0 errors · policy:lint OK · fixtures:check OK · `npm test` 14 files, 87 tests passed · triage:eval scripted 1,200 of 1,200 equal and stdout byte-identical, exit 0 · triage:eval recorded 1,200 of 1,200 equal to `recordings/batch{1,2}/decisions.jsonl`, exit 0, every sweep row measured. Spend to date: **127¢** of the 1500¢ project cap.

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

