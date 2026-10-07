-- Replace the initial authenticated FOR ALL policies with the same
-- app_metadata factory grants enforced by the Backend API. The service-role
-- API client continues to bypass RLS; anon remains without table grants or
-- policies.
create or replace function public.byteme_has_factory_access(p_factory_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
  select
    (auth.jwt() -> 'app_metadata' -> 'byteme_admin') = 'true'::jsonb
    or coalesce(auth.jwt() -> 'app_metadata' -> 'factory_ids', '[]'::jsonb) ? p_factory_id::text;
$$;

revoke execute on function public.byteme_has_factory_access(uuid) from public;
revoke execute on function public.byteme_has_factory_access(uuid) from anon;
grant execute on function public.byteme_has_factory_access(uuid) to authenticated, service_role;

drop policy if exists factories_authenticated_all on public.factories;
drop policy if exists machines_authenticated_all on public.machines;
drop policy if exists processes_authenticated_all on public.processes;
drop policy if exists process_dependencies_authenticated_all on public.process_dependencies;
drop policy if exists production_orders_authenticated_all on public.production_orders;
drop policy if exists energy_data_authenticated_all on public.energy_data;
drop policy if exists electricity_tariffs_authenticated_all on public.electricity_tariffs;
drop policy if exists aperc_scenario_tariffs_authenticated_all on public.aperc_scenario_tariffs;
drop policy if exists optimization_requests_authenticated_all on public.optimization_requests;
drop policy if exists optimization_results_authenticated_all on public.optimization_results;
drop policy if exists schedules_authenticated_all on public.schedules;
drop policy if exists schedule_entries_authenticated_all on public.schedule_entries;

create policy factories_factory_scope on public.factories
  for all to authenticated
  using (public.byteme_has_factory_access(id))
  with check (public.byteme_has_factory_access(id));

create policy machines_factory_scope on public.machines
  for all to authenticated
  using (public.byteme_has_factory_access(factory_id))
  with check (public.byteme_has_factory_access(factory_id));

create policy processes_factory_scope on public.processes
  for all to authenticated
  using (public.byteme_has_factory_access(factory_id))
  with check (
    public.byteme_has_factory_access(factory_id)
    and exists (
      select 1 from public.machines m
       where m.id = machine_id and m.factory_id = processes.factory_id
    )
  );

create policy process_dependencies_factory_scope on public.process_dependencies
  for all to authenticated
  using (public.byteme_has_factory_access(factory_id))
  with check (
    public.byteme_has_factory_access(factory_id)
    and exists (
      select 1 from public.processes p
       where p.id = process_id and p.factory_id = process_dependencies.factory_id
    )
    and exists (
      select 1 from public.processes p
       where p.id = depends_on_process_id and p.factory_id = process_dependencies.factory_id
    )
  );

create policy production_orders_factory_scope on public.production_orders
  for all to authenticated
  using (public.byteme_has_factory_access(factory_id))
  with check (public.byteme_has_factory_access(factory_id));

create policy energy_data_factory_scope on public.energy_data
  for all to authenticated
  using (public.byteme_has_factory_access(factory_id))
  with check (
    public.byteme_has_factory_access(factory_id)
    and (
      machine_id is null
      or exists (
        select 1 from public.machines m
         where m.id = machine_id and m.factory_id = energy_data.factory_id
      )
    )
  );

create policy electricity_tariffs_factory_scope on public.electricity_tariffs
  for all to authenticated
  using (public.byteme_has_factory_access(factory_id))
  with check (public.byteme_has_factory_access(factory_id));

create policy aperc_scenario_tariffs_factory_scope on public.aperc_scenario_tariffs
  for all to authenticated
  using (public.byteme_has_factory_access(factory_id))
  with check (public.byteme_has_factory_access(factory_id));

create policy optimization_requests_factory_scope on public.optimization_requests
  for all to authenticated
  using (public.byteme_has_factory_access(factory_id))
  with check (public.byteme_has_factory_access(factory_id));

create policy optimization_results_factory_scope on public.optimization_results
  for all to authenticated
  using (public.byteme_has_factory_access(factory_id))
  with check (
    public.byteme_has_factory_access(factory_id)
    and exists (
      select 1 from public.optimization_requests r
       where r.id = optimization_request_id
         and r.factory_id = optimization_results.factory_id
    )
  );

create policy schedules_factory_scope on public.schedules
  for all to authenticated
  using (public.byteme_has_factory_access(factory_id))
  with check (
    public.byteme_has_factory_access(factory_id)
    and (
      optimization_request_id is null
      or exists (
        select 1 from public.optimization_requests r
         where r.id = optimization_request_id
           and r.factory_id = schedules.factory_id
      )
    )
    and (
      optimization_result_id is null
      or exists (
        select 1 from public.optimization_results r
         where r.id = optimization_result_id
           and r.factory_id = schedules.factory_id
      )
    )
  );

create policy schedule_entries_factory_scope on public.schedule_entries
  for all to authenticated
  using (
    exists (
      select 1 from public.schedules s
       where s.id = schedule_id
         and public.byteme_has_factory_access(s.factory_id)
    )
  )
  with check (
    exists (
      select 1 from public.schedules s
       where s.id = schedule_id
         and public.byteme_has_factory_access(s.factory_id)
    )
    and exists (
      select 1 from public.machines m
      join public.schedules s on s.factory_id = m.factory_id
       where m.id = machine_id and s.id = schedule_id
    )
    and exists (
      select 1 from public.processes p
      join public.schedules s on s.factory_id = p.factory_id
       where p.id = process_id and s.id = schedule_id
    )
    and (
      production_order_id is null
      or exists (
        select 1 from public.production_orders o
        join public.schedules s on s.factory_id = o.factory_id
         where o.id = production_order_id and s.id = schedule_id
      )
    )
  );

do $$
declare
  target text;
begin
  foreach target in array array[
    'factories', 'machines', 'processes', 'process_dependencies',
    'production_orders', 'energy_data', 'electricity_tariffs',
    'aperc_scenario_tariffs',
    'optimization_requests', 'optimization_results', 'schedules',
    'schedule_entries'
  ]
  loop
    if not (
      select c.relrowsecurity
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = target
    ) then
      raise exception 'RLS is not enabled on public.%', target;
    end if;
    if exists (
      select 1 from pg_policies
       where schemaname = 'public'
         and tablename = target
         and roles::text[] @> array['authenticated']::text[]
         and (
           btrim(coalesce(qual, ''), '() ') = 'true'
           or btrim(coalesce(with_check, ''), '() ') = 'true'
         )
    ) then
      raise exception 'unscoped authenticated policy remains on public.%', target;
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
