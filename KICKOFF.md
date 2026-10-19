# Kickoff — Triage (Build Log A5, High-Volume Triage Pipeline, AI track)

Paste the block below into Claude Code started in `~/Projects`, on Fable (`/model claude-fable-5-1`). The kit is the repo itself: `shanelabountyai/triage` holds the docs, tools, data files and frozen fixtures; nothing has been scaffolded, installed or run in TypeScript yet.

```
Triage — an LLM as a batch pipeline step for support tickets (Build Log A5, AI track).
The kickoff kit is the repo at ~/Projects/triage (clone shanelabountyai/triage if it is not
there). Nothing exists yet besides the kit: docs, tools/*.py, the JSON data files and fixtures/.

Read, in order: CLAUDE.md, prd-triage.md, docs/decisions.md (authoritative),
docs/domain-brief.md, docs/portfolio-overlap.md, docs/phase-1-tasks.md.

Steps, in order:
1. Oracle check: python3 tools/golden_answers.py ends with OK. Then
   python3 tools/verify_fixtures.py ends with OK. Compare the sha256 values it prints with
   docs/domain-brief.md section 12 and fixtures/MANIFEST.json, and
   python3 tools/reference_pipeline.py (no --write-decisions) with
   fixtures/samples/reference_pipeline.output.txt. Report any mismatch; do not fix either side.
2. Run the reuse check from ~/Projects/_templates/STARTUP-REUSE-CHECK.md against
   docs/phase-1-tasks.md (it may not parse a task list; record the result either way)
   and record it in docs/decisions.md.
3. Read the donors named in docs/portfolio-overlap.md (use-case-studio, opsagent, adjuster,
   loanbook) at the paths given. List any path that does not exist or whose code does not
   match the description. Don't resolve these yourself.
4. Read every doc. List anything that contradicts itself or can't be built as written,
   including anything in docs/decisions.md that disagrees with a JSON data file.
5. Scaffold (task 1.1 only): package.json (Node 22, type module), tsconfig.json, vitest,
   tsx, the scripts in CLAUDE.md as stubs that exit 0, .github/workflows/ci.yml running
   policy:lint, fixtures:check, test and triage:eval with no secrets, README.md with the
   scope banner from prd-triage.md verbatim. No other dependency. Do not add
   @anthropic-ai/sdk; it is a Phase 2 decision.
6. Commit in two commits, naming files explicitly (never git add -A):
   (a) the scaffold (package.json, package-lock.json, tsconfig.json, vitest.config.ts,
       .github/workflows/ci.yml, README.md, the script stubs);
   (b) docs/decisions.md with the reuse-check result; confirm the D-26 hashes equal
       sha256sum's on the five data files and say so in the commit message.
   Before each push: git ls-files | grep -iE "\.env$|secret|credential|\.pem$|\.key$" prints
   only .env.example.
7. Plan first: write the Phase 1 plan as the order you will do tasks 1.2 to 1.12 in, which
   donor you will read for each port in 1.3, and what you need from me. Stop and show me the
   plan, the step 1 output, the step 3 and 4 lists and the reuse-check result before writing
   any pipeline code.

Stop there. Do not write src/pipeline/, the providers, the eval or the drift code before I
have reviewed the plan. Update NEXT.md before you stop.

Rules from the first commit: no test or CI path calls the Claude API; src/pipeline/ imports no
SDK, fetch, node:fs, process.env, Date.now or Math.random; a parse failure is a typed failure,
never a default label; the model is never asked for route; integers only (bps and pico-USD);
cost from usage fields and pricing/prices.v1.json only, under TRIAGE_RUN_CAP_CENTS and
TRIAGE_PROJECT_CAP_CENTS; fixtures are never generated or read by product code; never edit an
expected value to pass a test; no new dependencies without asking; no "accurate", "optimal" or
"handles" anywhere without the number; nothing committed that matches .env, secret, credential,
.pem or .key except .env.example.
```

## Still to do by hand

- Build-log card A5: name **Triage**, PRD and repo links, status `in progress`, chips per `docs/portfolio-overlap.md` "Suggested card chips".
- Phase 2, before the first live run: create an Anthropic API key for this project only, put it in `.env` (never committed), set `TRIAGE_LIVE=1` for that one shell, confirm `TRIAGE_RUN_CAP_CENTS=200` and `TRIAGE_PROJECT_CAP_CENTS=1500` (O-2), and confirm the two model ids in `routing/policy.v1.json` against `models.list()` (O-1).
- Phase 2 task 2.6: read the first 30 human-queue tickets of the recorded run and record, per ticket, whether a person needed to see it and why (D-24).
- Decide O-1..O-10 when they come up; defaults are in force.
- N9's kickoff: point it at the decisions JSONL contract (O-9) and at A4 Footnote.
