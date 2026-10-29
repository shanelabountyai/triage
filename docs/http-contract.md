# `triage.http.v1` — the HTTP contract for N9

Task 3.4, D-56. One handler (`src/io/http.ts`, started by `npm run triage:serve`) in front of the same run that `triage:run` performs: tickets in, the decisions JSONL (O-9) and a ledger row out. Nothing in the handler decides a label, prices a token or relaxes a cap; a `live` run passes the D-19 gate inside `triageRun` exactly as the CLI does. Synthetic data only; the handler is a learning-project surface, not a deployed service.

Every response carries `x-triage-contract: triage.http.v1` and a JSON body. A change to a path, a field or a status code here is a new version and a `docs/decisions.md` entry.

## Starting it

```
npm run triage:serve                       # port 6300 (project default; PORT or --port overrides), ledger data/runs.jsonl, runs under data/http/
npm run triage:serve -- --port 6301 --ledger <jsonl> --data <dir>
```

Reads `.env.local` (D-40). Refuses to start without `TRIAGE_HTTP_TOKEN` (`HTTP_NO_TOKEN`). A `live` run additionally needs `TRIAGE_LIVE=1`, `ANTHROPIC_API_KEY` and headroom under `TRIAGE_RUN_CAP_CENTS` / `TRIAGE_PROJECT_CAP_CENTS` (defaults 400 and 1500, D-48, D-19). The OVER_CAP latch cannot be acknowledged over HTTP; that stays `triage:run --acknowledge-over-cap`.

## Authentication

Every path except `GET /health` needs `Authorization: Bearer <TRIAGE_HTTP_TOKEN>`. The comparison is constant-time over SHA-256 digests. Missing, wrong, or sent under another scheme → `401 {"error":"UNAUTHORIZED"}` with `WWW-Authenticate: Bearer`. The token is never written to a log: the request log is `METHOD path status ms`, one line per request, nothing from a header or a body.

## Paths

| Method, path | Body | Response |
|---|---|---|
| `GET /health` | | `200 {"status":"ok","contract":"triage.http.v1"}`. No token, no state. |
| `POST /runs` | `{"provider":"scripted"\|"recorded"\|"live", "batch":"<name>", "tickets":[{...}, ...]}` | `202 {"run_id":"<id>","status":"running"}`. The run is queued; poll `GET /runs/<id>`. |
| `GET /runs/<id>` | | `200 {"run_id","status":"running"\|"done"\|"failed","error":null\|"<message>","ledger_row":null\|{...},"decisions":null\|[...]}` |
| `GET /runs` | | `200 [ledger rows]`, the whole `data/runs.jsonl` in order (the `ledger:show` rows as JSON). |

**`tickets`** is a JSON array; each element is a ticket object with `ticket_id` (matching `^[a-zA-Z0-9_-]{1,64}$`, the Batch `custom_id` rule, D-9), `subject` and `body` as strings, any other fields kept. The array is written as `tickets_<batch>.jsonl`, one line per element, so intake line numbers are the array's 1-based positions.

**`batch`** names the replay for `scripted` and `recorded` (`fixtures/scripted_tier{A,B}_<batch>.jsonl`, `recordings/<batch>/`) and the recording directory a `live` run will create (`recordings/<batch>/`; an existing one is refused as `RECORDING_EXISTS`, a recording is never overwritten). Same character rule as `ticket_id`.

**`run_id`** is `<accepted time, ISO with - and : stripped>-<provider>`, the same id the ledger row carries; `started_at` on the row is the accepted time. Runs execute one at a time in arrival order, so two `live` POSTs cannot both read the same cap headroom. Two POSTs accepted in the same millisecond → `409 {"error":"RUN_EXISTS","run_id"}` for the second; nothing is overwritten.

**`decisions`** is the array of `decisions.jsonl` rows for the run, unchanged (O-9): `ticket_id, path, final_tier, category, priority, route, needs_human, language, min_bps, flags, reasons, cost_pico_batch, cost_pico_standard, human_touched, overridden, ...`. `null` while running, after a failure, or when the run's out dir is gone.

**`ledger_row`** is the run's `data/runs.jsonl` row (D-19 shape: tokens, `cost_pico_batch`, `cost_cents`, `cap_status`, hashes, latency). `null` while running; present after a `live` failure that spent money (`cap_status` INCOMPLETE or OVER_CAP, `error` set).

## Errors

| Status | Body | When |
|---|---|---|
| `400` | `{"error":"BAD_JSON"}` | body is not JSON |
| `400` | `{"error":"BAD_REQUEST","detail"}` | not an object; `provider` not one of the three; `batch` missing or failing the character rule; `tickets` not an array; `tickets` empty |
| `400` | `{"error":"INTAKE","errors":[{"line","code","detail"}, ...]}` | any element fails intake: `INTAKE_JSON` (not an object), `INTAKE_FIELD` (missing or non-string `ticket_id`/`subject`/`body`), `INTAKE_ID`, `INTAKE_DUPLICATE_ID`. Nothing is written or run. |
| `401` | `{"error":"UNAUTHORIZED"}` | see Authentication |
| `404` | `{"error":"RUN_UNKNOWN","run_id"}` / `{"error":"NOT_FOUND"}` | id in neither memory nor the ledger / unknown path |
| `405` | `{"error":"METHOD_NOT_ALLOWED"}` with `Allow` | wrong method on a known path |
| `409` | `{"error":"RUN_EXISTS","run_id"}` | same-millisecond collision |
| `413` | `{"error":"BODY_TOO_LARGE","limit_bytes":2097152}` | declared or streamed body over 2 MB; the body is drained, then refused |
| `500` | `{"error":"INTERNAL","detail"}` | an unexpected throw in the handler itself (a run's failure is not this: it is `status: "failed"` on the run) |

A run that fails after `202` reports `status: "failed"` with the thrown message as `error`: `LIVE_REFUSED` (no `TRIAGE_LIVE=1` or key), `CAP_PROJECTION`, `CAP_LATCHED`, `RECORDING_EXISTS`, `EEXIST` (out dir reused), or a provider error. A replay run spends nothing and its row says `cap_status: "n/a"`.

## Example

```
curl -s -X POST localhost:6300/runs -H "authorization: Bearer $TRIAGE_HTTP_TOKEN" -H 'content-type: application/json' \
  -d '{"provider":"scripted","batch":"batch1","tickets":[{"ticket_id":"B1-0001","subject":"...","body":"..."}]}'
→ 202 {"run_id":"20261029T153000.123Z-scripted","status":"running"}
curl -s localhost:6300/runs/20261029T153000.123Z-scripted -H "authorization: Bearer $TRIAGE_HTTP_TOKEN"
→ 200 {"run_id":"...","status":"done","error":null,"ledger_row":{...},"decisions":[{...}]}
```

Held by `tests/http.test.ts`: a POST of batch 1's 700 tickets with the scripted provider yields decisions equal to `fixtures/decisions_batch1.csv` on every column; `401`, `413` (declared and chunked), `400` (bad JSON, five bad envelopes, four intake codes with line numbers), `404`, `405`, `409`; a `live` POST with nothing set fails as `LIVE_REFUSED` and writes no ledger row; the token appears in no log line. No test spends a token (D-2).

## Not in v1

TLS (loopback or N9's reverse proxy terminates it), rate limiting, a per-run cancel, acknowledging the cap latch, and `POST /triage` for one time-sensitive ticket, which is task 3.5 (O-10) and will be its own contract entry.
