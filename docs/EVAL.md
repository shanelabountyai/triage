# Triage — EVAL

**Results source: scripted — designed error model, not a measurement.** Every number below comes from `tools/scripted_model.py`, a designed error model written by the same author as the policy, the screen and the answer key, run through the real policy, screen, parser, cost and drift arithmetic in TypeScript. They prove the plumbing and the arithmetic; they say nothing about Claude Haiku 5.5 or Claude Sonnet 5.5. The real numbers arrive with the Phase 2 recordings and Shane's 30 hand judgements (D-24) and will be reported beside these, never instead of them (D-23). Token counts are estimates (`ceil(bytes/4)`), so the costs are estimates too.

| | |
|---|---|
| Printed by | `npm run triage:eval` (TypeScript), 2026-10-19 |
| Agrees with | `tools/reference_pipeline.py`: byte-identical output, 102 lines, and all 1,200 per-ticket decisions on all 15 columns of `fixtures/decisions_batch{1,2}.csv` |
| Fixtures | seed 20261019; sha256 in brief §12 and `fixtures/MANIFEST.json` (tickets_batch1 `e02c5395…`, tickets_batch2 `7d383de2…`, scripted tier A/B batch 1 `9d14a264…` / `e10bd7c6…`, batch 2 `d2edb229…` / `9ca45f14…`) |
| Policy files (D-26) | policy `1853dfe9c919` · drift `6df58154d1c2` · prices `bc2d7fed5aad` · prompt `97b5dcb644b0` · schema `c94a2c1d4e8d` |
| Policy | v1, escalation T = 7500 bps (O-3), tiers `claude-haiku-5-5` / `claude-sonnet-5-5` (O-1) |
| Spend | $0 (no model was called) |

## Headline (scripted)

| | Batch 1 (700) | Batch 2 (500, drifted) | Target (D-22) |
|---|---|---|---|
| needs_human recall / false negatives | 99.01% / 2 | 100.00% / 0 | ≥ 98%, — |
| P1 tickets not in the human queue | 0 of 42 | 0 of 70 | 0 |
| Delivered category accuracy (auto-handled only) | 448/459, 97.60% | 245/254, 96.46% | — |
| Delivered category accuracy, batch 1 test split (281 tickets) | 97.25% of 182 auto-handled | — | ≥ 95% |
| Escalated to tier B | 312, 44.57% | 274, 54.80% | — |
| Human queue | 241, 34.43% | 246, 49.20% | — |
| Cost per 1,000 tickets, batch / standard prices | 26 / 53 cents | 32 / 64 cents | — |
| Injection: screen flagged / false positives / system-level success | 21 of 21 / 0 of 679 / 0 | 15 of 15 / 0 of 485 / 0 | 0 system-level |

The screen's 100% is an upper bound: its rules were written with these injection strings in view (brief §5). The two batch-1 needs_human misses (B1-0381, B1-0418) are discussed in brief §11. The hard-case density (23% of batch 1, 40% of batch 2) is far above a real inbox on purpose, so the queue shares are a property of the fixture.

## Full output

```
triage reference pipeline  results=scripted  seed=20261019  policy=v1 (T=7500)  fixtures seed=20261019
policy sha256 1853dfe9c919  drift 6df58154d1c2  prices bc2d7fed5aad  prompt 97b5dcb644b0  schema c94a2c1d4e8d
NOTE: results are from tools/scripted_model.py, a designed error model. These numbers test the plumbing and the arithmetic, not a model. Token counts are estimates.

== batch 1: 700 tickets ==
paths: A 304  A>B 155  A>B>H 157  A>H 84
escalated to B 312 (44.57%)  human queue 241 (34.43%)  auto-handled 459 (65.57%)  low-confidence A 274 (39.14%)  model results 1012, failed 19 (1.88%)
failures: A:PARSE_ENUM:category 6  A:PARSE_JSON 3  A:errored 10
all tickets (pipeline label): n 700  category 668/700 (95.43%)  priority 665/700 (95.00%)  route 672/700 (96.00%)  both labels 638/700 (91.14%)
auto-handled only (delivered label): n 459  category 448/459 (97.60%)  priority 447/459 (97.39%)  route 449/459 (97.82%)  both labels 436/459 (94.99%)
per-category (all tickets): label  tp fp fn  precision recall f1
  BILLING           121   3   4   97.58%  96.80%  97.19%
  ACCOUNT_ACCESS     96   1   7   98.97%  93.20%  96.00%
  BUG               108  13   2   89.26%  98.18%  93.51%
  HOW_TO            147   8   7   94.84%  95.45%  95.15%
  FEATURE_REQUEST    58   2   1   96.67%  98.31%  97.48%
  INTEGRATION        51   1   4   98.08%  92.73%  95.33%
  PRIVACY_DATA       23   0   1  100.00%  95.83%  97.87%
  OUTAGE             20   1   2   95.24%  90.91%  93.02%
  SPAM               30   0   3  100.00%  90.91%  95.24%
  OTHER              14   3   1   82.35%  93.33%  87.50%
per-priority (all tickets):
  P1                 42   5   0   89.36% 100.00%  94.38%
  P2                115  11   9   91.27%  92.74%  92.00%
  P3                395   6  23   98.50%  94.50%  96.46%
  P4                113  13   3   89.68%  97.41%  93.39%
needs_human: tp 201 fp 40 fn 2  precision 83.40% recall 99.01% f1 90.54%  (fn = tickets a person should have seen and did not)
P1 tickets not in the human queue: 0 of 42
hard cases: kind  n  category-correct  in-human-queue
  AMBIGUOUS        42    39 ( 92.86%)    41 ( 97.62%)
  CHURN_THREAT     21    21 (100.00%)    20 ( 95.24%)
  INJECTION        21    18 ( 85.71%)    21 (100.00%)
  MULTI_ISSUE      42    36 ( 85.71%)    42 (100.00%)
  NONE            539   522 ( 96.85%)    82 ( 15.21%)
  NON_ENGLISH      35    32 ( 91.43%)    35 (100.00%)
injection: n 21  screen flagged 21 (100.00%; written with this set in view, so an upper bound)  screen false positives on the other 679 tickets 0  model-level complied A 5, B 1  system-level (attacker got what they wanted and no person saw it) 0
calibration: category confidence ECE 9.12% over 700 parsed results (10 equal-width bins)
cost (from usage fields, prices v1): batch pricing 19 cents total, 26 cents per 1,000 tickets; standard pricing 37 cents total, 53 cents per 1,000 tickets
tokens: A:cache_creation_input_tokens 1316  A:cache_read_input_tokens 906724  A:input_tokens 53513  A:output_tokens 52626  B:cache_creation_input_tokens 0  B:cache_read_input_tokens 410592  B:input_tokens 24478  B:output_tokens 23933
override rate: 41/287 human-touched (14.29%); human = answer key (assumed perfect, O-6); audit sample 1000 bps

== batch 2: 500 tickets ==
paths: A 158  A>B 96  A>B>H 178  A>H 68
escalated to B 274 (54.80%)  human queue 246 (49.20%)  auto-handled 254 (50.80%)  low-confidence A 229 (45.80%)  model results 774, failed 8 (1.03%)
failures: A:PARSE_ENUM:category 2  A:PARSE_JSON 2  A:errored 2  B:errored 2
all tickets (pipeline label): n 500  category 463/500 (92.60%)  priority 472/500 (94.40%)  route 470/500 (94.00%)  both labels 438/500 (87.60%)
auto-handled only (delivered label): n 254  category 245/254 (96.46%)  priority 246/254 (96.85%)  route 245/254 (96.46%)  both labels 237/254 (93.31%)
per-category (all tickets): label  tp fp fn  precision recall f1
  BILLING            88   0  10  100.00%  89.80%  94.62%
  ACCOUNT_ACCESS     50   5   4   90.91%  92.59%  91.74%
  BUG               100  12   5   89.29%  95.24%  92.17%
  HOW_TO             67  12   5   84.81%  93.06%  88.74%
  FEATURE_REQUEST    29   3   4   90.63%  87.88%  89.23%
  INTEGRATION        31   1   1   96.88%  96.88%  96.88%
  PRIVACY_DATA       12   0   1  100.00%  92.31%  96.00%
  OUTAGE             56   1   5   98.25%  91.80%  94.92%
  SPAM               24   1   1   96.00%  96.00%  96.00%
  OTHER               6   2   1   75.00%  85.71%  80.00%
per-priority (all tickets):
  P1                 69   6   1   92.00%  98.57%  95.17%
  P2                110  10  10   91.67%  91.67%  91.67%
  P3                231   7  14   97.06%  94.29%  95.65%
  P4                 62   5   3   92.54%  95.38%  93.94%
needs_human: tp 217 fp 29 fn 0  precision 88.21% recall 100.00% f1 93.74%  (fn = tickets a person should have seen and did not)
P1 tickets not in the human queue: 0 of 70
hard cases: kind  n  category-correct  in-human-queue
  AMBIGUOUS        30    24 ( 80.00%)    30 (100.00%)
  CHURN_THREAT     25    25 (100.00%)    25 (100.00%)
  INJECTION        15    13 ( 86.67%)    15 (100.00%)
  MULTI_ISSUE      30    26 ( 86.67%)    30 (100.00%)
  NEW_TOPIC        40    35 ( 87.50%)     6 ( 15.00%)
  NONE            300   286 ( 95.33%)    80 ( 26.67%)
  NON_ENGLISH      60    54 ( 90.00%)    60 (100.00%)
injection: n 15  screen flagged 15 (100.00%; written with this set in view, so an upper bound)  screen false positives on the other 485 tickets 0  model-level complied A 2, B 0  system-level (attacker got what they wanted and no person saw it) 0
calibration: category confidence ECE 10.39% over 498 parsed results (10 equal-width bins)
cost (from usage fields, prices v1): batch pricing 16 cents total, 32 cents per 1,000 tickets; standard pricing 32 cents total, 64 cents per 1,000 tickets
tokens: A:cache_creation_input_tokens 1316  A:cache_read_input_tokens 654052  A:input_tokens 39213  A:output_tokens 38132  B:cache_creation_input_tokens 0  B:cache_read_input_tokens 357952  B:input_tokens 21797  B:output_tokens 20891
override rate: 46/272 human-touched (16.91%); human = answer key (assumed perfect, O-6); audit sample 1000 bps

threshold sweep, batch 1, dev split only (T = escalate to B when tier-A min confidence is below T):
  T     escalated   delivered-category-acc   human-queue   cost/1k batch (cents)
  6000   100 ( 23.87%)    94.96% of 278         141 ( 33.65%)       16
  6500   130 ( 31.03%)    95.31% of 277         142 ( 33.89%)       19
  7000   156 ( 37.23%)    96.76% of 278         141 ( 33.65%)       23
  7500   191 ( 45.58%)    97.83% of 277         142 ( 33.89%)       27
  8000   222 ( 52.98%)    98.56% of 278         141 ( 33.65%)       31
  8500   332 ( 79.24%)    98.92% of 277         142 ( 33.89%)       45
  9000   392 ( 93.56%)    98.90% of 273         146 ( 34.84%)       53
  9500   415 ( 99.05%)    98.15% of 271         148 ( 35.32%)       56
at policy T=7500, batch 1 TEST split: n 281  delivered category accuracy 97.25% of 182 auto-handled  human queue 99

drift: batch 2 window vs batch 1 baseline (monitoring/drift.v1.json)
  signal                              value     threshold  fired
  LABEL_MIX_TVD_CATEGORY               1423 bps    1000 bps  YES
  LABEL_MIX_TVD_PRIORITY               1429 bps    1000 bps  YES
  OVERRIDE_RATE_DELTA                   262 bps     500 bps  no
  ESCALATION_SHARE_DELTA               1023 bps     800 bps  YES
  HUMAN_QUEUE_SHARE_DELTA              1477 bps     800 bps  YES
  LOW_CONFIDENCE_SHARE_DELTA            666 bps     800 bps  no
  UNSUPPORTED_LANGUAGE_SHARE_DELTA      686 bps     500 bps  YES
  PARSE_FAILURE_RATE                    103 bps     200 bps  no
  (a distance of 1000 bps means 10% of the mix moved; a delta of 500 bps means the rate rose 5 points)
```

## Gate

CI (`.github/workflows/ci.yml`, no secret) runs `typecheck`, `policy:lint` (contracts, D-26 hashes, purity and float lint over `src/pipeline/`), `fixtures:check`, `npm test` and `triage:eval`, which exits 1 on any per-ticket difference from the reference decisions. The red and green proof runs are linked in `NEXT.md`.
