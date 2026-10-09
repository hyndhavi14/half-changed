-- ===========================================================================
-- ByteMe — 0001_initial_schema
--
-- Generic electricity-scheduling schema for manufacturing clusters.
--
-- DESIGN RULES ENFORCED HERE
--   1. No industry-specific tables, columns, enums or check constraints.
--      This schema describes manufacturing in general terms only.
--      Anything factory-specific lives in `metadata` / `config` JSONB.
--   2. Power is expressed in kW, energy in kWh, prices per kWh.
--   3. Every tenant-owned table carries `factory_id` so the API can scope.
--   4. Row Level Security is ENABLED on every table.
-- ===========================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Shared trigger: keep updated_at honest.
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- factories
-- ---------------------------------------------------------------------------
create table public.factories (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  description text,
  -- IANA timezone used for local-time interpretation (tariffs, schedules).
  timezone    text not null default 'UTC',
  currency    text not null default 'USD',
  -- Grid/utility contract limits, optimisation knobs, and anything else that
  -- varies per factory. Generic by design.
  config      jsonb not null default '{}'::jsonb,
  -- Free-form, factory-specific attributes with no scheduling meaning.
  metadata    jsonb not null default '{}'::jsonb,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint factories_slug_format check (slug ~ '^[a-z0-9][a-z0-9_-]{1,62}$'),
  constraint factories_config_is_object check (jsonb_typeof(config) = 'object'),
  constraint factories_metadata_is_object check (jsonb_typeof(metadata) = 'object')
);

create index factories_is_active_idx on public.factories (is_active);
create index factories_metadata_gin on public.factories using gin (metadata jsonb_path_ops);

comment on table public.factories is
  'A manufacturing site. All other tables are scoped to a factory.';

create trigger factories_set_updated_at
  before update on public.factories
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- machines  (any production asset: furnace, line, cell, kiln, chiller, ...)
-- ---------------------------------------------------------------------------
create table public.machines (
  id                    uuid primary key default gen_random_uuid(),
  factory_id            uuid not null references public.factories (id) on delete cascade,
  slug                  text not null,
  name                  text not null,
  -- Generic machine class, e.g. 'furnace', 'assembly_line', 'chiller'.
  -- Free text on purpose: no industry enum lives in the schema.
  type                  text,
  -- Electrical envelope, all in kW.
  rated_power_kw        numeric(12, 4),
  min_power_kw          numeric(12, 4),
  max_power_kw          numeric(12, 4),
  -- Operating envelope, in minutes. Used by the optimiser for batching.
  min_runtime_minutes   numeric(12, 4),
  max_runtime_minutes   numeric(12, 4),
  -- Availability calendar. Shape (convention, not enforced by SQL):
  --   { "weekly": [ { "day": 1, "start": "06:00", "end": "22:00" } ],
  --     "exceptions": [ { "from": "2026-01-01", "to": "2026-01-02",
  --                       "available": false } ] }
  availability          jsonb not null default '{}'::jsonb,
  metadata              jsonb not null default '{}'::jsonb,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint machines_factory_slug_key unique (factory_id, slug),
  constraint machines_slug_format check (slug ~ '^[a-z0-9][a-z0-9_-]{1,62}$'),
  constraint machines_rated_power_non_negative check (rated_power_kw is null or rated_power_kw >= 0),
  constraint machines_min_power_non_negative check (min_power_kw is null or min_power_kw >= 0),
  constraint machines_max_power_non_negative check (max_power_kw is null or max_power_kw >= 0),
  constraint machines_power_bounds_ordered check (
    (min_power_kw is null or max_power_kw is null or min_power_kw <= max_power_kw)
    and (min_power_kw is null or rated_power_kw is null or min_power_kw <= rated_power_kw)
    and (rated_power_kw is null or max_power_kw is null or rated_power_kw <= max_power_kw)
  ),
  constraint machines_runtime_bounds_ordered check (
    min_runtime_minutes is null or max_runtime_minutes is null
    or min_runtime_minutes <= max_runtime_minutes
  ),
  constraint machines_availability_is_object check (jsonb_typeof(availability) = 'object'),
  constraint machines_metadata_is_object check (jsonb_typeof(metadata) = 'object')
);

create index machines_factory_idx on public.machines (factory_id);
create index machines_factory_type_idx on public.machines (factory_id, type);
create index machines_factory_active_idx on public.machines (factory_id, is_active);

create trigger machines_set_updated_at
  before update on public.machines
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- processes  (an operation a machine can perform)
-- ---------------------------------------------------------------------------
create table public.processes (
  id                       uuid primary key default gen_random_uuid(),
  factory_id               uuid not null references public.factories (id) on delete cascade,
  slug                     text not null,
  name                     text not null,
  description              text,
  -- Baseline duration when run at nominal power.
  duration_minutes         numeric(12, 4),
  -- The machine required to run this process.
  machine_id               uuid not null references public.machines (id) on delete restrict,
  power_requirement_kw     numeric(12, 4),
  -- Nominal output of one run.
  production_quantity      numeric(14, 4),
  unit                     text,
  metadata                 jsonb not null default '{}'::jsonb,
  is_active                boolean not null default true,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint processes_factory_slug_key unique (factory_id, slug),
  constraint processes_slug_format check (slug ~ '^[a-z0-9][a-z0-9_-]{1,62}$'),
  constraint processes_duration_non_negative check (duration_minutes is null or duration_minutes >= 0),
  constraint processes_power_non_negative check (power_requirement_kw is null or power_requirement_kw >= 0),
  constraint processes_quantity_non_negative check (production_quantity is null or production_quantity >= 0),
  constraint processes_metadata_is_object check (jsonb_typeof(metadata) = 'object')
);

create index processes_factory_idx on public.processes (factory_id);
create index processes_machine_idx on public.processes (machine_id);
create index processes_factory_active_idx on public.processes (factory_id, is_active);

create trigger processes_set_updated_at
  before update on public.processes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- process_dependencies  (directed edge: process -> depends_on_process)
-- ---------------------------------------------------------------------------
create table public.process_dependencies (
  id                   uuid primary key default gen_random_uuid(),
  factory_id           uuid not null references public.factories (id) on delete cascade,
  process_id           uuid not null references public.processes (id) on delete cascade,
  depends_on_process_id uuid not null references public.processes (id) on delete cascade,
  -- Generic precedence semantics. Concrete values (FS/SS/FF/SF, lag, ...)
  -- are a convention agreed with the optimiser, not an industry concept.
  dependency_type      text not null default 'finish_to_start',
  lag_minutes          numeric(12, 4) not null default 0,
  metadata             jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint process_dependencies_unique_edge unique (process_id, depends_on_process_id),
  constraint process_dependencies_no_self_loop check (process_id <> depends_on_process_id),
  constraint process_dependencies_dependency_type_valid check (
    dependency_type in ('finish_to_start', 'start_to_start', 'finish_to_finish', 'start_to_finish')
  ),
  constraint process_dependencies_lag_non_negative check (lag_minutes >= 0),
  constraint process_dependencies_metadata_is_object check (jsonb_typeof(metadata) = 'object')
);

create index process_dependencies_factory_idx on public.process_dependencies (factory_id);
create index process_dependencies_process_idx on public.process_dependencies (process_id);
create index process_dependencies_depends_on_idx on public.process_dependencies (depends_on_process_id);

create trigger process_dependencies_set_updated_at
  before update on public.process_dependencies
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- production_orders  (demand the schedule must satisfy)
-- ---------------------------------------------------------------------------
create table public.production_orders (
  id              uuid primary key default gen_random_uuid(),
  factory_id      uuid not null references public.factories (id) on delete cascade,
  reference       text not null,
  -- What to make. Free text: a SKU, a recipe, a part number, a batch id.
  product          text,
  quantity         numeric(14, 4) not null,
  unit             text,
  due_at           timestamptz,
  -- Higher wins. 0 is neutral.
  priority         integer not null default 0,
  status           text not null default 'planned',
  -- Order-specific requirements (tolerances, resource reservations, ...).
  requirements     jsonb not null default '{}'::jsonb,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint production_orders_factory_reference_key unique (factory_id, reference),
  constraint production_orders_quantity_positive check (quantity > 0),
  constraint production_orders_status_valid check (
    status in ('planned', 'released', 'in_progress', 'completed', 'cancelled', 'on_hold')
  ),
  constraint production_orders_requirements_is_object check (jsonb_typeof(requirements) = 'object'),
  constraint production_orders_metadata_is_object check (jsonb_typeof(metadata) = 'object')
);

create index production_orders_factory_idx on public.production_orders (factory_id);
create index production_orders_factory_due_idx on public.production_orders (factory_id, due_at);
create index production_orders_factory_status_idx on public.production_orders (factory_id, status);

create trigger production_orders_set_updated_at
  before update on public.production_orders
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- energy_data  (measured or forecast consumption/generation per interval)
-- ---------------------------------------------------------------------------
create table public.energy_data (
  id                 uuid primary key default gen_random_uuid(),
  factory_id         uuid not null references public.factories (id) on delete cascade,
  recorded_at        timestamptz not null,
  interval_minutes   integer not null default 15,
  consumption_kwh    numeric(16, 6) not null default 0,
  generation_kwh     numeric(16, 6) not null default 0,
  -- Optional attribution to a single machine; NULL means site-level.
  machine_id         uuid references public.machines (id) on delete cascade,
  -- 'measured', 'forecast', 'simulated', ...
  source             text not null default 'measured',
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),

  constraint energy_data_interval_positive check (interval_minutes > 0),
  constraint energy_data_consumption_non_negative check (consumption_kwh >= 0),
  constraint energy_data_generation_non_negative check (generation_kwh >= 0),
  constraint energy_data_metadata_is_object check (jsonb_typeof(metadata) = 'object')
);

create index energy_data_factory_recorded_idx on public.energy_data (factory_id, recorded_at desc);
create index energy_data_machine_idx on public.energy_data (machine_id) where machine_id is not null;
-- Guard against duplicate intervals for the same (factory, machine, timestamp).
create unique index energy_data_unique_interval_idx
  on public.energy_data (factory_id, coalesce(machine_id, '00000000-0000-0000-0000-000000000000'::uuid), recorded_at);

-- ---------------------------------------------------------------------------
-- electricity_tariffs  (time-of-use pricing)
-- ---------------------------------------------------------------------------
create table public.electricity_tariffs (
  id                     uuid primary key default gen_random_uuid(),
  factory_id             uuid not null references public.factories (id) on delete cascade,
  slug                   text not null,
  name                   text not null,
  currency               text not null default 'USD',
  -- Local time window. start_time = end_time means "all day".
  start_time             time not null default '00:00',
  end_time               time not null default '23:59',
  -- ISO weekdays (1 = Monday .. 7 = Sunday). NULL means every day.
  days_of_week           smallint[],
  -- 0 = Sunday .. 6 = Saturday. NULL means every day.
  energy_price_per_kwh   numeric(12, 6) not null,
  demand_charge_per_kw   numeric(12, 6),
  fixed_charge           numeric(12, 6),
  tax_rate               numeric(6, 4),
  -- Validity window of this price row.
  effective_from         timestamptz,
  effective_to           timestamptz,
  -- Lower wins when windows overlap.
  priority               integer not null default 0,
  metadata               jsonb not null default '{}'::jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint electricity_tariffs_factory_slug_key unique (factory_id, slug),
  constraint electricity_tariffs_slug_format check (slug ~ '^[a-z0-9][a-z0-9_-]{1,62}$'),
  constraint electricity_tariffs_price_non_negative check (energy_price_per_kwh >= 0),
  constraint electricity_tariffs_demand_charge_non_negative check (
    demand_charge_per_kw is null or demand_charge_per_kw >= 0
  ),
  constraint electricity_tariffs_fixed_charge_non_negative check (
    fixed_charge is null or fixed_charge >= 0
  ),
  constraint electricity_tariffs_tax_rate_valid check (tax_rate is null or (tax_rate >= 0 and tax_rate <= 1)),
  constraint electricity_tariffs_days_of_week_valid check (
    days_of_week is null
    or (
      cardinality(days_of_week) > 0
      and days_of_week <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
    )
  ),
  constraint electricity_tariffs_effective_window_ordered check (
    effective_from is null or effective_to is null or effective_from < effective_to
  ),
  constraint electricity_tariffs_metadata_is_object check (jsonb_typeof(metadata) = 'object')
);

create index electricity_tariffs_factory_idx on public.electricity_tariffs (factory_id);
create index electricity_tariffs_factory_priority_idx on public.electricity_tariffs (factory_id, priority desc);

create trigger electricity_tariffs_set_updated_at
  before update on public.electricity_tariffs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- optimization_requests  (one attempt to schedule a factory)
-- ---------------------------------------------------------------------------
create table public.optimization_requests (
  id              uuid primary key default gen_random_uuid(),
  factory_id      uuid not null references public.factories (id) on delete cascade,
  -- Correlation id we hand to the optimiser adapter.
  reference       text not null,
  status          text not null default 'pending',
  horizon_start   timestamptz,
  horizon_end     timestamptz,
  -- Weights/preferences, e.g. { "cost": 1.0, "peak_demand": 0.2 }.
  objective       jsonb not null default '{}'::jsonb,
  -- Scheduling constraints such as max parallel machines or grid caps.
  constraints     jsonb not null default '{}'::jsonb,
  -- Exactly the payload handed to the optimiser adapter, for reproducibility.
  request_payload jsonb,
  -- Free-form adapter metadata (endpoint fingerprint, adapter version).
  -- Never used to infer an endpoint when it is absent.
  adapter_metadata jsonb,
  error_message   text,
  created_by      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint optimization_requests_factory_reference_key unique (factory_id, reference),
  constraint optimization_requests_status_valid check (
    status in ('pending', 'queued', 'running', 'succeeded', 'failed', 'cancelled', 'not_configured')
  ),
  constraint optimization_requests_horizon_ordered check (
    horizon_start is null or horizon_end is null or horizon_start < horizon_end
  ),
  constraint optimization_requests_objective_is_object check (jsonb_typeof(objective) = 'object'),
  constraint optimization_requests_constraints_is_object check (jsonb_typeof(constraints) = 'object')
);

create index optimization_requests_factory_idx on public.optimization_requests (factory_id);
create index optimization_requests_factory_status_idx on public.optimization_requests (factory_id, status);
create index optimization_requests_created_at_idx on public.optimization_requests (created_at desc);

create trigger optimization_requests_set_updated_at
  before update on public.optimization_requests
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- optimization_results  (raw optimiser answer, not yet a schedule)
-- ---------------------------------------------------------------------------
create table public.optimization_results (
  id                       uuid primary key default gen_random_uuid(),
  factory_id               uuid not null references public.factories (id) on delete cascade,
  optimization_request_id  uuid references public.optimization_requests (id) on delete cascade,
  status                   text not null default 'succeeded',
  objective_value          numeric(18, 6),
  total_energy_cost        numeric(18, 6),
  total_energy_kwh         numeric(18, 6),
  peak_demand_kw           numeric(14, 4),
  -- The adapter's decoded response, stored verbatim. Scheduling code reads it
  -- through the adapter contract, never by guessing field names.
  solution                 jsonb,
  -- Solver statistics (runtime, iterations, gap, ...).
  metrics                  jsonb not null default '{}'::jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint optimization_results_factory_request_key unique (factory_id, optimization_request_id),
  constraint optimization_results_status_valid check (
    status in ('succeeded', 'failed', 'partial')
  ),
  constraint optimization_results_metrics_is_object check (jsonb_typeof(metrics) = 'object')
);

create index optimization_results_factory_idx on public.optimization_results (factory_id);
create index optimization_results_request_idx on public.optimization_results (optimization_request_id);

create trigger optimization_results_set_updated_at
  before update on public.optimization_results
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- schedules  (an accepted, publishable plan)
-- ---------------------------------------------------------------------------
create table public.schedules (
  id                       uuid primary key default gen_random_uuid(),
  factory_id               uuid not null references public.factories (id) on delete cascade,
  name                     text not null,
  version                  integer not null default 1,
  status                   text not null default 'draft',
  horizon_start            timestamptz not null,
  horizon_end              timestamptz not null,
  optimization_request_id  uuid references public.optimization_requests (id) on delete set null,
  optimization_result_id   uuid references public.optimization_results (id) on delete set null,
  -- Denormalised totals, for reporting without recomputation.
  total_energy_cost        numeric(18, 6),
  total_energy_kwh         numeric(18, 6),
  peak_demand_kw           numeric(14, 4),
  metadata                 jsonb not null default '{}'::jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint schedules_factory_name_version_key unique (factory_id, name, version),
  constraint schedules_version_positive check (version > 0),
  constraint schedules_status_valid check (
    status in ('draft', 'published', 'active', 'completed', 'superseded', 'cancelled')
  ),
  constraint schedules_horizon_ordered check (horizon_start < horizon_end),
  constraint schedules_metadata_is_object check (jsonb_typeof(metadata) = 'object')
);

create index schedules_factory_idx on public.schedules (factory_id);
create index schedules_factory_status_idx on public.schedules (factory_id, status);
create index schedules_horizon_idx on public.schedules (factory_id, horizon_start, horizon_end);

create trigger schedules_set_updated_at
  before update on public.schedules
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- schedule_entries  (one machine running one process over one interval)
-- ---------------------------------------------------------------------------
create table public.schedule_entries (
  id                   uuid primary key default gen_random_uuid(),
  schedule_id          uuid not null references public.schedules (id) on delete cascade,
  machine_id           uuid not null references public.machines (id) on delete restrict,
  process_id           uuid not null references public.processes (id) on delete restrict,
  production_order_id  uuid references public.production_orders (id) on delete set null,
  starts_at            timestamptz not null,
  ends_at              timestamptz not null,
  power_kw             numeric(12, 4),
  energy_kwh           numeric(16, 6),
  cost                 numeric(18, 6),
  quantity             numeric(14, 4),
  -- Ordering hint when several entries start at the same instant.
  sequence             integer not null default 0,
  metadata             jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint schedule_entries_window_ordered check (ends_at > starts_at),
  constraint schedule_entries_power_non_negative check (power_kw is null or power_kw >= 0),
  constraint schedule_entries_energy_non_negative check (energy_kwh is null or energy_kwh >= 0),
  constraint schedule_entries_metadata_is_object check (jsonb_typeof(metadata) = 'object')
);

create index schedule_entries_schedule_idx on public.schedule_entries (schedule_id);
create index schedule_entries_machine_idx on public.schedule_entries (machine_id);
create index schedule_entries_process_idx on public.schedule_entries (process_id);
create index schedule_entries_window_idx on public.schedule_entries (schedule_id, starts_at, ends_at);

create trigger schedule_entries_set_updated_at
  before update on public.schedule_entries
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- Row Level Security
--
-- Enabled on every table. RLS only applies to roles that do NOT bypass it:
--   - `service_role` (the key ByteMe's API uses) bypasses RLS by design. It
--     must never reach a browser — see .env.example and lib/env.ts.
--   - `anon` has NO policy on any table, therefore no access at all.
--   - `authenticated` gets full CRUD, which is the normal Supabase default for
--     a first-party dashboard. Narrow these to per-user or per-tenant claims
--     before exposing ByteMe to real customers.
-- ===========================================================================
alter table public.factories             enable row level security;
alter table public.machines              enable row level security;
alter table public.processes             enable row level security;
alter table public.process_dependencies  enable row level security;
alter table public.production_orders     enable row level security;
alter table public.energy_data           enable row level security;
alter table public.electricity_tariffs   enable row level security;
alter table public.optimization_requests enable row level security;
alter table public.optimization_results  enable row level security;
alter table public.schedules             enable row level security;
alter table public.schedule_entries      enable row level security;

do $$
declare
  target text;
begin
  foreach target in array array[
    'factories',
    'machines',
    'processes',
    'process_dependencies',
    'production_orders',
    'energy_data',
    'electricity_tariffs',
    'optimization_requests',
    'optimization_results',
    'schedules',
    'schedule_entries'
  ]
  loop
    -- Full access for signed-in first-party users.
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true)',
      target || '_authenticated_all', target
    );
  end loop;

  -- No `anon` policy is created on purpose: with RLS enabled and zero matching
  -- policies, the anonymous role is denied on every table. Add an explicit
  -- policy here if a public read-only view is ever required.
end;
$$;