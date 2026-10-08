-- ===========================================================================
-- ByteMe — seed_demo_factories.sql  (DEMO DATA ONLY, generated — do not edit by hand)
--
-- Adds the optimizer's demo factory configurations (optimizer/factory_data.py) as
-- database factories so they appear in the factory selector. Run AFTER seed.sql.
-- Regenerate with: python backend/scripts/generate_demo_factories_seed.py
--
-- Does not touch 'demo-chocolate-factory'. Idempotent: safe to re-run.
-- Solar is SIMULATED (optimizer/energy_data.py DEMO_SOLAR_PROFILE); tariffs are the
-- seed.sql DEMO windows in EUR; consumption is not recorded. No schedules are seeded:
-- run the optimizer from the app to create them.
--
-- Factories: demo-cosmetics-factory, demo-food-factory, demo-beverage-factory, demo-pharmaceutical-factory, demo-automotive-factory, demo-furniture-factory
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- Demo Cosmetics Factory  (optimizer/factory_data.py key 'cosmetics')
-- ---------------------------------------------------------------------------

insert into public.factories (slug, name, description, timezone, currency, config, metadata)
values ('demo-cosmetics-factory', 'Demo Cosmetics Factory',
  'DEMONSTRATION DATA ONLY. Generated from the optimizer demo configuration ''cosmetics''. Not a real site.',
  'Europe/Amsterdam', 'EUR',
  '{"demo": true, "demo_only": true, "note": "Deadline and horizon are informational; the backend uses the optimization horizon as the deadline.", "optimizer_config_key": "cosmetics", "planning_horizon_hours": 24, "production_deadline_hours": 16, "source": "optimizer/factory_data.py"}'::jsonb,
  '{"demo": true, "generated_by": "backend/scripts/generate_demo_factories_seed.py", "industry": "cosmetics", "not_for_production_use": true}'::jsonb)
on conflict (slug) do update set
  name = excluded.name, description = excluded.description, timezone = excluded.timezone,
  currency = excluded.currency, config = excluded.config, metadata = excluded.metadata;

insert into public.machines (factory_id, slug, name, rated_power_kw, metadata)
select f.id, v.slug, v.name, v.rated, v.metadata
from public.factories f
cross join (values
  ('weigh-station', 'Weighing Station', 5.0, '{"availability_note": "single unit", "capacity": 1, "demo": true, "optimizer_machine_id": "weigh_station"}'::jsonb),
  ('prep-bench', 'Preparation Bench', 8.0, '{"availability_note": "single unit", "capacity": 1, "demo": true, "optimizer_machine_id": "prep_bench"}'::jsonb),
  ('mix-tank', 'Mixing Tank (shared)', 30.0, '{"availability_note": "single tank, shared by lines", "capacity": 1, "demo": true, "optimizer_machine_id": "mix_tank"}'::jsonb),
  ('emulsifier', 'Emulsifier', 48.0, '{"availability_note": "single unit", "capacity": 1, "demo": true, "optimizer_machine_id": "emulsifier"}'::jsonb),
  ('homogenizer', 'Homogenizer', 36.0, '{"availability_note": "single unit", "capacity": 1, "demo": true, "optimizer_machine_id": "homogenizer"}'::jsonb),
  ('cooling-jacket', 'Cooling Jacket', 20.0, '{"availability_note": "single unit", "capacity": 1, "demo": true, "optimizer_machine_id": "cooling_jacket"}'::jsonb),
  ('filler', 'Filling Line (shared)', 18.0, '{"availability_note": "single line, shared", "capacity": 1, "demo": true, "optimizer_machine_id": "filler"}'::jsonb),
  ('labeler', 'Labeler', 6.0, '{"availability_note": "single unit", "capacity": 1, "demo": true, "optimizer_machine_id": "labeler"}'::jsonb),
  ('pack-station', 'Packing Station', 8.0, '{"availability_note": "single unit", "capacity": 1, "demo": true, "optimizer_machine_id": "pack_station"}'::jsonb),
  ('qc-station', 'QC Station', 5.0, '{"availability_note": "single unit", "capacity": 1, "demo": true, "optimizer_machine_id": "qc_station"}'::jsonb)
) as v(slug, name, rated, metadata)
where f.slug = 'demo-cosmetics-factory'
on conflict (factory_id, slug) do update set
  name = excluded.name, rated_power_kw = excluded.rated_power_kw, metadata = excluded.metadata;

insert into public.processes (factory_id, slug, name, duration_minutes, machine_id, power_requirement_kw, production_quantity, metadata)
select f.id, v.slug, v.name, v.duration, m.id, v.power_kw, v.qty, v.metadata
from public.factories f
join (values
  ('weighing', 'Raw Material Weighing', 60, 'weigh-station', 5.0, 2000.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": false, "optimizer_process_id": "weighing"}'::jsonb),
  ('prep', 'Preparation', 60, 'prep-bench', 8.0, 2000.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "prep"}'::jsonb),
  ('mixing-line1', 'Mixing - Product Line 1', 120, 'mix-tank', 30.0, 1000.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "mixing_line1"}'::jsonb),
  ('mixing-line2', 'Mixing - Product Line 2', 90, 'mix-tank', 25.0, 1000.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "mixing_line2"}'::jsonb),
  ('emulsification', 'Heating/Emulsification', 120, 'emulsifier', 45.0, 2000.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "emulsification"}'::jsonb),
  ('homogenization', 'Homogenization', 90, 'homogenizer', 35.0, 2000.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "homogenization"}'::jsonb),
  ('cooling', 'Cooling', 120, 'cooling-jacket', 20.0, 2000.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "cooling"}'::jsonb),
  ('filling', 'Filling', 120, 'filler', 18.0, 2000.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "filling"}'::jsonb),
  ('labeling', 'Labeling', 60, 'labeler', 6.0, 2000.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "labeling"}'::jsonb),
  ('packaging', 'Packaging', 60, 'pack-station', 8.0, 2000.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "packaging"}'::jsonb),
  ('quality-inspection', 'Quality Inspection', 60, 'qc-station', 5.0, 100.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": false, "optimizer_process_id": "quality_inspection"}'::jsonb)
) as v(slug, name, duration, machine_slug, power_kw, qty, metadata) on true
join public.machines m on m.factory_id = f.id and m.slug = v.machine_slug
where f.slug = 'demo-cosmetics-factory'
on conflict (factory_id, slug) do update set
  name = excluded.name, duration_minutes = excluded.duration_minutes, machine_id = excluded.machine_id,
  power_requirement_kw = excluded.power_requirement_kw, production_quantity = excluded.production_quantity,
  metadata = excluded.metadata;

insert into public.process_dependencies (factory_id, process_id, depends_on_process_id, dependency_type, lag_minutes, metadata)
select f.id, p.id, d.id, 'finish_to_start', 0, '{"demo": true}'::jsonb
from public.factories f
join (values
  ('prep', 'weighing'),
  ('mixing-line1', 'prep'),
  ('mixing-line2', 'prep'),
  ('emulsification', 'mixing-line1'),
  ('emulsification', 'mixing-line2'),
  ('homogenization', 'emulsification'),
  ('cooling', 'homogenization'),
  ('filling', 'cooling'),
  ('labeling', 'filling'),
  ('packaging', 'labeling'),
  ('quality-inspection', 'packaging')
) as v(process_slug, depends_on_slug) on true
join public.processes p on p.factory_id = f.id and p.slug = v.process_slug
join public.processes d on d.factory_id = f.id and d.slug = v.depends_on_slug
where f.slug = 'demo-cosmetics-factory'
on conflict (process_id, depends_on_process_id) do update set
  dependency_type = excluded.dependency_type, lag_minutes = excluded.lag_minutes, metadata = excluded.metadata;

-- Re-running on another day must not stretch the horizon: drop this file's own earlier solar rows first.
delete from public.energy_data e using public.factories f
where e.factory_id = f.id and f.slug = 'demo-cosmetics-factory'
  and e.metadata->>'profile' = 'optimizer/energy_data.py DEMO_SOLAR_PROFILE';

-- 24 hours of 15-minute site-level rows (the config's planning horizon; the backend derives the
-- optimization horizon from the first and last stored reading). Solar = DEMO_SOLAR_PROFILE (kW, local hour) / 4.
insert into public.energy_data (factory_id, recorded_at, interval_minutes, consumption_kwh, generation_kwh, machine_id, source, metadata)
select f.id, t.ts, 15, 0, p.kw / 4.0, null, 'simulated',
  '{"demo": true, "profile": "optimizer/energy_data.py DEMO_SOLAR_PROFILE", "subhourly": "flat within the hour", "consumption_recorded": false}'::jsonb
from public.factories f
cross join generate_series(date_trunc('day', now()), date_trunc('day', now()) + interval '24 hours', interval '15 minutes') as t(ts)
join (values (0, 0.0), (1, 0.0), (2, 0.0), (3, 0.0), (4, 0.0), (5, 0.0), (6, 5.0), (7, 15.0), (8, 30.0), (9, 45.0), (10, 60.0), (11, 70.0), (12, 75.0), (13, 70.0), (14, 60.0), (15, 45.0), (16, 30.0), (17, 15.0), (18, 5.0), (19, 0.0), (20, 0.0), (21, 0.0), (22, 0.0), (23, 0.0)) as p(hour, kw)
  on p.hour = extract(hour from t.ts at time zone 'Europe/Amsterdam')
where f.slug = 'demo-cosmetics-factory'
on conflict (factory_id, coalesce(machine_id, '00000000-0000-0000-0000-000000000000'::uuid), recorded_at) do update set
  consumption_kwh = excluded.consumption_kwh, generation_kwh = excluded.generation_kwh,
  source = excluded.source, metadata = excluded.metadata;

-- Same DEMO time-of-use windows as seed.sql (EUR, not converted).
insert into public.electricity_tariffs (factory_id, slug, name, currency, start_time, end_time, days_of_week,
  energy_price_per_kwh, demand_charge_per_kw, fixed_charge, tax_rate, effective_from, priority, metadata)
select f.id, v.slug, v.name, 'EUR', v.start_time, v.end_time, v.days_of_week,
  v.price, v.demand, v.fixed, v.tax, date_trunc('day', now()), v.priority, v.metadata::jsonb
from public.factories f
cross join (values
  ('off-peak', 'DEMO. Off-peak (night)', '22:00'::time, '07:00'::time, null::smallint[], 0.0850, 0.0, 0.0, 0.21, 10, '{"demo": true, "band": "off_peak"}'),
  ('shoulder', 'DEMO. Shoulder', '07:00'::time, '22:00'::time, null::smallint[], 0.1420, 0.0, 0.0, 0.21, 10, '{"demo": true, "band": "shoulder"}'),
  ('peak', 'DEMO. Peak (weekday evening)', '17:00'::time, '22:00'::time, array[1, 2, 3, 4, 5]::smallint[], 0.2180, 0.0, 0.0, 0.21, 20, '{"demo": true, "band": "peak"}'),
  ('peak-sat', 'DEMO. Peak (Saturday)', '08:00'::time, '20:00'::time, array[6]::smallint[], 0.1650, 0.0, 0.0, 0.21, 20, '{"demo": true, "band": "peak"}'),
  ('demand', 'DEMO. Monthly demand charge', '00:00'::time, '23:59'::time, null::smallint[], 0.0000, 18.50, 145.00, 0.21, 30, '{"demo": true, "band": "demand", "billing": "monthly"}')
) as v(slug, name, start_time, end_time, days_of_week, price, demand, fixed, tax, priority, metadata)
where f.slug = 'demo-cosmetics-factory'
on conflict (factory_id, slug) do update set
  name = excluded.name, currency = excluded.currency, start_time = excluded.start_time, end_time = excluded.end_time,
  days_of_week = excluded.days_of_week, energy_price_per_kwh = excluded.energy_price_per_kwh,
  demand_charge_per_kw = excluded.demand_charge_per_kw, fixed_charge = excluded.fixed_charge,
  tax_rate = excluded.tax_rate, effective_from = excluded.effective_from, priority = excluded.priority,
  metadata = excluded.metadata;

-- ---------------------------------------------------------------------------
-- Demo Food Factory  (optimizer/factory_data.py key 'food')
-- ---------------------------------------------------------------------------

insert into public.factories (slug, name, description, timezone, currency, config, metadata)
values ('demo-food-factory', 'Demo Food Factory',
  'DEMONSTRATION DATA ONLY. Generated from the optimizer demo configuration ''food''. Not a real site.',
  'Europe/Amsterdam', 'EUR',
  '{"demo": true, "demo_only": true, "note": "Deadline and horizon are informational; the backend uses the optimization horizon as the deadline.", "optimizer_config_key": "food", "planning_horizon_hours": 20, "production_deadline_hours": 18, "source": "optimizer/factory_data.py"}'::jsonb,
  '{"demo": true, "generated_by": "backend/scripts/generate_demo_factories_seed.py", "industry": "food", "not_for_production_use": true}'::jsonb)
on conflict (slug) do update set
  name = excluded.name, description = excluded.description, timezone = excluded.timezone,
  currency = excluded.currency, config = excluded.config, metadata = excluded.metadata;

insert into public.machines (factory_id, slug, name, rated_power_kw, metadata)
select f.id, v.slug, v.name, v.rated, v.metadata
from public.factories f
cross join (values
  ('prep-area', 'Prep Area', 8.0, '{"availability_note": "single area", "capacity": 1, "demo": true, "optimizer_machine_id": "prep_area"}'::jsonb),
  ('wash-line-1', 'Wash Line 1', 15.0, '{"availability_note": "single unit", "capacity": 1, "demo": true, "optimizer_machine_id": "wash_line_1"}'::jsonb),
  ('wash-line-2', 'Wash Line 2', 15.0, '{"availability_note": "single unit", "capacity": 1, "demo": true, "optimizer_machine_id": "wash_line_2"}'::jsonb),
  ('cutter', 'Industrial Cutter', 24.0, '{"availability_note": "single unit", "capacity": 1, "demo": true, "optimizer_machine_id": "cutter"}'::jsonb),
  ('food-mixer', 'Food Mixer', 20.0, '{"availability_note": "single unit", "capacity": 1, "demo": true, "optimizer_machine_id": "food_mixer"}'::jsonb),
  ('cooker', 'Industrial Cooker', 65.0, '{"availability_note": "single unit", "capacity": 1, "demo": true, "optimizer_machine_id": "cooker"}'::jsonb),
  ('chiller', 'Chiller', 25.0, '{"availability_note": "single unit", "capacity": 1, "demo": true, "optimizer_machine_id": "chiller"}'::jsonb),
  ('qc-bench', 'QC Bench', 5.0, '{"availability_note": "single unit", "capacity": 1, "demo": true, "optimizer_machine_id": "qc_bench"}'::jsonb),
  ('pack-line', 'Packaging Line', 12.0, '{"availability_note": "single unit", "capacity": 1, "demo": true, "optimizer_machine_id": "pack_line"}'::jsonb),
  ('cold-store', 'Refrigerated Store', 6.0, '{"availability_note": "single store", "capacity": 1, "demo": true, "optimizer_machine_id": "cold_store"}'::jsonb)
) as v(slug, name, rated, metadata)
where f.slug = 'demo-food-factory'
on conflict (factory_id, slug) do update set
  name = excluded.name, rated_power_kw = excluded.rated_power_kw, metadata = excluded.metadata;

insert into public.processes (factory_id, slug, name, duration_minutes, machine_id, power_requirement_kw, production_quantity, metadata)
select f.id, v.slug, v.name, v.duration, m.id, v.power_kw, v.qty, v.metadata
from public.factories f
join (values
  ('raw-prep', 'Raw Material Preparation', 60, 'prep-area', 8.0, 3000.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": false, "optimizer_process_id": "raw_prep"}'::jsonb),
  ('washing-line1', 'Washing/Cleaning Line 1', 60, 'wash-line-1', 15.0, 1500.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "washing_line1"}'::jsonb),
  ('washing-line2', 'Washing/Cleaning Line 2', 60, 'wash-line-2', 15.0, 1500.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "washing_line2"}'::jsonb),
  ('cutting', 'Cutting/Processing', 90, 'cutter', 22.0, 2900.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "cutting"}'::jsonb),
  ('mixing', 'Mixing', 60, 'food-mixer', 18.0, 2900.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "mixing"}'::jsonb),
  ('cooking', 'Cooking/Heating', 120, 'cooker', 60.0, 2900.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "cooking"}'::jsonb),
  ('cooling', 'Cooling', 90, 'chiller', 25.0, 2900.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "cooling"}'::jsonb),
  ('quality-inspection', 'Quality Inspection', 60, 'qc-bench', 5.0, 60.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "quality_inspection"}'::jsonb),
  ('packaging', 'Packaging', 90, 'pack-line', 12.0, 2800.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "packaging"}'::jsonb),
  ('storage', 'Storage', 60, 'cold-store', 6.0, 2800.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "latest_finish_hours": 18, "optimizer_process_id": "storage"}'::jsonb)
) as v(slug, name, duration, machine_slug, power_kw, qty, metadata) on true
join public.machines m on m.factory_id = f.id and m.slug = v.machine_slug
where f.slug = 'demo-food-factory'
on conflict (factory_id, slug) do update set
  name = excluded.name, duration_minutes = excluded.duration_minutes, machine_id = excluded.machine_id,
  power_requirement_kw = excluded.power_requirement_kw, production_quantity = excluded.production_quantity,
  metadata = excluded.metadata;

insert into public.process_dependencies (factory_id, process_id, depends_on_process_id, dependency_type, lag_minutes, metadata)
select f.id, p.id, d.id, 'finish_to_start', 0, '{"demo": true}'::jsonb
from public.factories f
join (values
  ('washing-line1', 'raw-prep'),
  ('washing-line2', 'raw-prep'),
  ('cutting', 'washing-line1'),
  ('cutting', 'washing-line2'),
  ('mixing', 'cutting'),
  ('cooking', 'mixing'),
  ('cooling', 'cooking'),
  ('quality-inspection', 'cooling'),
  ('packaging', 'quality-inspection'),
  ('storage', 'packaging')
) as v(process_slug, depends_on_slug) on true
join public.processes p on p.factory_id = f.id and p.slug = v.process_slug
join public.processes d on d.factory_id = f.id and d.slug = v.depends_on_slug
where f.slug = 'demo-food-factory'
on conflict (process_id, depends_on_process_id) do update set
  dependency_type = excluded.dependency_type, lag_minutes = excluded.lag_minutes, metadata = excluded.metadata;

-- Re-running on another day must not stretch the horizon: drop this file's own earlier solar rows first.
delete from public.energy_data e using public.factories f
where e.factory_id = f.id and f.slug = 'demo-food-factory'
  and e.metadata->>'profile' = 'optimizer/energy_data.py DEMO_SOLAR_PROFILE';

-- 24 hours of 15-minute site-level rows (the config's planning horizon; the backend derives the
-- optimization horizon from the first and last stored reading). Solar = DEMO_SOLAR_PROFILE (kW, local hour) / 4.
insert into public.energy_data (factory_id, recorded_at, interval_minutes, consumption_kwh, generation_kwh, machine_id, source, metadata)
select f.id, t.ts, 15, 0, p.kw / 4.0, null, 'simulated',
  '{"demo": true, "profile": "optimizer/energy_data.py DEMO_SOLAR_PROFILE", "subhourly": "flat within the hour", "consumption_recorded": false}'::jsonb
from public.factories f
cross join generate_series(date_trunc('day', now()), date_trunc('day', now()) + interval '24 hours', interval '15 minutes') as t(ts)
join (values (0, 0.0), (1, 0.0), (2, 0.0), (3, 0.0), (4, 0.0), (5, 0.0), (6, 5.0), (7, 15.0), (8, 30.0), (9, 45.0), (10, 60.0), (11, 70.0), (12, 75.0), (13, 70.0), (14, 60.0), (15, 45.0), (16, 30.0), (17, 15.0), (18, 5.0), (19, 0.0), (20, 0.0), (21, 0.0), (22, 0.0), (23, 0.0)) as p(hour, kw)
  on p.hour = extract(hour from t.ts at time zone 'Europe/Amsterdam')
where f.slug = 'demo-food-factory'
on conflict (factory_id, coalesce(machine_id, '00000000-0000-0000-0000-000000000000'::uuid), recorded_at) do update set
  consumption_kwh = excluded.consumption_kwh, generation_kwh = excluded.generation_kwh,
  source = excluded.source, metadata = excluded.metadata;

-- Same DEMO time-of-use windows as seed.sql (EUR, not converted).
insert into public.electricity_tariffs (factory_id, slug, name, currency, start_time, end_time, days_of_week,
  energy_price_per_kwh, demand_charge_per_kw, fixed_charge, tax_rate, effective_from, priority, metadata)
select f.id, v.slug, v.name, 'EUR', v.start_time, v.end_time, v.days_of_week,
  v.price, v.demand, v.fixed, v.tax, date_trunc('day', now()), v.priority, v.metadata::jsonb
from public.factories f
cross join (values
  ('off-peak', 'DEMO. Off-peak (night)', '22:00'::time, '07:00'::time, null::smallint[], 0.0850, 0.0, 0.0, 0.21, 10, '{"demo": true, "band": "off_peak"}'),
  ('shoulder', 'DEMO. Shoulder', '07:00'::time, '22:00'::time, null::smallint[], 0.1420, 0.0, 0.0, 0.21, 10, '{"demo": true, "band": "shoulder"}'),
  ('peak', 'DEMO. Peak (weekday evening)', '17:00'::time, '22:00'::time, array[1, 2, 3, 4, 5]::smallint[], 0.2180, 0.0, 0.0, 0.21, 20, '{"demo": true, "band": "peak"}'),
  ('peak-sat', 'DEMO. Peak (Saturday)', '08:00'::time, '20:00'::time, array[6]::smallint[], 0.1650, 0.0, 0.0, 0.21, 20, '{"demo": true, "band": "peak"}'),
  ('demand', 'DEMO. Monthly demand charge', '00:00'::time, '23:59'::time, null::smallint[], 0.0000, 18.50, 145.00, 0.21, 30, '{"demo": true, "band": "demand", "billing": "monthly"}')
) as v(slug, name, start_time, end_time, days_of_week, price, demand, fixed, tax, priority, metadata)
where f.slug = 'demo-food-factory'
on conflict (factory_id, slug) do update set
  name = excluded.name, currency = excluded.currency, start_time = excluded.start_time, end_time = excluded.end_time,
  days_of_week = excluded.days_of_week, energy_price_per_kwh = excluded.energy_price_per_kwh,
  demand_charge_per_kw = excluded.demand_charge_per_kw, fixed_charge = excluded.fixed_charge,
  tax_rate = excluded.tax_rate, effective_from = excluded.effective_from, priority = excluded.priority,
  metadata = excluded.metadata;

-- ---------------------------------------------------------------------------
-- Demo Beverage Factory  (optimizer/factory_data.py key 'beverage')
-- ---------------------------------------------------------------------------

insert into public.factories (slug, name, description, timezone, currency, config, metadata)
values ('demo-beverage-factory', 'Demo Beverage Factory',
  'DEMONSTRATION DATA ONLY. Generated from the optimizer demo configuration ''beverage''. Not a real site.',
  'Europe/Amsterdam', 'EUR',
  '{"demo": true, "demo_only": true, "note": "Deadline and horizon are informational; the backend uses the optimization horizon as the deadline.", "optimizer_config_key": "beverage", "planning_horizon_hours": 22, "production_deadline_hours": 20, "source": "optimizer/factory_data.py"}'::jsonb,
  '{"demo": true, "generated_by": "backend/scripts/generate_demo_factories_seed.py", "industry": "beverage", "not_for_production_use": true}'::jsonb)
on conflict (slug) do update set
  name = excluded.name, description = excluded.description, timezone = excluded.timezone,
  currency = excluded.currency, config = excluded.config, metadata = excluded.metadata;

insert into public.machines (factory_id, slug, name, rated_power_kw, metadata)
select f.id, v.slug, v.name, v.rated, v.metadata
from public.factories f
cross join (values
  ('water-plant', 'Water Treatment Plant', 18.0, '{"availability_note": "single unit", "capacity": 1, "demo": true, "optimizer_machine_id": "water_plant"}'::jsonb),
  ('prep-station', 'Ingredient Prep Station', 8.0, '{"availability_note": "single unit", "capacity": 1, "demo": true, "optimizer_machine_id": "prep_station"}'::jsonb),
  ('syrup-mixer', 'Syrup Mixer', 22.0, '{"availability_note": "single unit", "capacity": 1, "demo": true, "optimizer_machine_id": "syrup_mixer"}'::jsonb),
  ('blender', 'Blending Vessel (shared)', 25.0, '{"availability_note": "single vessel, shared", "capacity": 1, "demo": true, "optimizer_machine_id": "blender"}'::jsonb),
  ('filter', 'Beverage Filter', 15.0, '{"availability_note": "single unit", "capacity": 1, "demo": true, "optimizer_machine_id": "filter"}'::jsonb),
  ('pasteurizer', 'Pasteurizer', 55.0, '{"availability_note": "single unit", "capacity": 1, "demo": true, "optimizer_machine_id": "pasteurizer"}'::jsonb),
  ('chiller', 'Beverage Chiller', 22.0, '{"availability_note": "single unit", "capacity": 1, "demo": true, "optimizer_machine_id": "chiller"}'::jsonb),
  ('filling-monoblock', 'Filling/Capping Monoblock (shared)', 30.0, '{"availability_note": "single monoblock, shared", "capacity": 1, "demo": true, "optimizer_machine_id": "filling_monoblock"}'::jsonb),
  ('labeler', 'Labeler', 10.0, '{"availability_note": "single unit", "capacity": 1, "demo": true, "optimizer_machine_id": "labeler"}'::jsonb),
  ('pack-line', 'Packaging Line', 12.0, '{"availability_note": "single unit", "capacity": 1, "demo": true, "optimizer_machine_id": "pack_line"}'::jsonb),
  ('qc-station', 'QC Station', 5.0, '{"availability_note": "single unit", "capacity": 1, "demo": true, "optimizer_machine_id": "qc_station"}'::jsonb)
) as v(slug, name, rated, metadata)
where f.slug = 'demo-beverage-factory'
on conflict (factory_id, slug) do update set
  name = excluded.name, rated_power_kw = excluded.rated_power_kw, metadata = excluded.metadata;

insert into public.processes (factory_id, slug, name, duration_minutes, machine_id, power_requirement_kw, production_quantity, metadata)
select f.id, v.slug, v.name, v.duration, m.id, v.power_kw, v.qty, v.metadata
from public.factories f
join (values
  ('water-treatment', 'Water Treatment', 120, 'water-plant', 18.0, 20000.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": false, "optimizer_process_id": "water_treatment"}'::jsonb),
  ('ingredient-prep', 'Ingredient Preparation', 60, 'prep-station', 8.0, 20000.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "ingredient_prep"}'::jsonb),
  ('syrup-mixing', 'Syrup/Ingredient Mixing', 90, 'syrup-mixer', 20.0, 15000.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "syrup_mixing"}'::jsonb),
  ('blending-a', 'Blending Line A', 60, 'blender', 25.0, 10000.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "blending_a"}'::jsonb),
  ('blending-b', 'Blending Line B', 60, 'blender', 25.0, 10000.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "blending_b"}'::jsonb),
  ('filtration', 'Filtration', 60, 'filter', 15.0, 20000.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "filtration"}'::jsonb),
  ('pasteurization', 'Pasteurization', 90, 'pasteurizer', 55.0, 20000.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "pasteurization"}'::jsonb),
  ('cooling', 'Cooling', 60, 'chiller', 22.0, 20000.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "cooling"}'::jsonb),
  ('filling', 'Filling', 120, 'filling-monoblock', 30.0, 40000.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "filling"}'::jsonb),
  ('capping', 'Capping', 60, 'filling-monoblock', 12.0, 40000.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "capping"}'::jsonb),
  ('labeling', 'Labeling', 60, 'labeler', 10.0, 40000.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "labeling"}'::jsonb),
  ('packaging', 'Packaging', 90, 'pack-line', 12.0, 40000.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "packaging"}'::jsonb),
  ('quality-inspection', 'Quality Inspection', 60, 'qc-station', 5.0, 200.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "quality_inspection"}'::jsonb)
) as v(slug, name, duration, machine_slug, power_kw, qty, metadata) on true
join public.machines m on m.factory_id = f.id and m.slug = v.machine_slug
where f.slug = 'demo-beverage-factory'
on conflict (factory_id, slug) do update set
  name = excluded.name, duration_minutes = excluded.duration_minutes, machine_id = excluded.machine_id,
  power_requirement_kw = excluded.power_requirement_kw, production_quantity = excluded.production_quantity,
  metadata = excluded.metadata;

insert into public.process_dependencies (factory_id, process_id, depends_on_process_id, dependency_type, lag_minutes, metadata)
select f.id, p.id, d.id, 'finish_to_start', 0, '{"demo": true}'::jsonb
from public.factories f
join (values
  ('ingredient-prep', 'water-treatment'),
  ('syrup-mixing', 'ingredient-prep'),
  ('blending-a', 'syrup-mixing'),
  ('blending-b', 'syrup-mixing'),
  ('filtration', 'blending-a'),
  ('filtration', 'blending-b'),
  ('pasteurization', 'filtration'),
  ('cooling', 'pasteurization'),
  ('filling', 'cooling'),
  ('capping', 'filling'),
  ('labeling', 'capping'),
  ('packaging', 'labeling'),
  ('quality-inspection', 'packaging')
) as v(process_slug, depends_on_slug) on true
join public.processes p on p.factory_id = f.id and p.slug = v.process_slug
join public.processes d on d.factory_id = f.id and d.slug = v.depends_on_slug
where f.slug = 'demo-beverage-factory'
on conflict (process_id, depends_on_process_id) do update set
  dependency_type = excluded.dependency_type, lag_minutes = excluded.lag_minutes, metadata = excluded.metadata;

-- Re-running on another day must not stretch the horizon: drop this file's own earlier solar rows first.
delete from public.energy_data e using public.factories f
where e.factory_id = f.id and f.slug = 'demo-beverage-factory'
  and e.metadata->>'profile' = 'optimizer/energy_data.py DEMO_SOLAR_PROFILE';

-- 24 hours of 15-minute site-level rows (the config's planning horizon; the backend derives the
-- optimization horizon from the first and last stored reading). Solar = DEMO_SOLAR_PROFILE (kW, local hour) / 4.
insert into public.energy_data (factory_id, recorded_at, interval_minutes, consumption_kwh, generation_kwh, machine_id, source, metadata)
select f.id, t.ts, 15, 0, p.kw / 4.0, null, 'simulated',
  '{"demo": true, "profile": "optimizer/energy_data.py DEMO_SOLAR_PROFILE", "subhourly": "flat within the hour", "consumption_recorded": false}'::jsonb
from public.factories f
cross join generate_series(date_trunc('day', now()), date_trunc('day', now()) + interval '24 hours', interval '15 minutes') as t(ts)
join (values (0, 0.0), (1, 0.0), (2, 0.0), (3, 0.0), (4, 0.0), (5, 0.0), (6, 5.0), (7, 15.0), (8, 30.0), (9, 45.0), (10, 60.0), (11, 70.0), (12, 75.0), (13, 70.0), (14, 60.0), (15, 45.0), (16, 30.0), (17, 15.0), (18, 5.0), (19, 0.0), (20, 0.0), (21, 0.0), (22, 0.0), (23, 0.0)) as p(hour, kw)
  on p.hour = extract(hour from t.ts at time zone 'Europe/Amsterdam')
where f.slug = 'demo-beverage-factory'
on conflict (factory_id, coalesce(machine_id, '00000000-0000-0000-0000-000000000000'::uuid), recorded_at) do update set
  consumption_kwh = excluded.consumption_kwh, generation_kwh = excluded.generation_kwh,
  source = excluded.source, metadata = excluded.metadata;

-- Same DEMO time-of-use windows as seed.sql (EUR, not converted).
insert into public.electricity_tariffs (factory_id, slug, name, currency, start_time, end_time, days_of_week,
  energy_price_per_kwh, demand_charge_per_kw, fixed_charge, tax_rate, effective_from, priority, metadata)
select f.id, v.slug, v.name, 'EUR', v.start_time, v.end_time, v.days_of_week,
  v.price, v.demand, v.fixed, v.tax, date_trunc('day', now()), v.priority, v.metadata::jsonb
from public.factories f
cross join (values
  ('off-peak', 'DEMO. Off-peak (night)', '22:00'::time, '07:00'::time, null::smallint[], 0.0850, 0.0, 0.0, 0.21, 10, '{"demo": true, "band": "off_peak"}'),
  ('shoulder', 'DEMO. Shoulder', '07:00'::time, '22:00'::time, null::smallint[], 0.1420, 0.0, 0.0, 0.21, 10, '{"demo": true, "band": "shoulder"}'),
  ('peak', 'DEMO. Peak (weekday evening)', '17:00'::time, '22:00'::time, array[1, 2, 3, 4, 5]::smallint[], 0.2180, 0.0, 0.0, 0.21, 20, '{"demo": true, "band": "peak"}'),
  ('peak-sat', 'DEMO. Peak (Saturday)', '08:00'::time, '20:00'::time, array[6]::smallint[], 0.1650, 0.0, 0.0, 0.21, 20, '{"demo": true, "band": "peak"}'),
  ('demand', 'DEMO. Monthly demand charge', '00:00'::time, '23:59'::time, null::smallint[], 0.0000, 18.50, 145.00, 0.21, 30, '{"demo": true, "band": "demand", "billing": "monthly"}')
) as v(slug, name, start_time, end_time, days_of_week, price, demand, fixed, tax, priority, metadata)
where f.slug = 'demo-beverage-factory'
on conflict (factory_id, slug) do update set
  name = excluded.name, currency = excluded.currency, start_time = excluded.start_time, end_time = excluded.end_time,
  days_of_week = excluded.days_of_week, energy_price_per_kwh = excluded.energy_price_per_kwh,
  demand_charge_per_kw = excluded.demand_charge_per_kw, fixed_charge = excluded.fixed_charge,
  tax_rate = excluded.tax_rate, effective_from = excluded.effective_from, priority = excluded.priority,
  metadata = excluded.metadata;

-- ---------------------------------------------------------------------------
-- Demo Pharmaceutical Factory  (optimizer/factory_data.py key 'pharmaceutical')
-- ---------------------------------------------------------------------------

insert into public.factories (slug, name, description, timezone, currency, config, metadata)
values ('demo-pharmaceutical-factory', 'Demo Pharmaceutical Factory',
  'DEMONSTRATION DATA ONLY. Generated from the optimizer demo configuration ''pharmaceutical''. Not a real site.',
  'Europe/Amsterdam', 'EUR',
  '{"demo": true, "demo_only": true, "note": "Deadline and horizon are informational; the backend uses the optimization horizon as the deadline.", "optimizer_config_key": "pharmaceutical", "planning_horizon_hours": 24, "production_deadline_hours": 20, "source": "optimizer/factory_data.py"}'::jsonb,
  '{"demo": true, "generated_by": "backend/scripts/generate_demo_factories_seed.py", "industry": "pharmaceutical", "not_for_production_use": true}'::jsonb)
on conflict (slug) do update set
  name = excluded.name, description = excluded.description, timezone = excluded.timezone,
  currency = excluded.currency, config = excluded.config, metadata = excluded.metadata;

insert into public.machines (factory_id, slug, name, rated_power_kw, metadata)
select f.id, v.slug, v.name, v.rated, v.metadata
from public.factories f
cross join (values
  ('dispensing-booth', 'Dispensing Booth', 5.0, '{"availability_note": "single booth (HEPA)", "capacity": 1, "demo": true, "optimizer_machine_id": "dispensing_booth"}'::jsonb),
  ('sieve', 'Vibratory Sieve', 8.0, '{"availability_note": "single unit", "capacity": 1, "demo": true, "optimizer_machine_id": "sieve"}'::jsonb),
  ('blender', 'Pharma Blender', 15.0, '{"availability_note": "single unit", "capacity": 1, "demo": true, "optimizer_machine_id": "blender"}'::jsonb),
  ('granulator', 'Granulator', 30.0, '{"availability_note": "single unit", "capacity": 1, "demo": true, "optimizer_machine_id": "granulator"}'::jsonb),
  ('dryer', 'Fluid Bed Dryer', 45.0, '{"availability_note": "single unit", "capacity": 1, "demo": true, "optimizer_machine_id": "dryer"}'::jsonb),
  ('mill', 'Pharma Mill', 18.0, '{"availability_note": "single unit", "capacity": 1, "demo": true, "optimizer_machine_id": "mill"}'::jsonb),
  ('press', 'Tablet Press', 25.0, '{"availability_note": "single unit", "capacity": 1, "demo": true, "optimizer_machine_id": "press"}'::jsonb),
  ('coater', 'Coating Pan', 20.0, '{"availability_note": "single unit", "capacity": 1, "demo": true, "optimizer_machine_id": "coater"}'::jsonb),
  ('qc-lab', 'QC Laboratory', 8.0, '{"availability_note": "single lab", "capacity": 1, "demo": true, "optimizer_machine_id": "qc_lab"}'::jsonb),
  ('pack-line', 'Blister Pack Line', 12.0, '{"availability_note": "single unit", "capacity": 1, "demo": true, "optimizer_machine_id": "pack_line"}'::jsonb)
) as v(slug, name, rated, metadata)
where f.slug = 'demo-pharmaceutical-factory'
on conflict (factory_id, slug) do update set
  name = excluded.name, rated_power_kw = excluded.rated_power_kw, metadata = excluded.metadata;

insert into public.processes (factory_id, slug, name, duration_minutes, machine_id, power_requirement_kw, production_quantity, metadata)
select f.id, v.slug, v.name, v.duration, m.id, v.power_kw, v.qty, v.metadata
from public.factories f
join (values
  ('dispensing', 'Raw Material Dispensing', 60, 'dispensing-booth', 5.0, 500000.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": false, "optimizer_process_id": "dispensing"}'::jsonb),
  ('sieving', 'Sieving', 60, 'sieve', 8.0, 500000.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "sieving"}'::jsonb),
  ('blending', 'Blending', 90, 'blender', 15.0, 500000.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "blending"}'::jsonb),
  ('granulation', 'Granulation', 120, 'granulator', 30.0, 500000.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "granulation"}'::jsonb),
  ('drying', 'Drying', 180, 'dryer', 45.0, 500000.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "drying"}'::jsonb),
  ('milling', 'Milling', 60, 'mill', 18.0, 500000.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "milling"}'::jsonb),
  ('compression', 'Tablet Compression', 150, 'press', 25.0, 500000.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "compression"}'::jsonb),
  ('coating', 'Coating', 120, 'coater', 20.0, 500000.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "coating"}'::jsonb),
  ('quality-testing', 'Quality Testing', 120, 'qc-lab', 8.0, 50.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": false, "optimizer_process_id": "quality_testing"}'::jsonb),
  ('packaging', 'Packaging', 120, 'pack-line', 12.0, 500000.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "latest_finish_hours": 20, "optimizer_process_id": "packaging"}'::jsonb)
) as v(slug, name, duration, machine_slug, power_kw, qty, metadata) on true
join public.machines m on m.factory_id = f.id and m.slug = v.machine_slug
where f.slug = 'demo-pharmaceutical-factory'
on conflict (factory_id, slug) do update set
  name = excluded.name, duration_minutes = excluded.duration_minutes, machine_id = excluded.machine_id,
  power_requirement_kw = excluded.power_requirement_kw, production_quantity = excluded.production_quantity,
  metadata = excluded.metadata;

insert into public.process_dependencies (factory_id, process_id, depends_on_process_id, dependency_type, lag_minutes, metadata)
select f.id, p.id, d.id, 'finish_to_start', 0, '{"demo": true}'::jsonb
from public.factories f
join (values
  ('sieving', 'dispensing'),
  ('blending', 'sieving'),
  ('granulation', 'blending'),
  ('drying', 'granulation'),
  ('milling', 'drying'),
  ('compression', 'milling'),
  ('coating', 'compression'),
  ('quality-testing', 'coating'),
  ('packaging', 'quality-testing')
) as v(process_slug, depends_on_slug) on true
join public.processes p on p.factory_id = f.id and p.slug = v.process_slug
join public.processes d on d.factory_id = f.id and d.slug = v.depends_on_slug
where f.slug = 'demo-pharmaceutical-factory'
on conflict (process_id, depends_on_process_id) do update set
  dependency_type = excluded.dependency_type, lag_minutes = excluded.lag_minutes, metadata = excluded.metadata;

-- Re-running on another day must not stretch the horizon: drop this file's own earlier solar rows first.
delete from public.energy_data e using public.factories f
where e.factory_id = f.id and f.slug = 'demo-pharmaceutical-factory'
  and e.metadata->>'profile' = 'optimizer/energy_data.py DEMO_SOLAR_PROFILE';

-- 24 hours of 15-minute site-level rows (the config's planning horizon; the backend derives the
-- optimization horizon from the first and last stored reading). Solar = DEMO_SOLAR_PROFILE (kW, local hour) / 4.
insert into public.energy_data (factory_id, recorded_at, interval_minutes, consumption_kwh, generation_kwh, machine_id, source, metadata)
select f.id, t.ts, 15, 0, p.kw / 4.0, null, 'simulated',
  '{"demo": true, "profile": "optimizer/energy_data.py DEMO_SOLAR_PROFILE", "subhourly": "flat within the hour", "consumption_recorded": false}'::jsonb
from public.factories f
cross join generate_series(date_trunc('day', now()), date_trunc('day', now()) + interval '24 hours', interval '15 minutes') as t(ts)
join (values (0, 0.0), (1, 0.0), (2, 0.0), (3, 0.0), (4, 0.0), (5, 0.0), (6, 5.0), (7, 15.0), (8, 30.0), (9, 45.0), (10, 60.0), (11, 70.0), (12, 75.0), (13, 70.0), (14, 60.0), (15, 45.0), (16, 30.0), (17, 15.0), (18, 5.0), (19, 0.0), (20, 0.0), (21, 0.0), (22, 0.0), (23, 0.0)) as p(hour, kw)
  on p.hour = extract(hour from t.ts at time zone 'Europe/Amsterdam')
where f.slug = 'demo-pharmaceutical-factory'
on conflict (factory_id, coalesce(machine_id, '00000000-0000-0000-0000-000000000000'::uuid), recorded_at) do update set
  consumption_kwh = excluded.consumption_kwh, generation_kwh = excluded.generation_kwh,
  source = excluded.source, metadata = excluded.metadata;

-- Same DEMO time-of-use windows as seed.sql (EUR, not converted).
insert into public.electricity_tariffs (factory_id, slug, name, currency, start_time, end_time, days_of_week,
  energy_price_per_kwh, demand_charge_per_kw, fixed_charge, tax_rate, effective_from, priority, metadata)
select f.id, v.slug, v.name, 'EUR', v.start_time, v.end_time, v.days_of_week,
  v.price, v.demand, v.fixed, v.tax, date_trunc('day', now()), v.priority, v.metadata::jsonb
from public.factories f
cross join (values
  ('off-peak', 'DEMO. Off-peak (night)', '22:00'::time, '07:00'::time, null::smallint[], 0.0850, 0.0, 0.0, 0.21, 10, '{"demo": true, "band": "off_peak"}'),
  ('shoulder', 'DEMO. Shoulder', '07:00'::time, '22:00'::time, null::smallint[], 0.1420, 0.0, 0.0, 0.21, 10, '{"demo": true, "band": "shoulder"}'),
  ('peak', 'DEMO. Peak (weekday evening)', '17:00'::time, '22:00'::time, array[1, 2, 3, 4, 5]::smallint[], 0.2180, 0.0, 0.0, 0.21, 20, '{"demo": true, "band": "peak"}'),
  ('peak-sat', 'DEMO. Peak (Saturday)', '08:00'::time, '20:00'::time, array[6]::smallint[], 0.1650, 0.0, 0.0, 0.21, 20, '{"demo": true, "band": "peak"}'),
  ('demand', 'DEMO. Monthly demand charge', '00:00'::time, '23:59'::time, null::smallint[], 0.0000, 18.50, 145.00, 0.21, 30, '{"demo": true, "band": "demand", "billing": "monthly"}')
) as v(slug, name, start_time, end_time, days_of_week, price, demand, fixed, tax, priority, metadata)
where f.slug = 'demo-pharmaceutical-factory'
on conflict (factory_id, slug) do update set
  name = excluded.name, currency = excluded.currency, start_time = excluded.start_time, end_time = excluded.end_time,
  days_of_week = excluded.days_of_week, energy_price_per_kwh = excluded.energy_price_per_kwh,
  demand_charge_per_kw = excluded.demand_charge_per_kw, fixed_charge = excluded.fixed_charge,
  tax_rate = excluded.tax_rate, effective_from = excluded.effective_from, priority = excluded.priority,
  metadata = excluded.metadata;

-- ---------------------------------------------------------------------------
-- Demo Automotive Factory  (optimizer/factory_data.py key 'automotive')
-- ---------------------------------------------------------------------------

insert into public.factories (slug, name, description, timezone, currency, config, metadata)
values ('demo-automotive-factory', 'Demo Automotive Factory',
  'DEMONSTRATION DATA ONLY. Generated from the optimizer demo configuration ''automotive''. Not a real site.',
  'Europe/Amsterdam', 'EUR',
  '{"demo": true, "demo_only": true, "note": "Deadline and horizon are informational; the backend uses the optimization horizon as the deadline.", "optimizer_config_key": "automotive", "planning_horizon_hours": 24, "production_deadline_hours": 18, "source": "optimizer/factory_data.py"}'::jsonb,
  '{"demo": true, "generated_by": "backend/scripts/generate_demo_factories_seed.py", "industry": "automotive", "not_for_production_use": true}'::jsonb)
on conflict (slug) do update set
  name = excluded.name, description = excluded.description, timezone = excluded.timezone,
  currency = excluded.currency, config = excluded.config, metadata = excluded.metadata;

insert into public.machines (factory_id, slug, name, rated_power_kw, metadata)
select f.id, v.slug, v.name, v.rated, v.metadata
from public.factories f
cross join (values
  ('prep-cell', 'Preparation Cell', 12.0, '{"availability_note": "single cell", "capacity": 1, "demo": true, "optimizer_machine_id": "prep_cell"}'::jsonb),
  ('press-shop', 'Press Shop', 40.0, '{"availability_note": "single shop", "capacity": 1, "demo": true, "optimizer_machine_id": "press_shop"}'::jsonb),
  ('cnc-cell-1', 'CNC Machining Cell 1', 35.0, '{"availability_note": "single cell", "capacity": 1, "demo": true, "optimizer_machine_id": "cnc_cell_1"}'::jsonb),
  ('cnc-cell-2', 'CNC Machining Cell 2', 35.0, '{"availability_note": "single cell", "capacity": 1, "demo": true, "optimizer_machine_id": "cnc_cell_2"}'::jsonb),
  ('treatment-line', 'Surface Treatment Line', 28.0, '{"availability_note": "single line", "capacity": 1, "demo": true, "optimizer_machine_id": "treatment_line"}'::jsonb),
  ('paint-booth', 'Paint Booth + Curing', 50.0, '{"availability_note": "single booth", "capacity": 1, "demo": true, "optimizer_machine_id": "paint_booth"}'::jsonb),
  ('assembly-cell', 'Assembly Cell (shared)', 18.0, '{"availability_note": "single cell, shared", "capacity": 1, "demo": true, "optimizer_machine_id": "assembly_cell"}'::jsonb),
  ('final-line', 'Final Assembly Line', 25.0, '{"availability_note": "single line", "capacity": 1, "demo": true, "optimizer_machine_id": "final_line"}'::jsonb),
  ('qc-gate', 'Quality Gate', 6.0, '{"availability_note": "single station", "capacity": 1, "demo": true, "optimizer_machine_id": "qc_gate"}'::jsonb),
  ('test-rig', 'End-of-Line Test Rig', 20.0, '{"availability_note": "single rig", "capacity": 1, "demo": true, "optimizer_machine_id": "test_rig"}'::jsonb)
) as v(slug, name, rated, metadata)
where f.slug = 'demo-automotive-factory'
on conflict (factory_id, slug) do update set
  name = excluded.name, rated_power_kw = excluded.rated_power_kw, metadata = excluded.metadata;

insert into public.processes (factory_id, slug, name, duration_minutes, machine_id, power_requirement_kw, production_quantity, metadata)
select f.id, v.slug, v.name, v.duration, m.id, v.power_kw, v.qty, v.metadata
from public.factories f
join (values
  ('part-prep', 'Raw Material/Part Preparation', 60, 'prep-cell', 12.0, 120.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": false, "optimizer_process_id": "part_prep"}'::jsonb),
  ('cutting-forming', 'Cutting/Forming', 120, 'press-shop', 40.0, 120.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "cutting_forming"}'::jsonb),
  ('machining-line1', 'Machining Line 1', 150, 'cnc-cell-1', 35.0, 60.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "machining_line1"}'::jsonb),
  ('machining-line2', 'Machining Line 2', 150, 'cnc-cell-2', 35.0, 60.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "machining_line2"}'::jsonb),
  ('surface-treatment', 'Surface Treatment', 90, 'treatment-line', 28.0, 120.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "surface_treatment"}'::jsonb),
  ('painting', 'Painting', 120, 'paint-booth', 50.0, 120.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "painting"}'::jsonb),
  ('component-assembly', 'Component Assembly', 120, 'assembly-cell', 15.0, 120.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "component_assembly"}'::jsonb),
  ('sub-assembly', 'Sub-Assembly', 90, 'assembly-cell', 18.0, 120.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "sub_assembly"}'::jsonb),
  ('final-assembly', 'Final Assembly', 180, 'final-line', 25.0, 120.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "final_assembly"}'::jsonb),
  ('quality-inspection', 'Quality Inspection', 60, 'qc-gate', 6.0, 120.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": false, "optimizer_process_id": "quality_inspection"}'::jsonb),
  ('testing', 'Testing', 60, 'test-rig', 20.0, 120.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "latest_finish_hours": 18, "optimizer_process_id": "testing"}'::jsonb)
) as v(slug, name, duration, machine_slug, power_kw, qty, metadata) on true
join public.machines m on m.factory_id = f.id and m.slug = v.machine_slug
where f.slug = 'demo-automotive-factory'
on conflict (factory_id, slug) do update set
  name = excluded.name, duration_minutes = excluded.duration_minutes, machine_id = excluded.machine_id,
  power_requirement_kw = excluded.power_requirement_kw, production_quantity = excluded.production_quantity,
  metadata = excluded.metadata;

insert into public.process_dependencies (factory_id, process_id, depends_on_process_id, dependency_type, lag_minutes, metadata)
select f.id, p.id, d.id, 'finish_to_start', 0, '{"demo": true}'::jsonb
from public.factories f
join (values
  ('cutting-forming', 'part-prep'),
  ('machining-line1', 'cutting-forming'),
  ('machining-line2', 'cutting-forming'),
  ('surface-treatment', 'machining-line1'),
  ('surface-treatment', 'machining-line2'),
  ('painting', 'surface-treatment'),
  ('component-assembly', 'cutting-forming'),
  ('sub-assembly', 'component-assembly'),
  ('sub-assembly', 'painting'),
  ('final-assembly', 'sub-assembly'),
  ('quality-inspection', 'final-assembly'),
  ('testing', 'quality-inspection')
) as v(process_slug, depends_on_slug) on true
join public.processes p on p.factory_id = f.id and p.slug = v.process_slug
join public.processes d on d.factory_id = f.id and d.slug = v.depends_on_slug
where f.slug = 'demo-automotive-factory'
on conflict (process_id, depends_on_process_id) do update set
  dependency_type = excluded.dependency_type, lag_minutes = excluded.lag_minutes, metadata = excluded.metadata;

-- Re-running on another day must not stretch the horizon: drop this file's own earlier solar rows first.
delete from public.energy_data e using public.factories f
where e.factory_id = f.id and f.slug = 'demo-automotive-factory'
  and e.metadata->>'profile' = 'optimizer/energy_data.py DEMO_SOLAR_PROFILE';

-- 24 hours of 15-minute site-level rows (the config's planning horizon; the backend derives the
-- optimization horizon from the first and last stored reading). Solar = DEMO_SOLAR_PROFILE (kW, local hour) / 4.
insert into public.energy_data (factory_id, recorded_at, interval_minutes, consumption_kwh, generation_kwh, machine_id, source, metadata)
select f.id, t.ts, 15, 0, p.kw / 4.0, null, 'simulated',
  '{"demo": true, "profile": "optimizer/energy_data.py DEMO_SOLAR_PROFILE", "subhourly": "flat within the hour", "consumption_recorded": false}'::jsonb
from public.factories f
cross join generate_series(date_trunc('day', now()), date_trunc('day', now()) + interval '24 hours', interval '15 minutes') as t(ts)
join (values (0, 0.0), (1, 0.0), (2, 0.0), (3, 0.0), (4, 0.0), (5, 0.0), (6, 5.0), (7, 15.0), (8, 30.0), (9, 45.0), (10, 60.0), (11, 70.0), (12, 75.0), (13, 70.0), (14, 60.0), (15, 45.0), (16, 30.0), (17, 15.0), (18, 5.0), (19, 0.0), (20, 0.0), (21, 0.0), (22, 0.0), (23, 0.0)) as p(hour, kw)
  on p.hour = extract(hour from t.ts at time zone 'Europe/Amsterdam')
where f.slug = 'demo-automotive-factory'
on conflict (factory_id, coalesce(machine_id, '00000000-0000-0000-0000-000000000000'::uuid), recorded_at) do update set
  consumption_kwh = excluded.consumption_kwh, generation_kwh = excluded.generation_kwh,
  source = excluded.source, metadata = excluded.metadata;

-- Same DEMO time-of-use windows as seed.sql (EUR, not converted).
insert into public.electricity_tariffs (factory_id, slug, name, currency, start_time, end_time, days_of_week,
  energy_price_per_kwh, demand_charge_per_kw, fixed_charge, tax_rate, effective_from, priority, metadata)
select f.id, v.slug, v.name, 'EUR', v.start_time, v.end_time, v.days_of_week,
  v.price, v.demand, v.fixed, v.tax, date_trunc('day', now()), v.priority, v.metadata::jsonb
from public.factories f
cross join (values
  ('off-peak', 'DEMO. Off-peak (night)', '22:00'::time, '07:00'::time, null::smallint[], 0.0850, 0.0, 0.0, 0.21, 10, '{"demo": true, "band": "off_peak"}'),
  ('shoulder', 'DEMO. Shoulder', '07:00'::time, '22:00'::time, null::smallint[], 0.1420, 0.0, 0.0, 0.21, 10, '{"demo": true, "band": "shoulder"}'),
  ('peak', 'DEMO. Peak (weekday evening)', '17:00'::time, '22:00'::time, array[1, 2, 3, 4, 5]::smallint[], 0.2180, 0.0, 0.0, 0.21, 20, '{"demo": true, "band": "peak"}'),
  ('peak-sat', 'DEMO. Peak (Saturday)', '08:00'::time, '20:00'::time, array[6]::smallint[], 0.1650, 0.0, 0.0, 0.21, 20, '{"demo": true, "band": "peak"}'),
  ('demand', 'DEMO. Monthly demand charge', '00:00'::time, '23:59'::time, null::smallint[], 0.0000, 18.50, 145.00, 0.21, 30, '{"demo": true, "band": "demand", "billing": "monthly"}')
) as v(slug, name, start_time, end_time, days_of_week, price, demand, fixed, tax, priority, metadata)
where f.slug = 'demo-automotive-factory'
on conflict (factory_id, slug) do update set
  name = excluded.name, currency = excluded.currency, start_time = excluded.start_time, end_time = excluded.end_time,
  days_of_week = excluded.days_of_week, energy_price_per_kwh = excluded.energy_price_per_kwh,
  demand_charge_per_kw = excluded.demand_charge_per_kw, fixed_charge = excluded.fixed_charge,
  tax_rate = excluded.tax_rate, effective_from = excluded.effective_from, priority = excluded.priority,
  metadata = excluded.metadata;

-- ---------------------------------------------------------------------------
-- Demo Furniture Workshop  (optimizer/factory_data.py key 'furniture')
-- ---------------------------------------------------------------------------

insert into public.factories (slug, name, description, timezone, currency, config, metadata)
values ('demo-furniture-factory', 'Demo Furniture Workshop',
  'DEMONSTRATION DATA ONLY. Generated from the optimizer demo configuration ''furniture''. Not a real site.',
  'Europe/Amsterdam', 'EUR',
  '{"demo": true, "demo_only": true, "note": "Deadline and horizon are informational; the backend uses the optimization horizon as the deadline.", "optimizer_config_key": "furniture", "planning_horizon_hours": 24, "production_deadline_hours": 16, "source": "optimizer/factory_data.py"}'::jsonb,
  '{"demo": true, "generated_by": "backend/scripts/generate_demo_factories_seed.py", "industry": "furniture", "not_for_production_use": true}'::jsonb)
on conflict (slug) do update set
  name = excluded.name, description = excluded.description, timezone = excluded.timezone,
  currency = excluded.currency, config = excluded.config, metadata = excluded.metadata;

insert into public.machines (factory_id, slug, name, rated_power_kw, metadata)
select f.id, v.slug, v.name, v.rated, v.metadata
from public.factories f
cross join (values
  ('saw', 'Panel Saw', 38.0, '{"availability_note": "single unit", "capacity": 1, "demo": true, "optimizer_machine_id": "saw"}'::jsonb),
  ('kitting-bench', 'Kitting Bench', 5.0, '{"availability_note": "single unit", "capacity": 1, "demo": true, "optimizer_machine_id": "kitting_bench"}'::jsonb),
  ('sander', 'Wide-Belt Sander', 28.0, '{"availability_note": "single unit", "capacity": 1, "demo": true, "optimizer_machine_id": "sander"}'::jsonb),
  ('assembly-bench', 'Assembly Bench (shared)', 18.0, '{"availability_note": "single unit, shared", "capacity": 1, "demo": true, "optimizer_machine_id": "assembly_bench"}'::jsonb),
  ('inspection-bench', 'Inspection Bench', 5.0, '{"availability_note": "single unit", "capacity": 1, "demo": true, "optimizer_machine_id": "inspection_bench"}'::jsonb),
  ('finishing-station', 'Finishing Station (shared)', 30.0, '{"availability_note": "single unit, shared", "capacity": 1, "demo": true, "optimizer_machine_id": "finishing_station"}'::jsonb)
) as v(slug, name, rated, metadata)
where f.slug = 'demo-furniture-factory'
on conflict (factory_id, slug) do update set
  name = excluded.name, rated_power_kw = excluded.rated_power_kw, metadata = excluded.metadata;

insert into public.processes (factory_id, slug, name, duration_minutes, machine_id, power_requirement_kw, production_quantity, metadata)
select f.id, v.slug, v.name, v.duration, m.id, v.power_kw, v.qty, v.metadata
from public.factories f
join (values
  ('cutting', 'Panel Cutting', 120, 'saw', 35.0, 40.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": false, "optimizer_process_id": "cutting"}'::jsonb),
  ('hardware-kitting', 'Hardware Kitting', 60, 'kitting-bench', 5.0, 40.0, '{"demo": true, "earliest_start_hours": 1, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "hardware_kitting"}'::jsonb),
  ('sanding', 'Surface Sanding', 150, 'sander', 25.0, 40.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "sanding"}'::jsonb),
  ('frame-building', 'Frame Building', 120, 'assembly-bench', 15.0, 20.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "frame_building"}'::jsonb),
  ('assembly', 'Product Assembly', 180, 'assembly-bench', 20.0, 20.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "assembly"}'::jsonb),
  ('quality-gate', 'Quality Inspection', 60, 'inspection-bench', 5.0, 20.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": false, "optimizer_process_id": "quality_gate"}'::jsonb),
  ('finishing', 'Surface Finishing', 120, 'finishing-station', 30.0, 20.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "optimizer_process_id": "finishing"}'::jsonb),
  ('packaging', 'Packaging', 60, 'finishing-station', 10.0, 20.0, '{"demo": true, "flexibility_note": "Informational: the backend treats every process as flexible.", "is_flexible": true, "latest_finish_hours": 16, "optimizer_process_id": "packaging"}'::jsonb)
) as v(slug, name, duration, machine_slug, power_kw, qty, metadata) on true
join public.machines m on m.factory_id = f.id and m.slug = v.machine_slug
where f.slug = 'demo-furniture-factory'
on conflict (factory_id, slug) do update set
  name = excluded.name, duration_minutes = excluded.duration_minutes, machine_id = excluded.machine_id,
  power_requirement_kw = excluded.power_requirement_kw, production_quantity = excluded.production_quantity,
  metadata = excluded.metadata;

insert into public.process_dependencies (factory_id, process_id, depends_on_process_id, dependency_type, lag_minutes, metadata)
select f.id, p.id, d.id, 'finish_to_start', 0, '{"demo": true}'::jsonb
from public.factories f
join (values
  ('sanding', 'cutting'),
  ('frame-building', 'cutting'),
  ('assembly', 'sanding'),
  ('assembly', 'frame-building'),
  ('assembly', 'hardware-kitting'),
  ('quality-gate', 'assembly'),
  ('finishing', 'quality-gate'),
  ('packaging', 'finishing')
) as v(process_slug, depends_on_slug) on true
join public.processes p on p.factory_id = f.id and p.slug = v.process_slug
join public.processes d on d.factory_id = f.id and d.slug = v.depends_on_slug
where f.slug = 'demo-furniture-factory'
on conflict (process_id, depends_on_process_id) do update set
  dependency_type = excluded.dependency_type, lag_minutes = excluded.lag_minutes, metadata = excluded.metadata;

-- Re-running on another day must not stretch the horizon: drop this file's own earlier solar rows first.
delete from public.energy_data e using public.factories f
where e.factory_id = f.id and f.slug = 'demo-furniture-factory'
  and e.metadata->>'profile' = 'optimizer/energy_data.py DEMO_SOLAR_PROFILE';

-- 24 hours of 15-minute site-level rows (the config's planning horizon; the backend derives the
-- optimization horizon from the first and last stored reading). Solar = DEMO_SOLAR_PROFILE (kW, local hour) / 4.
insert into public.energy_data (factory_id, recorded_at, interval_minutes, consumption_kwh, generation_kwh, machine_id, source, metadata)
select f.id, t.ts, 15, 0, p.kw / 4.0, null, 'simulated',
  '{"demo": true, "profile": "optimizer/energy_data.py DEMO_SOLAR_PROFILE", "subhourly": "flat within the hour", "consumption_recorded": false}'::jsonb
from public.factories f
cross join generate_series(date_trunc('day', now()), date_trunc('day', now()) + interval '24 hours', interval '15 minutes') as t(ts)
join (values (0, 0.0), (1, 0.0), (2, 0.0), (3, 0.0), (4, 0.0), (5, 0.0), (6, 5.0), (7, 15.0), (8, 30.0), (9, 45.0), (10, 60.0), (11, 70.0), (12, 75.0), (13, 70.0), (14, 60.0), (15, 45.0), (16, 30.0), (17, 15.0), (18, 5.0), (19, 0.0), (20, 0.0), (21, 0.0), (22, 0.0), (23, 0.0)) as p(hour, kw)
  on p.hour = extract(hour from t.ts at time zone 'Europe/Amsterdam')
where f.slug = 'demo-furniture-factory'
on conflict (factory_id, coalesce(machine_id, '00000000-0000-0000-0000-000000000000'::uuid), recorded_at) do update set
  consumption_kwh = excluded.consumption_kwh, generation_kwh = excluded.generation_kwh,
  source = excluded.source, metadata = excluded.metadata;

-- Same DEMO time-of-use windows as seed.sql (EUR, not converted).
insert into public.electricity_tariffs (factory_id, slug, name, currency, start_time, end_time, days_of_week,
  energy_price_per_kwh, demand_charge_per_kw, fixed_charge, tax_rate, effective_from, priority, metadata)
select f.id, v.slug, v.name, 'EUR', v.start_time, v.end_time, v.days_of_week,
  v.price, v.demand, v.fixed, v.tax, date_trunc('day', now()), v.priority, v.metadata::jsonb
from public.factories f
cross join (values
  ('off-peak', 'DEMO. Off-peak (night)', '22:00'::time, '07:00'::time, null::smallint[], 0.0850, 0.0, 0.0, 0.21, 10, '{"demo": true, "band": "off_peak"}'),
  ('shoulder', 'DEMO. Shoulder', '07:00'::time, '22:00'::time, null::smallint[], 0.1420, 0.0, 0.0, 0.21, 10, '{"demo": true, "band": "shoulder"}'),
  ('peak', 'DEMO. Peak (weekday evening)', '17:00'::time, '22:00'::time, array[1, 2, 3, 4, 5]::smallint[], 0.2180, 0.0, 0.0, 0.21, 20, '{"demo": true, "band": "peak"}'),
  ('peak-sat', 'DEMO. Peak (Saturday)', '08:00'::time, '20:00'::time, array[6]::smallint[], 0.1650, 0.0, 0.0, 0.21, 20, '{"demo": true, "band": "peak"}'),
  ('demand', 'DEMO. Monthly demand charge', '00:00'::time, '23:59'::time, null::smallint[], 0.0000, 18.50, 145.00, 0.21, 30, '{"demo": true, "band": "demand", "billing": "monthly"}')
) as v(slug, name, start_time, end_time, days_of_week, price, demand, fixed, tax, priority, metadata)
where f.slug = 'demo-furniture-factory'
on conflict (factory_id, slug) do update set
  name = excluded.name, currency = excluded.currency, start_time = excluded.start_time, end_time = excluded.end_time,
  days_of_week = excluded.days_of_week, energy_price_per_kwh = excluded.energy_price_per_kwh,
  demand_charge_per_kw = excluded.demand_charge_per_kw, fixed_charge = excluded.fixed_charge,
  tax_rate = excluded.tax_rate, effective_from = excluded.effective_from, priority = excluded.priority,
  metadata = excluded.metadata;

commit;
