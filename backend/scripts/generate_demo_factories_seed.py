"""Generate backend/supabase/seed_demo_factories.sql from the optimizer's demo factory configs.

Reads (never modifies) optimizer/factory_data.py and optimizer/energy_data.py and writes an
idempotent SQL seed that adds every demo factory configuration that is not already in the
database seed. The chocolate configuration is skipped on purpose: backend/supabase/seed.sql
already owns a factory named "Demo Chocolate Factory" and this file must not overwrite it.

Data provenance written into the rows:
  * machines, processes, durations, power and dependencies: optimizer/factory_data.py
  * solar: optimizer/energy_data.py DEMO_SOLAR_PROFILE (DEMO/SIMULATED), flat within each
    hour, as 15-minute site-level rows, tagged source = 'simulated', covering the config's
    planning_horizon_hours (the backend derives the optimization horizon from these rows)
  * tariffs: the same DEMO time-of-use windows as the existing seed.sql chocolate factory
    (EUR). No currency conversion is performed.
  * consumption: not recorded (stored as 0 with metadata.consumption_recorded = false)

Usage (from the repository root):
  python backend/scripts/generate_demo_factories_seed.py > backend/supabase/seed_demo_factories.sql
"""

import json
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')))

from optimizer.energy_data import DEMO_SOLAR_PROFILE  # noqa: E402
from optimizer.factory_data import AVAILABLE_FACTORIES  # noqa: E402

SKIP = {'chocolate'}  # already seeded by seed.sql as "Demo Chocolate Factory"
TIMEZONE = 'Europe/Amsterdam'  # same convention as the existing seed.sql demo factory
CURRENCY = 'EUR'  # same DEMO tariff windows as seed.sql; never converted


def q(value):
    if value is None:
        return 'null'
    return "'" + str(value).replace("'", "''") + "'"


def slug(value):
    return value.lower().replace('_', '-')


def jsonb(value):
    return q(json.dumps(value, sort_keys=True)) + '::jsonb'


def number(value):
    return 'null' if value is None else repr(float(value))


def factory_sql(key, config):
    factory_slug = 'demo-' + slug(key) + '-factory'
    name = config['factory_name']
    out = []
    out.append(f"-- {'-' * 75}\n-- {name}  (optimizer/factory_data.py key '{key}')\n-- {'-' * 75}")
    out.append(
        "insert into public.factories (slug, name, description, timezone, currency, config, metadata)\n"
        f"values ({q(factory_slug)}, {q(name)},\n"
        f"  {q('DEMONSTRATION DATA ONLY. Generated from the optimizer demo configuration ' + repr(key) + '. Not a real site.')},\n"
        f"  {q(TIMEZONE)}, {q(CURRENCY)},\n"
        f"  {jsonb({'demo': True, 'demo_only': True, 'source': 'optimizer/factory_data.py', 'optimizer_config_key': key, 'production_deadline_hours': config.get('production_deadline'), 'planning_horizon_hours': config.get('planning_horizon_hours'), 'note': 'Deadline and horizon are informational; the backend uses the optimization horizon as the deadline.'})},\n"
        f"  {jsonb({'demo': True, 'industry': key, 'generated_by': 'backend/scripts/generate_demo_factories_seed.py', 'not_for_production_use': True})})\n"
        "on conflict (slug) do update set\n"
        "  name = excluded.name, description = excluded.description, timezone = excluded.timezone,\n"
        "  currency = excluded.currency, config = excluded.config, metadata = excluded.metadata;"
    )

    machine_rows = []
    for machine in config['machines']:
        metadata = {
            'demo': True,
            'optimizer_machine_id': machine['machine_id'],
            'capacity': machine.get('capacity'),
            'availability_note': machine.get('availability'),
        }
        machine_rows.append(f"  ({q(slug(machine['machine_id']))}, {q(machine['machine_name'])}, {number(machine.get('power_kw'))}, {jsonb(metadata)})")
    out.append(
        "insert into public.machines (factory_id, slug, name, rated_power_kw, metadata)\n"
        "select f.id, v.slug, v.name, v.rated, v.metadata\n"
        "from public.factories f\ncross join (values\n" + ',\n'.join(machine_rows) + "\n"
        ") as v(slug, name, rated, metadata)\n"
        f"where f.slug = {q(factory_slug)}\n"
        "on conflict (factory_id, slug) do update set\n"
        "  name = excluded.name, rated_power_kw = excluded.rated_power_kw, metadata = excluded.metadata;"
    )

    process_rows = []
    for process in config['processes']:
        minutes = process['duration_hours'] * 60
        if abs(minutes - round(minutes)) > 1e-9:
            raise SystemExit(f"{key}/{process['process_id']}: duration is not a whole number of minutes")
        metadata = {
            'demo': True,
            'optimizer_process_id': process['process_id'],
            'is_flexible': bool(process.get('is_flexible', True)),
            'flexibility_note': 'Informational: the backend treats every process as flexible.',
        }
        if process.get('earliest_start') is not None:
            metadata['earliest_start_hours'] = process['earliest_start']
        if process.get('latest_finish') is not None:
            metadata['latest_finish_hours'] = process['latest_finish']
        process_rows.append(
            f"  ({q(slug(process['process_id']))}, {q(process['process_name'])}, {int(round(minutes))}, "
            f"{q(slug(process['machine_id']))}, {number(process.get('power_kw'))}, {number(process.get('quantity'))}, {jsonb(metadata)})"
        )
    out.append(
        "insert into public.processes (factory_id, slug, name, duration_minutes, machine_id, power_requirement_kw, production_quantity, metadata)\n"
        "select f.id, v.slug, v.name, v.duration, m.id, v.power_kw, v.qty, v.metadata\n"
        "from public.factories f\njoin (values\n" + ',\n'.join(process_rows) + "\n"
        ") as v(slug, name, duration, machine_slug, power_kw, qty, metadata) on true\n"
        "join public.machines m on m.factory_id = f.id and m.slug = v.machine_slug\n"
        f"where f.slug = {q(factory_slug)}\n"
        "on conflict (factory_id, slug) do update set\n"
        "  name = excluded.name, duration_minutes = excluded.duration_minutes, machine_id = excluded.machine_id,\n"
        "  power_requirement_kw = excluded.power_requirement_kw, production_quantity = excluded.production_quantity,\n"
        "  metadata = excluded.metadata;"
    )

    dependency_rows = [
        f"  ({q(slug(process['process_id']))}, {q(slug(parent))})"
        for process in config['processes'] for parent in process.get('dependencies', [])
    ]
    if dependency_rows:
        out.append(
            "insert into public.process_dependencies (factory_id, process_id, depends_on_process_id, dependency_type, lag_minutes, metadata)\n"
            "select f.id, p.id, d.id, 'finish_to_start', 0, '{\"demo\": true}'::jsonb\n"
            "from public.factories f\njoin (values\n" + ',\n'.join(dependency_rows) + "\n"
            ") as v(process_slug, depends_on_slug) on true\n"
            "join public.processes p on p.factory_id = f.id and p.slug = v.process_slug\n"
            "join public.processes d on d.factory_id = f.id and d.slug = v.depends_on_slug\n"
            f"where f.slug = {q(factory_slug)}\n"
            "on conflict (process_id, depends_on_process_id) do update set\n"
            "  dependency_type = excluded.dependency_type, lag_minutes = excluded.lag_minutes, metadata = excluded.metadata;"
        )

    # The Python profile contract needs at least 24 whole hours.
    horizon = max(24, int(config['planning_horizon_hours']))
    profile_rows = ', '.join(f"({hour}, {number(DEMO_SOLAR_PROFILE[hour])})" for hour in range(24))
    out.append(
        "-- Re-running on another day must not stretch the horizon: drop this file's own earlier solar rows first.\n"
        "delete from public.energy_data e using public.factories f\n"
        f"where e.factory_id = f.id and f.slug = {q(factory_slug)}\n"
        "  and e.metadata->>'profile' = 'optimizer/energy_data.py DEMO_SOLAR_PROFILE';"
    )
    out.append(
        f"-- {horizon} hours of 15-minute site-level rows (the config's planning horizon; the backend derives the\n"
        "-- optimization horizon from the first and last stored reading). Solar = DEMO_SOLAR_PROFILE (kW, local hour) / 4.\n"
        "insert into public.energy_data (factory_id, recorded_at, interval_minutes, consumption_kwh, generation_kwh, machine_id, source, metadata)\n"
        "select f.id, t.ts, 15, 0, p.kw / 4.0, null, 'simulated',\n"
        "  '{\"demo\": true, \"profile\": \"optimizer/energy_data.py DEMO_SOLAR_PROFILE\", \"subhourly\": \"flat within the hour\", \"consumption_recorded\": false}'::jsonb\n"
        "from public.factories f\n"
        f"cross join generate_series(date_trunc('day', now()), date_trunc('day', now()) + interval '{horizon} hours', interval '15 minutes') as t(ts)\n"
        f"join (values {profile_rows}) as p(hour, kw)\n"
        f"  on p.hour = extract(hour from t.ts at time zone {q(TIMEZONE)})\n"
        f"where f.slug = {q(factory_slug)}\n"
        "on conflict (factory_id, coalesce(machine_id, '00000000-0000-0000-0000-000000000000'::uuid), recorded_at) do update set\n"
        "  consumption_kwh = excluded.consumption_kwh, generation_kwh = excluded.generation_kwh,\n"
        "  source = excluded.source, metadata = excluded.metadata;"
    )

    out.append(
        "-- Same DEMO time-of-use windows as seed.sql (EUR, not converted).\n"
        "insert into public.electricity_tariffs (factory_id, slug, name, currency, start_time, end_time, days_of_week,\n"
        "  energy_price_per_kwh, demand_charge_per_kw, fixed_charge, tax_rate, effective_from, priority, metadata)\n"
        f"select f.id, v.slug, v.name, {q(CURRENCY)}, v.start_time, v.end_time, v.days_of_week,\n"
        "  v.price, v.demand, v.fixed, v.tax, date_trunc('day', now()), v.priority, v.metadata::jsonb\n"
        "from public.factories f\ncross join (values\n"
        "  ('off-peak', 'DEMO. Off-peak (night)', '22:00'::time, '07:00'::time, null::smallint[], 0.0850, 0.0, 0.0, 0.21, 10, '{\"demo\": true, \"band\": \"off_peak\"}'),\n"
        "  ('shoulder', 'DEMO. Shoulder', '07:00'::time, '22:00'::time, null::smallint[], 0.1420, 0.0, 0.0, 0.21, 10, '{\"demo\": true, \"band\": \"shoulder\"}'),\n"
        "  ('peak', 'DEMO. Peak (weekday evening)', '17:00'::time, '22:00'::time, array[1, 2, 3, 4, 5]::smallint[], 0.2180, 0.0, 0.0, 0.21, 20, '{\"demo\": true, \"band\": \"peak\"}'),\n"
        "  ('peak-sat', 'DEMO. Peak (Saturday)', '08:00'::time, '20:00'::time, array[6]::smallint[], 0.1650, 0.0, 0.0, 0.21, 20, '{\"demo\": true, \"band\": \"peak\"}'),\n"
        "  ('demand', 'DEMO. Monthly demand charge', '00:00'::time, '23:59'::time, null::smallint[], 0.0000, 18.50, 145.00, 0.21, 30, '{\"demo\": true, \"band\": \"demand\", \"billing\": \"monthly\"}')\n"
        ") as v(slug, name, start_time, end_time, days_of_week, price, demand, fixed, tax, priority, metadata)\n"
        f"where f.slug = {q(factory_slug)}\n"
        "on conflict (factory_id, slug) do update set\n"
        "  name = excluded.name, currency = excluded.currency, start_time = excluded.start_time, end_time = excluded.end_time,\n"
        "  days_of_week = excluded.days_of_week, energy_price_per_kwh = excluded.energy_price_per_kwh,\n"
        "  demand_charge_per_kw = excluded.demand_charge_per_kw, fixed_charge = excluded.fixed_charge,\n"
        "  tax_rate = excluded.tax_rate, effective_from = excluded.effective_from, priority = excluded.priority,\n"
        "  metadata = excluded.metadata;"
    )
    return factory_slug, '\n\n'.join(out)


def main():
    slugs = []
    blocks = []
    for key, config in AVAILABLE_FACTORIES.items():
        if key in SKIP:
            continue
        factory_slug, block = factory_sql(key, config)
        slugs.append(factory_slug)
        blocks.append(block)
    header = (
        "-- ===========================================================================\n"
        "-- ByteMe — seed_demo_factories.sql  (DEMO DATA ONLY, generated — do not edit by hand)\n"
        "--\n"
        "-- Adds the optimizer's demo factory configurations (optimizer/factory_data.py) as\n"
        "-- database factories so they appear in the factory selector. Run AFTER seed.sql.\n"
        "-- Regenerate with: python backend/scripts/generate_demo_factories_seed.py\n"
        "--\n"
        "-- Does not touch 'demo-chocolate-factory'. Idempotent: safe to re-run.\n"
        "-- Solar is SIMULATED (optimizer/energy_data.py DEMO_SOLAR_PROFILE); tariffs are the\n"
        "-- seed.sql DEMO windows in EUR; consumption is not recorded. No schedules are seeded:\n"
        "-- run the optimizer from the app to create them.\n"
        "--\n"
        "-- Factories: " + ', '.join(slugs) + "\n"
        "-- ===========================================================================\n\nbegin;\n\n"
    )
    print(header + '\n\n'.join(blocks) + '\n\ncommit;')


if __name__ == '__main__':
    main()
