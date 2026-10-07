-- APERC source tariff windows for explicitly scoped historical SolarShift
-- scenarios. These rates are per kVAh and must never enter the legacy
-- electricity_tariffs.energy_price_per_kwh contract.
create table public.aperc_scenario_tariffs (
  id                uuid primary key default gen_random_uuid(),
  factory_id        uuid not null references public.factories (id) on delete cascade,
  regime            text not null,
  band              text not null,
  currency          text not null default 'INR',
  energy_basis      text not null default 'kVAh',
  energy_price      numeric(12, 2) not null,
  start_time        time not null,
  end_time          time not null,
  effective_from    date not null,
  effective_to      date not null,
  effective_months  smallint[] not null,
  source_name       text not null,
  source_url        text not null,
  source_section    text not null,
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),

  constraint aperc_scenario_tariffs_regime_valid
    check (regime in ('HGD', 'LGD')),
  constraint aperc_scenario_tariffs_band_valid
    check (band in ('peak', 'normal', 'off_peak')),
  constraint aperc_scenario_tariffs_currency_basis_valid
    check (currency = 'INR' and energy_basis = 'kVAh'),
  constraint aperc_scenario_tariffs_price_nonnegative
    check (energy_price >= 0),
  constraint aperc_scenario_tariffs_period_valid
    check (effective_to > effective_from),
  constraint aperc_scenario_tariffs_months_valid
    check (
      cardinality(effective_months) > 0
      and effective_months <@ array[1,2,3,4,5,6,7,8,9,10,11,12]::smallint[]
    ),
  constraint aperc_scenario_tariffs_metadata_object
    check (jsonb_typeof(metadata) = 'object')
);

create index aperc_scenario_tariffs_factory_window_idx
  on public.aperc_scenario_tariffs (factory_id, regime, start_time);

alter table public.aperc_scenario_tariffs enable row level security;
create policy aperc_scenario_tariffs_authenticated_all
  on public.aperc_scenario_tariffs
  for all to authenticated
  using (true)
  with check (true);

grant all on public.aperc_scenario_tariffs to service_role, authenticated;
