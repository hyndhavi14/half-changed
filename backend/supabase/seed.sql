-- ===========================================================================
-- ByteMe — seed.sql  (DEMO DATA ONLY)
--
-- The single factory below is a *demonstration* of a chocolate factory. It
-- exists purely to prove the generic schema works end to end and to give the
-- optimizer something to chew on during a first run.
--
-- Nothing in the schema, the API or the optimizer adapter knows about
-- chocolate. Delete this entire file and the system still works for an
-- automobile, textile, pharmaceutical, electronics or any other factory --
-- just insert a different factory row. See README.md -> "Adding a factory".
--
-- Idempotent: safe to re-run. Rows are keyed on their natural unique keys and
-- are upserted with `on conflict ... do update`.
--
-- Usage:
--   psql "$SUPABASE_DB_URL" -f supabase/seed.sql
--   or paste into the Supabase Studio SQL editor.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. The demo factory
-- ---------------------------------------------------------------------------
insert into public.factories (slug, name, description, timezone, currency, config, metadata)
values (
  'demo-chocolate-factory',
  'Demo Chocolate Factory',
  'DEMONSTRATION DATA ONLY. A fictional chocolate factory used to exercise the generic ByteMe scheduler. Not a real site.',
  'Europe/Amsterdam',
  'EUR',
  -- config: values the optimizer actually consumes.
  '{
    "demo": true,
    "demo_only": true,
    "grid": {
      "max_import_kw": 1200,
      "max_export_kw": 300,
      "voltage_kv": 10
    },
    "scheduling": {
      "max_parallel_machines": 4,
      "min_batch_size": 1,
      "allow_overlapping_production": true
    },
    "energy_balance": {
      "allow_export": true,
      "self_consumption_preferred": true
    }
  }'::jsonb,
  -- metadata: descriptive, no scheduling meaning.
  '{
    "demo": true,
    "industry": "confectionery",
    "purpose": "sample data for ByteMe demos and integration tests",
    "not_for_production_use": true,
    "replace_with": "your own factory rows"
  }'::jsonb
)
on conflict (slug) do update set
  name        = excluded.name,
  description = excluded.description,
  timezone    = excluded.timezone,
  currency    = excluded.currency,
  config      = excluded.config,
  metadata    = excluded.metadata;

-- ---------------------------------------------------------------------------
-- 2. Machines
--    Generic columns only: rated/min/max power, runtime window, availability
--    calendar, and free-form metadata.
-- ---------------------------------------------------------------------------
insert into public.machines
  (factory_id, slug, name, type, rated_power_kw, min_power_kw, max_power_kw,
   min_runtime_minutes, max_runtime_minutes, availability, metadata)
select f.id, v.slug, v.name, v.type, v.rated, v.min_p, v.max_p,
       v.min_rt, v.max_rt, v.availability::jsonb, v.metadata::jsonb
from public.factories f
cross join (values
  (
    'roasting-drum', 'Roasting Drum', 'thermal_asset',
    250.0, 90.0, 250.0, 30, 480,
    '{"weekly": [
       {"day": 1, "start": "06:00", "end": "22:00"},
       {"day": 2, "start": "06:00", "end": "22:00"},
       {"day": 3, "start": "06:00", "end": "22:00"},
       {"day": 4, "start": "06:00", "end": "22:00"},
       {"day": 5, "start": "06:00", "end": "22:00"}
     ], "exceptions": []}'::text,
    '{"demo": true, "heating": true, "thermal_mass_kg": 1200, "control": "pid"}'::text
  ),
  (
    'refining-conche', 'Refining Conche', 'rotational_asset',
    180.0, 60.0, 180.0, 60, 900,
    '{"weekly": [
       {"day": 1, "start": "06:00", "end": "22:00"},
       {"day": 2, "start": "06:00", "end": "22:00"},
       {"day": 3, "start": "06:00", "end": "22:00"},
       {"day": 4, "start": "06:00", "end": "22:00"},
       {"day": 5, "start": "06:00", "end": "22:00"},
       {"day": 6, "start": "08:00", "end": "14:00"}
     ], "exceptions": []}'::text,
    '{"demo": true, "heating": false, "scrapes_per_hour": 4, "noise_db": 82}'::text
  ),
  (
    'tempering-unit', 'Tempering Unit', 'thermal_asset',
    90.0, 25.0, 90.0, 20, 240,
    '{"weekly": [
       {"day": 1, "start": "07:00", "end": "20:00"},
       {"day": 2, "start": "07:00", "end": "20:00"},
       {"day": 3, "start": "07:00", "end": "20:00"},
       {"day": 4, "start": "07:00", "end": "20:00"},
       {"day": 5, "start": "07:00", "end": "20:00"}
     ], "exceptions": []}'::text,
    '{"demo": true, "heating": true, "temperature_c": {"min": 28, "max": 34}}'::text
  ),
  (
    'moulding-line', 'Moulding Line', 'conveyor',
    140.0, 45.0, 140.0, 45, 600,
    '{"weekly": [
       {"day": 1, "start": "06:00", "end": "22:00"},
       {"day": 2, "start": "06:00", "end": "22:00"},
       {"day": 3, "start": "06:00", "end": "22:00"},
       {"day": 4, "start": "06:00", "end": "22:00"},
       {"day": 5, "start": "06:00", "end": "22:00"}
     ], "exceptions": []}'::text,
    '{"demo": true, "heating": false, "line_speed_units_per_hour": 4200}'::text
  ),
  (
    'cooling-tunnel', 'Cooling Tunnel', 'thermal_asset',
    110.0, 30.0, 110.0, 15, 180,
    '{"weekly": [
       {"day": 1, "start": "06:00", "end": "22:00"},
       {"day": 2, "start": "06:00", "end": "22:00"},
       {"day": 3, "start": "06:00", "end": "22:00"},
       {"day": 4, "start": "06:00", "end": "22:00"},
       {"day": 5, "start": "06:00", "end": "22:00"}
     ], "exceptions": []}'::text,
    '{"demo": true, "heating": false, "cooling": true, "target_temp_c": 18}'::text
  ),
  (
    'packing-cell', 'Packing Cell', 'handling_asset',
    45.0, 12.0, 45.0, 20, 360,
    '{"weekly": [
       {"day": 1, "start": "08:00", "end": "20:00"},
       {"day": 2, "start": "08:00", "end": "20:00"},
       {"day": 3, "start": "08:00", "end": "20:00"},
       {"day": 4, "start": "08:00", "end": "20:00"},
       {"day": 5, "start": "08:00", "end": "20:00"}
     ], "exceptions": []}'::text,
    '{"demo": true, "heating": false, "shifts": 2}'::text
  ),
  (
    'rooftop-pv-array', 'Rooftop PV Array', 'generator',
    null, null, 300.0, null, null,
    '{"weekly": [], "exceptions": [], "note": "generation-only asset"}'::text,
    '{"demo": true, "generation": true, "peak_kw": 300, "orientation": "south", "tilt_deg": 30}'::text
  )
) as v(slug, name, type, rated, min_p, max_p, min_rt, max_rt, availability, metadata)
where f.slug = 'demo-chocolate-factory'
on conflict (factory_id, slug) do update set
  name                  = excluded.name,
  type                  = excluded.type,
  rated_power_kw        = excluded.rated_power_kw,
  min_power_kw          = excluded.min_power_kw,
  max_power_kw          = excluded.max_power_kw,
  min_runtime_minutes   = excluded.min_runtime_minutes,
  max_runtime_minutes   = excluded.max_runtime_minutes,
  availability          = excluded.availability,
  metadata              = excluded.metadata;

-- ---------------------------------------------------------------------------
-- 3. Processes  (machine_id resolved from slug)
-- ---------------------------------------------------------------------------
insert into public.processes
  (factory_id, slug, name, description, duration_minutes, machine_id,
   power_requirement_kw, production_quantity, unit, metadata)
select f.id, v.slug, v.name, v.description, v.duration, m.id,
       v.power_kw, v.qty, v.unit, v.metadata::jsonb
from public.factories f
join (values
  ('roast-bean-blend',  'Roast Bean Blend',  'DEMO. Blend and roast cocoa beans.',                 120, 'roasting-drum',  250.0,  500.0, 'kg', '{"demo": true, "stage": "roasting", "temperature_c": {"min": 110, "max": 150}}'),
  ('grind-nibs',        'Grind Nibs',        'DEMO. Crack and grind roasted nibs.',                60,  'roasting-drum',  200.0,  480.0, 'kg', '{"demo": true, "stage": "grinding"}'),
  ('conche-refine',     'Conche Refine',     'DEMO. Refine mass in the conche.',                   300, 'refining-conche', 165.0, 450.0, 'kg', '{"demo": true, "stage": "refining"}'),
  ('age-maturation',    'Age Maturation',    'DEMO. Hold mass for maturation.',                     720, 'refining-conche',  60.0, 450.0, 'kg', '{"demo": true, "stage": "maturation", "blocking": true}'),
  ('temper-mass',       'Temper Mass',       'DEMO. Temper the mass to the required curve.',        60,  'tempering-unit',  85.0,  400.0, 'kg', '{"demo": true, "stage": "tempering", "temperature_c": {"min": 28, "max": 34}}'),
  ('mould-shell',       'Mould Shell',       'DEMO. Deposit shells in moulds.',                      60,  'moulding-line',   130.0, 3000.0, 'kg', '{"demo": true, "stage": "moulding"}'),
  ('cool-and-demould',  'Cool And Demould',  'DEMO. Cool then demould the shells.',                  30,  'cooling-tunnel',   95.0, 3000.0, 'kg', '{"demo": true, "stage": "cooling", "blocking": true}'),
  ('pack-retail',       'Pack Retail',       'DEMO. Wrap and case the product for retail.',          30,  'packing-cell',     38.0, 3000.0, 'kg', '{"demo": true, "stage": "packing"}')
) as v(slug, name, description, duration, machine_slug, power_kw, qty, unit, metadata) on true
join public.machines m
  on m.factory_id = f.id
 and m.slug = v.machine_slug
where f.slug = 'demo-chocolate-factory'
on conflict (factory_id, slug) do update set
  name                  = excluded.name,
  description           = excluded.description,
  duration_minutes      = excluded.duration_minutes,
  machine_id            = excluded.machine_id,
  power_requirement_kw  = excluded.power_requirement_kw,
  production_quantity   = excluded.production_quantity,
  unit                  = excluded.unit,
  metadata              = excluded.metadata;

-- ---------------------------------------------------------------------------
-- 4. Process dependencies  (a generic production chain)
-- ---------------------------------------------------------------------------
insert into public.process_dependencies
  (factory_id, process_id, depends_on_process_id, dependency_type, lag_minutes, metadata)
select f.id, p.id, d.id, v.dep_type, v.lag, v.metadata::jsonb
from public.factories f
join (values
  ('grind-nibs',       'roast-bean-blend',  'finish_to_start',   0.0, '{"demo": true}'::text),
  ('conche-refine',    'grind-nibs',        'finish_to_start',   0.0, '{"demo": true}'::text),
  ('age-maturation',   'conche-refine',     'finish_to_start',   0.0, '{"demo": true}'::text),
  ('temper-mass',      'age-maturation',    'finish_to_start',   0.0, '{"demo": true}'::text),
  ('mould-shell',      'temper-mass',       'finish_to_start',   0.0, '{"demo": true}'::text),
  ('cool-and-demould', 'mould-shell',       'finish_to_start',   0.0, '{"demo": true}'::text),
  ('pack-retail',      'cool-and-demould',  'finish_to_start',   0.0, '{"demo": true}'::text)
) as v(process_slug, depends_on_slug, dep_type, lag, metadata) on true
join public.processes p
  on p.factory_id = f.id
 and p.slug = v.process_slug
join public.processes d
  on d.factory_id = f.id
 and d.slug = v.depends_on_slug
where f.slug = 'demo-chocolate-factory'
on conflict (process_id, depends_on_process_id) do update set
  dependency_type = excluded.dependency_type,
  lag_minutes     = excluded.lag_minutes,
  metadata        = excluded.metadata;

-- ---------------------------------------------------------------------------
-- 5. Production orders
-- ---------------------------------------------------------------------------
insert into public.production_orders
  (factory_id, reference, product, quantity, unit, due_at, priority, status, requirements, metadata)
select f.id, v.reference, v.product, v.qty, v.unit, now() + make_interval(hours => v.due_in_hours),
       v.priority, 'released', v.requirements::jsonb, v.metadata::jsonb
from public.factories f
cross join (values
  ('PO-DEMO-0001', 'DEMO. Dark bar 70%, 5 t',        5000.0, 'kg', 36, 10,
   '{"demo": true, "temperature_c": {"min": 28, "max": 34}, "requires": ["grind-nibs"]}'::text,
   '{"demo": true, "customer_tier": "retail"}'::text),
  ('PO-DEMO-0002', 'DEMO. Milk bar 40%, 3 t',        3000.0, 'kg', 60,  5,
   '{"demo": true, "temperature_c": {"min": 28, "max": 34}}'::text,
   '{"demo": true, "customer_tier": "retail"}'::text),
  ('PO-DEMO-0003', 'DEMO. Bulk couverture 2 t',       2000.0, 'kg', 96,  0,
   '{"demo": true}'::text,
   '{"demo": true, "customer_tier": "wholesale"}'::text)
) as v(reference, product, qty, unit, due_in_hours, priority, requirements, metadata)
where f.slug = 'demo-chocolate-factory'
on conflict (factory_id, reference) do update set
  product      = excluded.product,
  quantity     = excluded.quantity,
  unit         = excluded.unit,
  priority     = excluded.priority,
  requirements = excluded.requirements,
  metadata     = excluded.metadata;

-- ---------------------------------------------------------------------------
-- 6. Energy data  (7 days of 15-minute site-level intervals)
--    Deterministic pseudo-random values so re-running gives identical data.
-- ---------------------------------------------------------------------------
insert into public.energy_data
  (factory_id, recorded_at, interval_minutes, consumption_kwh, generation_kwh, machine_id, source, metadata)
select
  f.id,
  t.ts,
  15,
  round((600 + 260 * (0.5 + 0.5 * sin(2 * pi() * extract(epoch from t.ts) / 86400.0))
        + 35 * sin(17.0 * extract(epoch from t.ts) / 3600.0))::numeric, 4),
  -- Hourly solar power is quantized to 0.2 kW, then converted to 15-minute kWh.
  case
    when extract(hour from t.ts at time zone 'Europe/Amsterdam') between 8 and 17
      then round((280 * greatest(0.0, sin(pi() * (extract(hour from t.ts at time zone 'Europe/Amsterdam') - 8) / 9.0)))::numeric * 5) / 20
    else 0
  end,
  null,
  'simulated',
  '{"demo": true, "note": "synthetic demonstration series"}'::jsonb
from public.factories f
cross join generate_series(
  date_trunc('day', now()),
  date_trunc('day', now()) + interval '7 days',
  interval '15 minutes'
) as t(ts)
where f.slug = 'demo-chocolate-factory'
-- The conflict target must name the unique index energy_data_unique_interval_idx;
-- Postgres rejects `on conflict do update` without one.
on conflict (factory_id, coalesce(machine_id, '00000000-0000-0000-0000-000000000000'::uuid), recorded_at) do update set
  generation_kwh = excluded.generation_kwh,
  source = excluded.source;

-- ---------------------------------------------------------------------------
-- 7. Electricity tariffs  (time-of-use)
-- ---------------------------------------------------------------------------
insert into public.electricity_tariffs
  (factory_id, slug, name, currency, start_time, end_time, days_of_week,
   energy_price_per_kwh, demand_charge_per_kw, fixed_charge, tax_rate,
   effective_from, priority, metadata)
select f.id, v.slug, v.name, 'EUR', v.start_time, v.end_time, v.days_of_week,
       v.price, v.demand, v.fixed, v.tax, date_trunc('day', now()), v.priority, v.metadata::jsonb
from public.factories f
cross join (values
  ('off-peak',  'DEMO. Off-peak (night)',        '22:00'::time, '07:00'::time, null,
   0.0850, 0.0, 0.0, 0.21, 10, '{"demo": true, "band": "off_peak"}'::text),
  ('shoulder',  'DEMO. Shoulder',                 '07:00'::time, '22:00'::time, null,
   0.1420, 0.0, 0.0, 0.21, 10, '{"demo": true, "band": "shoulder"}'::text),
  ('peak',      'DEMO. Peak (weekday evening)',   '17:00'::time, '22:00'::time,
   array[1, 2, 3, 4, 5]::smallint[],
   0.2180, 0.0, 0.0, 0.21, 20, '{"demo": true, "band": "peak"}'::text),
  ('peak-sat',  'DEMO. Peak (Saturday)',          '08:00'::time, '20:00'::time,
   array[6]::smallint[],
   0.1650, 0.0, 0.0, 0.21, 20, '{"demo": true, "band": "peak"}'::text),
  ('demand',    'DEMO. Monthly demand charge',    '00:00'::time, '23:59'::time, null,
   0.0000, 18.50, 145.00, 0.21, 30, '{"demo": true, "band": "demand", "billing": "monthly"}'::text)
) as v(slug, name, start_time, end_time, days_of_week, price, demand, fixed, tax, priority, metadata)
where f.slug = 'demo-chocolate-factory'
on conflict (factory_id, slug) do update set
  name                 = excluded.name,
  currency             = excluded.currency,
  -- Start at midnight so the tariff also covers today's earlier energy readings.
  effective_from       = least(public.electricity_tariffs.effective_from, excluded.effective_from),
  start_time           = excluded.start_time,
  end_time             = excluded.end_time,
  days_of_week         = excluded.days_of_week,
  energy_price_per_kwh = excluded.energy_price_per_kwh,
  demand_charge_per_kw = excluded.demand_charge_per_kw,
  fixed_charge         = excluded.fixed_charge,
  tax_rate             = excluded.tax_rate,
  priority             = excluded.priority,
  metadata             = excluded.metadata;

commit;

-- ---------------------------------------------------------------------------
-- Sanity summary
-- ---------------------------------------------------------------------------
do $$
declare
  target uuid;
begin
  select id into target from public.factories where slug = 'demo-chocolate-factory';

  if target is null then
    raise notice 'Seed failed: demo factory not found.';
    return;
  end if;

  raise notice 'ByteMe demo seed complete for factory %', target;
  raise notice '  machines:            %', (select count(*) from public.machines where factory_id = target);
  raise notice '  processes:           %', (select count(*) from public.processes where factory_id = target);
  raise notice '  dependencies:        %', (select count(*) from public.process_dependencies where factory_id = target);
  raise notice '  production orders:   %', (select count(*) from public.production_orders where factory_id = target);
  raise notice '  energy intervals:    %', (select count(*) from public.energy_data where factory_id = target);
  raise notice '  tariffs:             %', (select count(*) from public.electricity_tariffs where factory_id = target);
  raise notice 'No schedules or optimization results are seeded: ByteMe never fabricates those.';
end;
$$;