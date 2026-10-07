-- Persist a complete Factory Builder submission as one transaction. The API
-- performs the caller's factory/admin authorization before invoking this
-- service-role-only RPC; browser roles cannot execute it directly.
create or replace function public.save_factory_builder(
  p_factory_id uuid,
  p_factory jsonb,
  p_machines jsonb,
  p_processes jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_factory public.factories%rowtype;
  v_machine jsonb;
  v_process jsonb;
  v_row jsonb;
  v_machine_id uuid;
  v_machines jsonb := '[]'::jsonb;
  v_processes jsonb := '[]'::jsonb;
begin
  if p_factory is null or jsonb_typeof(p_factory) <> 'object'
     or p_machines is null or jsonb_typeof(p_machines) <> 'array'
     or p_processes is null or jsonb_typeof(p_processes) <> 'array' then
    raise exception 'factory builder payload is invalid' using errcode = '23514';
  end if;
  if jsonb_array_length(p_machines) = 0 or jsonb_array_length(p_processes) = 0 then
    raise exception 'factory builder requires machines and processes' using errcode = '23514';
  end if;

  if p_factory_id is null then
    insert into public.factories (
      slug, name, description, timezone, currency, config, metadata, is_active
    ) values (
      p_factory->>'slug',
      p_factory->>'name',
      p_factory->>'industry',
      'UTC',
      p_factory->>'currency',
      jsonb_build_object(
        'builder', jsonb_build_object(
          'industry', p_factory->>'industry',
          'working_hours_per_day', (p_factory->>'working_hours_per_day')::integer,
          'solar_capacity_kw', (p_factory->>'solar_capacity_kw')::numeric
        )
      ),
      jsonb_build_object('managed_by', 'factory_builder'),
      true
    )
    returning * into v_factory;
  else
    select * into v_factory
      from public.factories
     where id = p_factory_id
     for update;
    if not found then
      raise exception 'factory % does not exist', p_factory_id using errcode = 'P0002';
    end if;

    update public.factories
       set name = p_factory->>'name',
           description = p_factory->>'industry',
           currency = p_factory->>'currency',
           config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
             'builder', jsonb_build_object(
               'industry', p_factory->>'industry',
               'working_hours_per_day', (p_factory->>'working_hours_per_day')::integer,
               'solar_capacity_kw', (p_factory->>'solar_capacity_kw')::numeric
             )
           ),
           metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('managed_by', 'factory_builder')
     where id = p_factory_id
    returning * into v_factory;
  end if;

  for v_machine in select value from jsonb_array_elements(p_machines)
  loop
    insert into public.machines as target (
      factory_id, slug, name, type, rated_power_kw, metadata, is_active
    ) values (
      v_factory.id,
      v_machine->>'slug',
      v_machine->>'name',
      v_machine->>'type',
      (v_machine->>'rated_power_kw')::numeric,
      jsonb_build_object('managed_by', 'factory_builder'),
      (v_machine->>'is_active')::boolean
    )
    on conflict (factory_id, slug) do update
      set name = excluded.name,
          type = excluded.type,
          rated_power_kw = excluded.rated_power_kw,
          metadata = coalesce(target.metadata, '{}'::jsonb) || excluded.metadata,
          is_active = excluded.is_active
    returning to_jsonb(target) into v_row;
    v_machines := v_machines || jsonb_build_array(v_row);
  end loop;

  update public.machines m
     set is_active = false
   where m.factory_id = v_factory.id
     and not exists (
       select 1 from jsonb_array_elements(p_machines) submitted
        where submitted.value->>'slug' = m.slug
     );

  for v_process in select value from jsonb_array_elements(p_processes)
  loop
    select id into v_machine_id
      from public.machines
     where factory_id = v_factory.id
        and slug = v_process->>'machine_slug';
    if not found or (
       coalesce((v_process->>'is_active')::boolean, true)
       and not exists (
         select 1 from public.machines m
          where m.id = v_machine_id and m.factory_id = v_factory.id and m.is_active
       )
    ) then
      raise exception 'process references an unavailable factory machine'
        using errcode = '23503';
    end if;

    insert into public.processes as target (
      factory_id, slug, name, duration_minutes, machine_id,
      power_requirement_kw, metadata, is_active
    ) values (
      v_factory.id,
      v_process->>'slug',
      v_process->>'name',
      (v_process->>'duration_minutes')::numeric,
      v_machine_id,
      (select rated_power_kw from public.machines where id = v_machine_id),
      jsonb_build_object('managed_by', 'factory_builder'),
      coalesce((v_process->>'is_active')::boolean, true)
    )
    on conflict (factory_id, slug) do update
      set name = excluded.name,
          duration_minutes = excluded.duration_minutes,
          machine_id = excluded.machine_id,
          power_requirement_kw = excluded.power_requirement_kw,
          metadata = coalesce(target.metadata, '{}'::jsonb) || excluded.metadata,
          is_active = excluded.is_active
    returning to_jsonb(target) into v_row;
    v_processes := v_processes || jsonb_build_array(v_row);
  end loop;

  update public.processes p
     set is_active = false
   where p.factory_id = v_factory.id
     and not exists (
       select 1 from jsonb_array_elements(p_processes) submitted
        where submitted.value->>'slug' = p.slug
     );

  insert into public.electricity_tariffs (
    factory_id, slug, name, currency, start_time, end_time,
    energy_price_per_kwh, priority, metadata
  ) values
    (v_factory.id, 'builder-off-peak-early', 'Builder off-peak', p_factory->>'currency', '00:00', '18:00',
      (p_factory->>'off_peak_tariff')::numeric, 10, '{"managed_by":"factory_builder"}'::jsonb),
    (v_factory.id, 'builder-peak', 'Builder peak', p_factory->>'currency', '18:00', '22:00',
      (p_factory->>'peak_tariff')::numeric, 20, '{"managed_by":"factory_builder"}'::jsonb),
    (v_factory.id, 'builder-off-peak-late', 'Builder off-peak', p_factory->>'currency', '22:00', '23:59',
      (p_factory->>'off_peak_tariff')::numeric, 10, '{"managed_by":"factory_builder"}'::jsonb)
  on conflict (factory_id, slug) do update
    set name = excluded.name,
        currency = excluded.currency,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        energy_price_per_kwh = excluded.energy_price_per_kwh,
        priority = excluded.priority,
        metadata = coalesce(public.electricity_tariffs.metadata, '{}'::jsonb) || excluded.metadata;

  return jsonb_build_object(
    'factory_id', v_factory.id,
    'factory', to_jsonb(v_factory),
    'machines', v_machines,
    'processes', v_processes
  );
end;
$$;

revoke execute on function public.save_factory_builder(uuid, jsonb, jsonb, jsonb) from public;
revoke execute on function public.save_factory_builder(uuid, jsonb, jsonb, jsonb) from anon;
revoke execute on function public.save_factory_builder(uuid, jsonb, jsonb, jsonb) from authenticated;
grant execute on function public.save_factory_builder(uuid, jsonb, jsonb, jsonb) to service_role;

notify pgrst, 'reload schema';
