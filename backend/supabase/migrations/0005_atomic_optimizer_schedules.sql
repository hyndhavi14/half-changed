-- Atomically create the baseline/optimized draft schedules for a completed
-- optimizer result, including every schedule entry and the request status.
--
-- The optimization_results row is committed separately before this function:
-- if this transaction fails, the validated raw optimizer response remains
-- auditable while no partial schedule data is committed.
create or replace function public.persist_optimization_schedules(
  p_factory_id uuid,
  p_optimization_request_id uuid,
  p_optimization_result_id uuid,
  p_adapter text,
  p_schedules jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_factory_id uuid;
  v_request public.optimization_requests%rowtype;
  v_result public.optimization_results%rowtype;
  v_spec jsonb;
  v_kind text;
  v_name text;
  v_version integer;
  v_schedule public.schedules%rowtype;
  v_entries jsonb;
  v_schedule_rows jsonb := '[]'::jsonb;
  v_schedule_ids jsonb;
  v_kinds text[] := array[]::text[];
begin
  -- Serialize version allocation for both generated schedule names in one
  -- factory. The generated versions never overwrite an earlier plan.
  select f.id into v_factory_id
    from public.factories f
   where f.id = p_factory_id
     for update;
  if not found then
    raise exception 'factory % does not exist', p_factory_id using errcode = 'P0002';
  end if;

  select r.* into v_request
    from public.optimization_requests r
   where r.id = p_optimization_request_id
     and r.factory_id = p_factory_id
     for update;
  if not found or v_request.status <> 'running' then
    raise exception 'optimization request is missing or not running'
      using errcode = '23514';
  end if;

  select r.* into v_result
    from public.optimization_results r
   where r.id = p_optimization_result_id
     and r.factory_id = p_factory_id
     and r.optimization_request_id = p_optimization_request_id
     and r.status = 'succeeded';
  if not found then
    raise exception 'successful optimization result does not belong to the request'
      using errcode = '23514';
  end if;

  if p_schedules is null
     or coalesce(jsonb_typeof(p_schedules) <> 'array', true)
     or jsonb_array_length(p_schedules) < 1
     or jsonb_array_length(p_schedules) > 2 then
    raise exception 'one or two optimizer schedules are required'
      using errcode = '23514';
  end if;

  for v_spec in select value from jsonb_array_elements(p_schedules)
  loop
    v_kind := v_spec->>'kind';
    if v_kind is null
       or v_kind not in ('baseline', 'optimized')
       or v_kind = any(v_kinds)
       or coalesce(jsonb_typeof(v_spec->'entries') <> 'array', true)
       or jsonb_array_length(v_spec->'entries') < 1 then
      raise exception 'optimizer schedule payload is invalid'
        using errcode = '23514';
    end if;
    v_kinds := array_append(v_kinds, v_kind);
    v_name := case v_kind
      when 'baseline' then 'Optimizer baseline'
      else 'Optimizer optimized'
    end;

    select coalesce(max(s.version), 0) + 1 into v_version
      from public.schedules s
     where s.factory_id = p_factory_id
       and s.name = v_name;

    insert into public.schedules (
      factory_id, name, version, status, horizon_start, horizon_end,
      optimization_request_id, optimization_result_id, total_energy_cost,
      total_energy_kwh, peak_demand_kw, metadata
    ) values (
      p_factory_id,
      v_name,
      v_version,
      'draft',
      (v_spec->>'horizon_start')::timestamptz,
      (v_spec->>'horizon_end')::timestamptz,
      p_optimization_request_id,
      p_optimization_result_id,
      nullif(v_spec->>'total_energy_cost', '')::numeric,
      nullif(v_spec->>'total_energy_kwh', '')::numeric,
      nullif(v_spec->>'peak_demand_kw', '')::numeric,
      jsonb_build_object('kind', v_kind)
    )
    returning * into v_schedule;

    insert into public.schedule_entries (
      schedule_id, machine_id, process_id, production_order_id, starts_at,
      ends_at, power_kw, energy_kwh, cost, quantity, sequence, metadata
    )
    select
      v_schedule.id,
      (entry.value->>'machine_id')::uuid,
      (entry.value->>'process_id')::uuid,
      nullif(entry.value->>'production_order_id', '')::uuid,
      (entry.value->>'starts_at')::timestamptz,
      (entry.value->>'ends_at')::timestamptz,
      nullif(entry.value->>'power_kw', '')::numeric,
      nullif(entry.value->>'energy_kwh', '')::numeric,
      nullif(entry.value->>'cost', '')::numeric,
      nullif(entry.value->>'quantity', '')::numeric,
      coalesce((entry.value->>'sequence')::integer, 0),
      coalesce(entry.value->'metadata', '{}'::jsonb)
    from jsonb_array_elements(v_spec->'entries') as entry(value);

    select coalesce(
      jsonb_agg(to_jsonb(se) order by se.starts_at, se.sequence, se.id),
      '[]'::jsonb
    ) into v_entries
      from public.schedule_entries se
     where se.schedule_id = v_schedule.id;

    v_schedule_rows := v_schedule_rows || jsonb_build_array(jsonb_build_object(
      'schedule', to_jsonb(v_schedule),
      'entries', v_entries
    ));
  end loop;

  if not ('optimized' = any(v_kinds)) then
    raise exception 'optimized schedule is required' using errcode = '23514';
  end if;

  select coalesce(jsonb_agg(item->'schedule'->'id'), '[]'::jsonb)
    into v_schedule_ids
    from jsonb_array_elements(v_schedule_rows) as item;

  update public.optimization_requests
     set status = 'succeeded',
         error_message = null,
         adapter_metadata = coalesce(adapter_metadata, '{}'::jsonb) || jsonb_build_object(
           'adapter', p_adapter,
           'optimization_result_id', p_optimization_result_id,
           'schedule_persistence_status', 'succeeded',
           'schedule_ids', v_schedule_ids
         )
   where id = p_optimization_request_id
     and factory_id = p_factory_id
  returning * into v_request;

  return jsonb_build_object(
    'request', to_jsonb(v_request),
    'schedules', v_schedule_rows
  );
end;
$$;

revoke execute on function public.persist_optimization_schedules(uuid, uuid, uuid, text, jsonb) from public;
revoke execute on function public.persist_optimization_schedules(uuid, uuid, uuid, text, jsonb) from anon;
revoke execute on function public.persist_optimization_schedules(uuid, uuid, uuid, text, jsonb) from authenticated;
grant execute on function public.persist_optimization_schedules(uuid, uuid, uuid, text, jsonb) to service_role;

notify pgrst, 'reload schema';
