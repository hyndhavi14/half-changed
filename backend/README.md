# ByteMe Backend

A **generic, data-driven electricity scheduling backend** for manufacturing
clusters.

ByteMe stores a factory's machines, processes, production orders, energy data
and electricity tariffs in Supabase, assembles them into one scheduling problem,
and hands that problem to an external Python/OR-Tools optimizer.

**Nothing in the code, schema or API is specific to chocolate manufacturing.**
The Chocolate Factory in `supabase/seed.sql` is demonstration data and appears
nowhere else. An automobile, textile, pharmaceutical, electronics or aerospace
factory is the same schema with different rows.

---

## Status

| Area | State |
| --- | --- |
| Database migration (11 tables, indexes, constraints, RLS) | Ready |
| REST API under `/api/v1` (26 routes) | Ready |
| Zod validation on every body, query and path param | Ready |
| Optimizer payload assembly | Ready |
| Optimizer transport | **Deliberately disabled** until the Python interface is agreed |
| Automated tests | Run with `npm test` |
| Live Supabase connection | Verified against a real project: 11 tables, seed data readable |

Until the optimizer endpoint is configured, optimization endpoints answer
**503 Service Unavailable**. This is intended: ByteMe never invents a schedule.

---

## Quick start

```bash
npm install
cp .env.example .env.local     # then fill in the two Supabase values
npm run dev
```

### Connecting to your Supabase project

ByteMe needs exactly **two** values. Both come from the same dashboard page.

| Variable | Where to get it | Is it a secret? |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Dashboard > **Project Settings** > **API** > *Project URL* | No. Safe to publish. |
| `SUPABASE_SERVICE_ROLE_KEY` | Dashboard > **Project Settings** > **API** > *Service Role* > **Reveal** | **Yes.** Never leaves your machine. |

Paste both into `.env.local`, then confirm the backend sees them:

```bash
curl localhost:3000/api/v1/health
```

While the values are blank you will get a clear report rather than a crash:

```jsonc
{
  "data": {
    "status": "degraded",
    "checks": {
      "database": { "configured": false, "reachable": false },
      "optimizer": { "configured": false, "reason": "..." },
      "environment": {
        "missing_variables": ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]
      }
    }
  }
}
```

`/api/v1/health` returns **503** until the database is reachable, so a
monitoring probe reads the body rather than guessing from the status code. Any
other endpoint returns **500 `configuration_error`** naming the missing
variable — deliberately not a 400, because a blank environment variable is the
server's problem, not the caller's.

The anon key (`anon` / `publishable`) is **not** needed. ByteMe's API server
uses the service-role key and talks to Supabase directly. Only add the anon key
if a browser client needs its own Supabase access, and rely on RLS then.

### Applying the schema and seed data

Requires the [Supabase CLI](https://supabase.com/docs/guides/cli) and a login.

```bash
npm install -g supabase          # if not already installed
supabase login                   # prompts for a personal access token
supabase link --project-ref <your-project-ref>   # found in Project Settings > API
supabase db push                 # applies supabase/migrations/*.sql, in filename order
```

Verify, then load the demo factory:

```bash
npm run verify:db
psql "$SUPABASE_DB_URL" -f supabase/seed.sql
npm run verify:db                # expect: ALL CHECKS PASSED
```

`supabase db push` applies all four migrations in order. Load `seed.sql` only
after they succeed — the seed depends on all eleven tables existing and on
`0002` having granted the API roles access.

You can also paste either file into Dashboard > **SQL Editor** > **New query**
and run it. That avoids installing the CLI entirely.

### If you would rather not use the CLI

Open Dashboard > **SQL Editor**, paste
`supabase/migrations/0001_initial_schema.sql`, run it, confirm all eleven tables
appear, then paste `supabase/seed.sql` and run it. Same result.

```bash
npm run typecheck    # tsc --noEmit
npm test             # vitest run
npm run build        # next build
```

### Apply the database

See "Connecting to your Supabase project" above — either `supabase db push`, or
paste the two SQL files into the dashboard's SQL Editor.

```bash
psql "$SUPABASE_DB_URL" -f supabase/migrations/0001_initial_schema.sql
psql "$SUPABASE_DB_URL" -f supabase/migrations/0002_grant_table_privileges.sql
psql "$SUPABASE_DB_URL" -f supabase/migrations/0003_transactional_schedule_replace.sql
psql "$SUPABASE_DB_URL" -f supabase/migrations/0004_energy_totals_aggregate.sql
psql "$SUPABASE_DB_URL" -f supabase/seed.sql   # demo data, optional
```

**`0002` is required.** `0001` creates the tables and enables RLS but does not
grant table privileges, so PostgREST answers every request with
`HTTP 403 permission denied for table factories`. Postgres checks privileges
before RLS, so this is a grant problem, not a row-filtering result — RLS
filtering returns `200` with an empty array. Skip `0002` and the API cannot
read or write anything.

**`0003` is required for writing schedule entries.** It adds
`replace_schedule_entries` and `append_schedule_entries`, which make replacing
or appending a schedule's entries a single transaction. Without it, `PUT` and
`POST` on `/schedules/:scheduleId/entries` fail with:

```
PGRST202  Could not find the function public.replace_schedule_entries(...)
```

which is PostgREST saying the function is missing from its schema cache — not
an authorization failure. Reads and every other endpoint are unaffected.
The migration revokes `EXECUTE` from `PUBLIC`, `anon` and `authenticated`,
because PostgREST grants it to `PUBLIC` by default and `authenticated` could
otherwise call the function directly and bypass the API's factory
authorization. Only `service_role` — the API server — may call it.

**`0004` is required for the energy summary.** It adds `energy_totals`, which
computes the `/energy-data/summary` totals in the database. That endpoint used
to fetch up to 50,000 readings and sum them in Node; past that limit it
reported a partial total as though it were complete, with nothing in the
response to say so. Without `0004` the endpoint answers with `PGRST202`. The
same `service_role`-only grant applies, for the same reason.

---

## Environment

Full documentation lives in [`.env.example`](.env.example). The short version:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<secret service-role key>
BYTEME_OFFLINE_MODE=false
```

### Offline (SQLite) mode

Set `BYTEME_OFFLINE_MODE=true` and the backend uses a local SQLite file instead
of Supabase. Nothing else changes: same routes, same repositories, same Zod row
schemas, same response envelopes.

```bash
# 1. create the schema and load the generic demo data (idempotent)
npm run offline:seed

# 2. point the backend at it
#    BYTEME_OFFLINE_MODE=true in .env.local
npm run dev
```

`BYTEME_OFFLINE_DB_PATH` chooses the file. Empty means `./byteme-offline.db`;
set it to `:memory:` for a throwaway database that never touches disk.

The two backends are selected in exactly one place — `client()` in
`lib/repositories/base.ts`:

```ts
export function client(): ServiceClient {
  if (isOfflineMode()) return createOfflineClient() as unknown as ServiceClient
  return getServiceClient()
}
```

Every repository already obtained its connection from that function and chained
PostgREST calls on it, so the offline adapter implements that same chainable
surface (`select`/`insert`/`upsert`/`update`/`delete`, the filters, `order`,
`limit`, `range`, `single`, `maybeSingle`, `.or()`) against SQLite. No
repository, service or route knows which database it is talking to.

What the adapter guarantees, so behaviour does not drift between backends:

- database-generated ids, matching `gen_random_uuid()`, so `insert()` without an
  id works;
- `RETURNING *` on writes, so callers see defaults the way PostgREST's
  `.insert().select()` reports them;
- `undefined` is omitted rather than written as NULL, so a column default
  applies exactly as it does over HTTP;
- `jsonb`, `boolean`, `numeric[]` and `timestamptz` round-trip through the
  existing `COLUMN_TYPES` map, which is why the Zod row schemas are unchanged;
- SQLite errors are mapped onto the Postgres codes `mapDatabaseError` already
  expects, so 409 / 400 / 500 come out identical;
- `.or()` fails loudly on syntax it does not understand rather than silently
  dropping a predicate.

Offline mode requires no credential and no network. `GET /api/v1/health`
probes whichever backend is active and reports the same body either way.

The optimizer is unchanged. While its interface is unconfirmed every
optimization endpoint still answers 503 in offline mode, and `dry_run` still
assembles a real problem document from the local data, so integration work can
proceed with no internet connection. ByteMe does not invent an optimizer
contract in either mode.

### Secret handling

`SUPABASE_SERVICE_ROLE_KEY` **must not** be prefixed with `NEXT_PUBLIC_`.
Anything `NEXT_PUBLIC_`-prefixed is inlined into the browser bundle by Next.js.

`lib/env.ts` enforces this: if `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY` or
`NEXT_PUBLIC_BYTEME_OPTIMIZER_API_KEY` is set, the process throws
`Security violation` instead of starting a request. The Supabase client in
`lib/supabase/client.ts` also throws if it is ever evaluated in a browser
context.

The service-role key bypasses Row Level Security by design. It is used only by
the API server. If a frontend needs Supabase access, give it the **anon** key
and let RLS decide what it may see — not the service-role key.

## Production hardening and deployment boundaries

### HTTP headers and HTTPS

Next.js applies `X-Content-Type-Options: nosniff`, a strict-origin referrer
policy, `X-Frame-Options: DENY`, and a restrictive `Permissions-Policy` to
responses. HSTS is added only when `NODE_ENV=production` and
HSTS is added only when the production build has `BYTEME_HSTS_ENABLED=true`; set that flag only after confirming production is
TLS configuration is outside this service's control.
No CSP is set: this is an API backend, and the frame policy already prevents
embedding without constraining any separately hosted client.

### Request bounds

JSON request bodies are read with a streaming **5 MiB** ceiling and a maximum
nesting depth of **64**. Oversized or excessively nested JSON returns the
standard 400 validation envelope; the request is rejected rather than
truncated. Pagination accepts `limit` from 1–200 and `offset` from 0–1,000,000.
Query strings are limited to 8 KiB and 64 parameters.
Bulk schemas also retain their explicit row limits (energy intervals and
schedule entries: 5,000 each; dependency edges: 500).

The optimizer's default timeout is 60 seconds, and configured values may not
exceed five minutes. The deadline covers the HTTP request, response-body read,
and decoding. Upstream response bodies, raw connection errors, and configured
URLs are not included in client-facing 502 details. Health-check failures also
use generic diagnostic text rather than returning driver messages or local
database paths.

### CORS, rate limiting, and logging

Custom CORS is not enabled. The API assumes same-origin or server-to-server
clients; browser clients on another origin need an explicit origin allowlist at
the deployment gateway. Do not add wildcard origins for authenticated requests.

The application has no distributed rate-limit store, so it deliberately does
not pretend that a process-local counter is production-wide protection. Apply
rate limits at the hosting platform, reverse proxy, or API gateway—especially
to optimizer requests and payload previews—before exposing the service
publicly. The API code does not log authorization headers, tokens, or request
bodies; ensure deployment access logs also redact the `Authorization` header.

Offline SQLite mode remains opt-in (`BYTEME_OFFLINE_MODE=false` by default).
Use it in production only with persistent storage, backups, and a strong
server-only `BYTEME_OFFLINE_JWT_SECRET` of at least 32 bytes; protected routes
fail closed if it is missing or shorter. The default in-memory mode is intended
for tests and throwaway runs.

---

## Project structure

```
backend/
├── app/
│   └── api/v1/                        # 26 REST routes
├── lib/
│   ├── env.ts                         # server-only env access, blocks NEXT_PUBLIC_ secrets
│   ├── errors.ts                      # typed errors carrying HTTP status + code
│   ├── http.ts                        # response envelopes, request parsing, error mapping
│   ├── supabase/                      # service-role client (server-only)
│   ├── offline/                       # SQLite backend (BYTEME_OFFLINE_MODE=true)
│   │   ├── mode.ts                    # isOfflineMode()
│   │   ├── db.ts                      # lazy, configurable connection
│   │   ├── schema.ts                  # DDL mirroring migration 0001 + column kinds
│   │   ├── init.ts                    # idempotent schema creation
│   │   ├── adapter.ts                 # PostgREST-compatible query builder
│   │   ├── writes.ts                  # atomic schedule writes (mirrors migration 0003)
│   │   ├── aggregates.ts              # DB-side aggregates (mirrors migration 0004)
│   │   └── seed.ts                    # generic demo data
│   ├── schemas/                       # Zod schemas, one module per entity
│   ├── repositories/                  # data access, one per table
│   ├── services/                      # orchestration across repositories
│   └── optimizer/                     # THE integration boundary
│       ├── contract.ts                # problem/solution types + open questions
│       ├── payload.ts                 # database rows -> problem document
│       └── client.ts                  # transport; refuses to guess the interface
├── supabase/
│   ├── migrations/0001_initial_schema.sql
│   ├── migrations/0002_grant_table_privileges.sql
│   ├── migrations/0003_transactional_schedule_replace.sql
│   ├── migrations/0004_energy_totals_aggregate.sql
│   └── seed.sql                       # DEMO DATA ONLY
├── tests/
├── .env.example
└── vitest.config.ts
```

Request flow: `route.ts` → `lib/services` → `lib/repositories` → `client()` →
Supabase **or** SQLite. Routes handle HTTP only; repositories own queries;
services compose.

---

## Data model

All tables carry `created_at` / `updated_at` (maintained by a trigger) and all
tables have **Row Level Security enabled**.

| Table | Purpose | Key columns |
| --- | --- | --- |
| `factories` | A manufacturing site | `slug`, `timezone`, `currency`, `config` JSONB, `metadata` JSONB |
| `machines` | Any production asset | `type`, `rated/min/max_power_kw`, `min/max_runtime_minutes`, `availability` JSONB |
| `processes` | An operation on a machine | `duration_minutes`, `machine_id`, `power_requirement_kw`, `production_quantity` |
| `process_dependencies` | Directed process edges | `process_id`, `depends_on_process_id`, `dependency_type`, `lag_minutes` |
| `production_orders` | Demand to satisfy | `reference`, `quantity`, `due_at`, `priority`, `status`, `requirements` JSONB |
| `energy_data` | Meter readings | `recorded_at`, `interval_minutes`, `consumption_kwh`, `generation_kwh` |
| `electricity_tariffs` | Time-of-use pricing | `start_time`, `end_time`, `days_of_week`, `energy_price_per_kwh`, `demand_charge_per_kw` |
| `optimization_requests` | One scheduling attempt | `status`, `horizon_*`, `objective`, `constraints`, `request_payload` JSONB |
| `optimization_results` | An optimizer's answer | `objective_value`, `solution` JSONB, `metrics` JSONB |
| `schedules` | An accepted plan | `horizon_*`, `status`, `total_energy_cost`, `peak_demand_kw` |
| `schedule_entries` | Machine/process intervals | `starts_at`, `ends_at`, `power_kw`, `energy_kwh`, `cost` |

### Conventions

- **Units.** Power in kW, energy in kWh, duration in minutes, prices per kWh.
  `tax_rate` is a fraction (`0.21`), not a percentage.
- **Timestamps.** ISO-8601 with an offset, stored as `timestamptz`. Schedules
  are compared in UTC; `factories.timezone` tells the optimizer how to render
  local time for tariff windows.
- **Availability calendar.** `machines.availability` uses a convention, not a
  SQL constraint:
  ```json
  {
    "weekly": [{ "day": 1, "start": "06:00", "end": "22:00" }],
    "exceptions": [{ "from": "2026-01-01", "to": "2026-01-02", "available": false }]
  }
  ```
  `day` is an ISO weekday (1 = Monday). If the optimizer team wants a different
  shape, change `availabilitySchema` in `lib/schemas/machines.ts` — it is one
  place.
- **Genericity.** Anything that varies per factory lives in a JSONB column, not
  a new column or table. `machines.type` is free text on purpose: there is no
  industry enum in the schema.

### RLS posture

| Role | Access |
| --- | --- |
| `service_role` | Full access, bypassing RLS. API server only. Never in a browser. |
| `authenticated` | Full CRUD. The normal default for a first-party dashboard. |
| `anon` | **None.** No policy is created, so the role is denied on every table. |

Narrow the `authenticated` policies to per-user or per-tenant claims before
exposing ByteMe to real customers.

---

## API

Base path `/api/v1`. Every response uses one of two envelopes:

```jsonc
// success
{ "data": <payload>, "meta": { "total": 42, "limit": 50, "offset": 0 } }

// failure
{ "error": { "code": "validation_error", "message": "...", "details": { "issues": [...] } } }
```

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness, database reachability, optimizer readiness |
| `GET` | `/factories` | List factories |
| `POST` | `/factories` | Create a factory |
| `GET` `PATCH` `DELETE` | `/factories/:factoryId` | Read, update, delete |
| `GET` `PATCH` `PUT` | `/factories/:factoryId/config` | Read, merge, replace configuration |
| `GET` | `/factories/:factoryId/summary` | Counts, energy window, optimizer status |
| `GET` | `/factories/:factoryId/payload` | Preview the optimizer payload |
| `GET` `POST` | `/factories/:factoryId/machines` | List, create |
| `GET` `PATCH` `DELETE` | `/factories/:factoryId/machines/:machineId` | Read, update, delete |
| `GET` `POST` | `/factories/:factoryId/processes` | List, create |
| `GET` `PATCH` `DELETE` | `/factories/:factoryId/processes/:processId` | Read, update, delete |
| `GET` `POST` | `/factories/:factoryId/process-dependencies` | List, create one or many |
| `GET` `PATCH` `DELETE` | `/factories/:factoryId/process-dependencies/:dependencyId` | Read, update, delete |
| `GET` `POST` | `/factories/:factoryId/production-orders` | List, create |
| `GET` `PATCH` `DELETE` | `/factories/:factoryId/production-orders/:orderId` | Read, update, delete |
| `GET` `POST` | `/factories/:factoryId/energy-data` | List, ingest one or many |
| `GET` | `/factories/:factoryId/energy-data/summary` | Measured consumption/generation totals |
| `GET` `PATCH` `DELETE` | `/factories/:factoryId/energy-data/:energyId` | Read, update, delete |
| `GET` `POST` | `/factories/:factoryId/tariffs` | List, create |
| `GET` `PATCH` `DELETE` | `/factories/:factoryId/tariffs/:tariffId` | Read, update, delete |
| `GET` `POST` | `/factories/:factoryId/schedules` | List, create |
| `GET` `PATCH` `DELETE` | `/factories/:factoryId/schedules/:scheduleId` | Read with entries, update, delete |
| `GET` `POST` `PUT` | `/factories/:factoryId/schedules/:scheduleId/entries` | List, append, replace all |
| `GET` `PATCH` `DELETE` | `…/schedules/:scheduleId/entries/:entryId` | Read, move, delete |
| `GET` `POST` | `/factories/:factoryId/optimization-requests` | List, run an optimization |
| `GET` `PATCH` `DELETE` | `/factories/:factoryId/optimization-requests/:requestId` | Read, update status, delete |
| `GET` `POST` | `/factories/:factoryId/optimization-results` | List, record a result |
| `GET` `PATCH` `DELETE` | `/factories/:factoryId/optimization-results/:resultId` | Read, update, delete |

### Query parameters

Pagination: `?limit=` (1–200, default 50), `?offset=`.
Sorting: `?sort=field` or `?sort=-field` for descending. Invalid values are
rejected with 400.

Filters: `is_active`, `type` (machines), `status`, `due_before`, `due_after`
(orders), `from`, `to`, `machine_id`, `source` (energy data), `active_at`
(tariffs and schedules), `include_dependencies` (processes).

### Status codes

| Code | Meaning |
| --- | --- |
| `200` | Read succeeded |
| `201` | Created (with `Location`) |
| `400` | Zod validation failed, or a database constraint rejected the write |
| `404` | Resource does not exist |
| `409` | Unique violation, or overlapping machine entries |
| `500` | Unexpected failure, or the server is missing configuration (`configuration_error`) |
| `502` | Optimizer reachable but unusable |
| `503` | Optimizer not configured, or database unreachable |

---

## Optimizer integration

**This is the part to read before writing any optimizer code.**

### What ByteMe does NOT do

It does not assume the optimizer's URL, endpoint path, HTTP method, request
body, response format, or authentication scheme. None of those are defaults,
guesses, or "probably POST". Guessing them is exactly the failure this adapter
exists to prevent, and a silently wrong guess would produce plausible-looking
nonsense.

### The three files

| File | Responsibility |
| --- | --- |
| [`lib/optimizer/contract.ts`](lib/optimizer/contract.ts) | `OptimizationProblem` (what ByteMe describes) and `OptimizationSolution` (the minimum ByteMe will store), plus `OPEN_OPTIMIZER_QUESTIONS` |
| [`lib/optimizer/payload.ts`](lib/optimizer/payload.ts) | Turns database rows into an `OptimizationProblem`. Pure data, no solving |
| [`lib/optimizer/client.ts`](lib/optimizer/client.ts) | `OptimizerTransport`: sends the problem, decodes the reply. Returns 503 until fully configured |

### Behaviour right now

```
POST /factories/:id/optimization-requests
  → 503 Service Unavailable
    {
      "error": {
        "code": "service_unavailable",
        "message": "The optimizer is not configured, so no schedule was produced.",
        "details": {
          "reason": "BYTEME_OPTIMIZER_BASE_URL is not set.",
          "requiredConfiguration": [...],
          "openQuestions": [...],
          "payload_would_be_sent": { ... }   // the real problem document
        }
      }
    }
```

The request is recorded with status `not_configured` and the payload is stored
on the row. No schedule, result, or cost figure is fabricated. This is covered
by tests in `tests/optimizer-client.test.ts` and
`tests/optimization-service.test.ts`.

### Inspecting the payload today

Two ways, both working without the optimizer:

```bash
# No rows written. Returns the exact document that would be sent.
curl localhost:3000/api/v1/factories/$ID/payload

# Records an optimization_requests row with the payload.
curl -X POST localhost:3000/api/v1/factories/$ID/optimization-requests \
  -H 'content-type: application/json' \
  -d '{"dry_run": true}'
```

### Wiring up the real optimizer

Set all of these — none has a default:

```bash
BYTEME_OPTIMIZER_ENABLED=true
BYTEME_OPTIMIZER_BASE_URL=https://optimizer.internal
BYTEME_OPTIMIZER_SOLVE_PATH=/v1/solve
BYTEME_OPTIMIZER_SOLVE_METHOD=POST
BYTEME_OPTIMIZER_DECODER=byteme-envelope
BYTEME_OPTIMIZER_API_KEY=          # only if authenticated
```

If any one is missing, the adapter still refuses and explains exactly which one.
`decodeSolution()` in `lib/optimizer/client.ts` is the single function to
replace if the Python service answers with its own response shape.

### Questions for your teammate

These are tracked in `OPEN_OPTIMIZER_QUESTIONS` in
[`lib/optimizer/contract.ts`](lib/optimizer/contract.ts):

1. Endpoint path and HTTP method for submitting a problem
2. Whether to consume `OptimizationProblem` directly or a Python-specific schema
3. Response body shape, including how scheduled intervals are expressed
4. Synchronous solve versus submit-and-poll job id
5. Authentication scheme
6. Concurrency limits and maximum problem size
7. Idempotency and retry semantics
8. Unit agreement (kW, kWh, minutes, ISO-8601 UTC)

### Recording a result without HTTP

If the Python optimizer is easier to run out-of-band while the interface is
settled, POST its output to
`/factories/:factoryId/optimization-results`. The endpoint stores what it is
given, verbatim. It never constructs a solution from a request.

---

## Adding a factory

The schema needs no change. Insert a factory and its data:

```bash
# 1. The factory
curl -X POST localhost:3000/api/v1/factories -H 'content-type: application/json' -d '{
  "slug": "automobile-plant",
  "name": "Automobile Assembly Plant",
  "timezone": "Europe/Berlin",
  "currency": "EUR",
  "config": {
    "grid": { "max_import_kw": 8000 },
    "scheduling": { "max_parallel_machines": 6, "line_balance": { "takt_seconds": 62 } }
  },
  "metadata": { "industry": "automotive" }
}'

# 2. Its machines
curl -X POST localhost:3000/api/v1/factories/$FID/machines -H 'content-type: application/json' -d '{
  "slug": "welding-cell", "name": "Welding Cell", "type": "robot_cell",
  "rated_power_kw": 90, "min_power_kw": 12, "max_power_kw": 90,
  "availability": { "weekly": [{ "day": 1, "start": "06:00", "end": "22:00" }] }
}'

# 3. Processes, dependencies, orders, energy data, tariffs — same shape as the
#    chocolate demo, different values.
```

---

## Demo data

`supabase/seed.sql` creates one factory, `demo-chocolate-factory`, marked
`"demo": true` in both `config` and `metadata`:

- 7 machines (roasting drum, conche, tempering unit, moulding line, cooling
  tunnel, packing cell, rooftop PV)
- 8 processes forming a production chain
- 7 dependency edges
- 3 production orders
- 7 days of 15-minute energy intervals with a daylight PV curve
- 5 time-of-use tariffs

`lib/offline/seed.ts` provides a second, equally generic dataset for the SQLite
backend (1 factory, 7 machines, 6 processes, 5 dependency edges, 2 orders, 4
tariffs, 2 days of 15-minute intervals). It is also idempotent — it upserts on
natural keys and preserves existing primary keys, so re-running replaces the
demo instead of accumulating duplicates or orphaning children.

Load it with `npm run offline:seed`.

Both datasets are **idempotent** (upserts on natural keys) and **safe to
delete**. Neither seeds schedules or optimization results: those must come from
a real optimizer.

### SolarShift historical replay

The separate SolarShift replay importer creates factory-scoped HGD and LGD
scenarios from the Backend Chocolate seed and persists their NASA-derived
modeled generation, APERC kVAh windows, CP-SAT requests/results, and baseline
and optimized schedules in Supabase. It does not alter the existing demo
factory or enter the generic optimizer path.

Run the read-only verification first, then import only when ready to write to
the configured Supabase project:

```bash
npm run import:solarshift-historical -- --dry-run
npm run import:solarshift-historical
```

The script validates both approved 168-hour NASA POWER windows and their
approved totals before writing. It applies migration `0006` transactionally,
uses the `SUPABASE_DB_URL` in the backend `.env.local`, and requires the
repository `.venv` Python interpreter with OR-Tools installed. Scenario PV
capacity (300 kWp), performance ratio (0.80), regional point, timestamp
convention, and power factor (0.95) are explicit assumptions; modeled tariff
energy cost excludes APERC demand charges and minimum-billing rules and is not
a complete electricity bill.

`tests/schedule-totals.test.ts` enforces that no industry vocabulary appears
anywhere under `app/` or `lib/`, and that the migration file mentions no
industry at all.

---

## Testing

```bash
npm test          # 212 tests
npm run verify:db # check the live Supabase connection and seed data
```

| File | Covers |
| --- | --- |
| `tests/optimizer-client.test.ts` | 503 when unconfigured, refusal to guess a partial config, HTTP transport, response decoding, secret-leak guards |
| `tests/optimizer-payload.test.ts` | Payload is complete, generic, and preserves nulls rather than inventing defaults |
| `tests/optimization-service.test.ts` | Dry runs, 503 behaviour, cancelled orders excluded, no fabricated results |
| `tests/schemas.test.ts` | Every Zod schema, including cross-field rules mirroring SQL CHECK constraints |
| `tests/http.test.ts` | Response envelopes, status codes, PostgREST error mapping |
| `tests/schedule-totals.test.ts` | Peak-demand sweep, plus the generic-domain guardrail |
| `tests/env-local-skeleton.test.ts` | Blank `.env.local` is rejected as a config error, not silently accepted; no value is ever echoed |
| `tests/seed-sql.test.ts` | `seed.sql` VALUES aliases and tuple widths match, no column drift from the migration, and no schedules/results are seeded |
| `tests/migration-privileges.test.ts` | The API roles are granted table access and `anon` is granted nothing |
| `tests/schedule-transaction.test.ts` | A failed replacement or batch append rolls back completely (entries, totals and status), a successful one commits all three, and migration `0003` grants the functions to `service_role` only |
| `tests/data-integrity.test.ts` | Nothing is silently truncated: energy totals match a direct SQL aggregate past the old 50,000-row cap, whole schedules load across page boundaries past the old 10,000-entry cap, and an oversized optimization horizon is refused rather than shortened |
| `tests/offline-sqlite.test.ts` | The whole repository layer against SQLite: CRUD, json/boolean/array round-trips, `.or()` translation, pagination and exact counts, energy upsert conflict handling, Postgres error-code mapping, the optimizer's continued 503, and a guard that no credential can reach the database |

No test needs a live Supabase instance; the service-level test stubs the client
and the offline suite runs against an isolated in-memory database.

---

## Conventions

- Amounts are never formatted as strings; PostgREST `numeric` strings are coerced
  and re-validated on read.
- Every row returned from a repository is validated against its Zod row schema,
  so schema drift surfaces as a clear error rather than malformed JSON.
- Cross-field rules are enforced twice: in SQL `CHECK` constraints and in Zod,
  so a client gets a precise message instead of a bare constraint violation.
- Comments explain *why*, not *what*.