-- Starlink Admin ACC Cordoba - cuenta corriente por fecha real de pago
-- Ejecutar despues de las migraciones anteriores.

begin;

drop function if exists public.get_calculo_mensual_estado(text);

create or replace function public.get_calculo_mensual_estado(p_mes text)
returns table (
  persona_id uuid,
  nombre text,
  dependencia text,
  mes text,
  usuarios_activos numeric,
  cuota_equipo_por_persona numeric,
  cuota_abono_mes numeric,
  cargo_equipo numeric,
  cargo_abono numeric,
  total_cargos_mes numeric,
  pagos_del_mes numeric,
  pagos_acumulados numeric,
  saldo_anterior numeric,
  saldo_actual numeric,
  saldo_a_favor_inicial numeric,
  saldo_a_favor_final numeric,
  pendiente_hoy numeric,
  estado text,
  observacion text,
  equipo_mes numeric,
  abono_mes numeric,
  total_mes numeric,
  pagado numeric,
  ajuste_saldo_favor numeric,
  equipo_pendiente numeric,
  abono_pendiente numeric,
  router_estado text,
  mac_1 text,
  mac_2 text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mes text := replace(coalesce(p_mes, ''), '/', '-');
  v_mes_inicio date;
  v_mes_fin date;
  v_persona_id uuid;
  v_can_read boolean;
  v_is_usuario boolean;
begin
  if auth.uid() is null then
    return;
  end if;

  if v_mes !~ '^[0-9]{4}-[0-9]{2}$' then
    return;
  end if;

  if not public.current_user_is_active() then
    return;
  end if;

  v_mes_inicio := to_date(v_mes || '-01', 'YYYY-MM-DD');
  v_mes_fin := (v_mes_inicio + interval '1 month - 1 day')::date;
  v_can_read := public.current_user_can_read();
  v_is_usuario := public.current_user_is_usuario();
  v_persona_id := public.current_user_persona_id();

  if not v_can_read and not v_is_usuario then
    return;
  end if;

  if v_is_usuario and v_persona_id is null then
    return;
  end if;

  return query
  with cfg as (
    select
      round((ac.compra_equipo * (1 + ac.recargo_compra_pct / 100))::numeric, 2) as total_equipo_calculado,
      round((ac.abono_mensual * (1 + ac.recargo_abono_pct / 100))::numeric, 2) as total_abono_calculado
    from public.app_config ac
    order by ac.updated_at desc
    limit 1
  ),
  meses_base as (
    select datos.valor as mes
    from (
      select to_char(p.fecha_pago, 'YYYY-MM') as valor
      from public.pagos p
      union all
      select to_char(p.fecha_ingreso, 'YYYY-MM') as valor
      from public.personas p
      where p.fecha_ingreso is not null
      union all
      select cm.mes as valor
      from public.cargos_mensuales cm
      union all
      select v_mes as valor
    ) datos
    where datos.valor ~ '^[0-9]{4}-[0-9]{2}$'
  ),
  primer_mes as (
    select min(mb.mes) as mes_inicio
    from meses_base mb
  ),
  meses as (
    select to_char(gs.mes_generado, 'YYYY-MM') as mes
    from primer_mes pm
    cross join generate_series(
      to_date(pm.mes_inicio || '-01', 'YYYY-MM-DD'),
      v_mes_inicio,
      interval '1 month'
    ) as gs(mes_generado)
  ),
  primeros_pagos as (
    select
      p.persona_id,
      min(to_char(p.fecha_pago, 'YYYY-MM')) as primer_pago_mes
    from public.pagos p
    group by p.persona_id
  ),
  personas_activas as (
    select
      p.id,
      p.nombre,
      p.dependencia,
      p.es_fundador,
      p.router_estado,
      p.mac_1,
      p.mac_2,
      coalesce(
        to_char(p.fecha_ingreso, 'YYYY-MM'),
        case
          when p.es_fundador then (select pm_inicio.mes_inicio from primer_mes pm_inicio)
          when pp.primer_pago_mes is not null then pp.primer_pago_mes
          else v_mes
        end
      ) as mes_inicio_participacion
    from public.personas p
    left join primeros_pagos pp on pp.persona_id = p.id
    where p.estado = 'ACTIVO'
  ),
  participantes_mes as (
    select
      m.mes,
      p.id as persona_id,
      p.nombre,
      p.dependencia,
      p.router_estado,
      p.mac_1,
      p.mac_2
    from meses m
    join personas_activas p on p.mes_inicio_participacion <= m.mes
  ),
  cantidad_mes as (
    select pm.mes, count(*)::numeric as usuarios_activos
    from participantes_mes pm
    group by pm.mes
  ),
  cargos_mes as (
    select
      pm.persona_id,
      pm.nombre,
      pm.dependencia,
      pm.router_estado,
      pm.mac_1,
      pm.mac_2,
      pm.mes,
      cm.usuarios_activos,
      round((cfg.total_equipo_calculado / nullif(cm.usuarios_activos, 0))::numeric, 2) as cuota_equipo_por_persona,
      round((cfg.total_abono_calculado / nullif(cm.usuarios_activos, 0))::numeric, 2) as cuota_abono_mes
    from participantes_mes pm
    join cantidad_mes cm on cm.mes = pm.mes
    cross join cfg
  ),
  cargos_con_delta as (
    select
      cm.persona_id,
      cm.nombre,
      cm.dependencia,
      cm.router_estado,
      cm.mac_1,
      cm.mac_2,
      cm.mes,
      cm.usuarios_activos,
      cm.cuota_equipo_por_persona,
      cm.cuota_abono_mes,
      round((
        cm.cuota_equipo_por_persona
        - coalesce(lag(cm.cuota_equipo_por_persona) over (partition by cm.persona_id order by cm.mes), 0)
      )::numeric, 2) as cargo_equipo_mes,
      cm.cuota_abono_mes as cargo_abono_mes
    from cargos_mes cm
  ),
  resumen_cargos as (
    select
      actual.persona_id,
      actual.nombre,
      actual.dependencia,
      actual.router_estado,
      actual.mac_1,
      actual.mac_2,
      actual.usuarios_activos,
      actual.cuota_equipo_por_persona,
      actual.cuota_abono_mes,
      actual.cargo_equipo_mes,
      actual.cargo_abono_mes,
      round((actual.cargo_equipo_mes + actual.cargo_abono_mes)::numeric, 2) as total_cargos_mes,
      round((actual.cuota_equipo_por_persona + coalesce(sum(prev.cuota_abono_mes), 0))::numeric, 2) as cargos_acumulados,
      round((coalesce(prev_obj.cuota_equipo_por_persona, 0) + coalesce(sum(prev.cuota_abono_mes) filter (where prev.mes < v_mes), 0))::numeric, 2) as cargos_acumulados_previos
    from cargos_con_delta actual
    left join cargos_mes prev
      on prev.persona_id = actual.persona_id
      and prev.mes <= v_mes
    left join lateral (
      select cprev.cuota_equipo_por_persona
      from cargos_mes cprev
      where cprev.persona_id = actual.persona_id
        and cprev.mes < v_mes
      order by cprev.mes desc
      limit 1
    ) prev_obj on true
    where actual.mes = v_mes
    group by
      actual.persona_id,
      actual.nombre,
      actual.dependencia,
      actual.router_estado,
      actual.mac_1,
      actual.mac_2,
      actual.usuarios_activos,
      actual.cuota_equipo_por_persona,
      actual.cuota_abono_mes,
      actual.cargo_equipo_mes,
      actual.cargo_abono_mes,
      prev_obj.cuota_equipo_por_persona
  ),
  pagos_reales as (
    select
      rc.persona_id,
      rc.nombre,
      rc.dependencia,
      rc.router_estado,
      rc.mac_1,
      rc.mac_2,
      rc.usuarios_activos,
      rc.cuota_equipo_por_persona,
      rc.cuota_abono_mes,
      rc.cargo_equipo_mes,
      rc.cargo_abono_mes,
      rc.total_cargos_mes,
      rc.cargos_acumulados,
      rc.cargos_acumulados_previos,
      round(coalesce(sum(p.monto) filter (
        where p.fecha_pago >= v_mes_inicio
          and p.fecha_pago <= v_mes_fin
      ), 0)::numeric, 2) as pagos_del_mes,
      round(coalesce(sum(p.monto) filter (
        where p.fecha_pago <= v_mes_fin
      ), 0)::numeric, 2) as pagos_acumulados,
      round(coalesce(sum(p.monto) filter (
        where p.fecha_pago < v_mes_inicio
      ), 0)::numeric, 2) as pagos_previos
    from resumen_cargos rc
    left join public.pagos p on p.persona_id = rc.persona_id
    group by
      rc.persona_id,
      rc.nombre,
      rc.dependencia,
      rc.router_estado,
      rc.mac_1,
      rc.mac_2,
      rc.usuarios_activos,
      rc.cuota_equipo_por_persona,
      rc.cuota_abono_mes,
      rc.cargo_equipo_mes,
      rc.cargo_abono_mes,
      rc.total_cargos_mes,
      rc.cargos_acumulados,
      rc.cargos_acumulados_previos
  ),
  cuenta as (
    select
      pr.persona_id,
      pr.nombre,
      pr.dependencia,
      pr.router_estado,
      pr.mac_1,
      pr.mac_2,
      pr.usuarios_activos,
      pr.cuota_equipo_por_persona,
      pr.cuota_abono_mes,
      pr.cargo_equipo_mes,
      pr.cargo_abono_mes,
      pr.total_cargos_mes,
      pr.cargos_acumulados,
      pr.cargos_acumulados_previos,
      pr.pagos_del_mes,
      pr.pagos_acumulados,
      pr.pagos_previos,
      round((pr.pagos_previos - pr.cargos_acumulados_previos)::numeric, 2) as saldo_anterior,
      round((pr.pagos_acumulados - pr.cargos_acumulados)::numeric, 2) as saldo_actual,
      round(greatest(pr.cuota_equipo_por_persona - pr.pagos_acumulados, 0)::numeric, 2) as equipo_pendiente
    from pagos_reales pr
  ),
  final as (
    select
      c.persona_id,
      c.nombre,
      c.dependencia,
      c.router_estado,
      c.mac_1,
      c.mac_2,
      c.usuarios_activos,
      c.cuota_equipo_por_persona,
      c.cuota_abono_mes,
      c.cargo_equipo_mes,
      c.cargo_abono_mes,
      c.total_cargos_mes,
      c.cargos_acumulados,
      c.cargos_acumulados_previos,
      c.pagos_del_mes,
      c.pagos_acumulados,
      c.pagos_previos,
      c.saldo_anterior,
      c.saldo_actual,
      c.equipo_pendiente,
      round(greatest(-c.saldo_actual, 0)::numeric, 2) as pendiente_hoy,
      round(greatest(c.saldo_anterior, 0)::numeric, 2) as saldo_a_favor_inicial,
      round(greatest(c.saldo_actual, 0)::numeric, 2) as saldo_a_favor_final
    from cuenta c
  )
  select
    f.persona_id,
    f.nombre,
    f.dependencia,
    v_mes as mes,
    f.usuarios_activos,
    round(f.cuota_equipo_por_persona::numeric, 2) as cuota_equipo_por_persona,
    round(f.cuota_abono_mes::numeric, 2) as cuota_abono_mes,
    round(f.cargo_equipo_mes::numeric, 2) as cargo_equipo,
    round(f.cargo_abono_mes::numeric, 2) as cargo_abono,
    round(f.total_cargos_mes::numeric, 2) as total_cargos_mes,
    round(f.pagos_del_mes::numeric, 2) as pagos_del_mes,
    round(f.pagos_acumulados::numeric, 2) as pagos_acumulados,
    round(f.saldo_anterior::numeric, 2) as saldo_anterior,
    round(f.saldo_actual::numeric, 2) as saldo_actual,
    round(f.saldo_a_favor_inicial::numeric, 2) as saldo_a_favor_inicial,
    round(f.saldo_a_favor_final::numeric, 2) as saldo_a_favor_final,
    round(f.pendiente_hoy::numeric, 2) as pendiente_hoy,
    case
      when abs(f.total_cargos_mes) <= 0.01 and abs(f.saldo_actual) <= 0.01 and f.pagos_del_mes <= 0.01 then 'SIN CARGO'
      when f.pendiente_hoy <= 0.01 and f.saldo_a_favor_final > 0.01 then 'SALDO A FAVOR'
      when f.pendiente_hoy <= 0.01 then 'AL DIA'
      when f.pendiente_hoy > 0.01 and f.pagos_del_mes <= 0.01 then 'PENDIENTE'
      when f.pendiente_hoy > 0.01 and f.pagos_del_mes > 0.01 then 'PARCIAL'
      else 'SIN CARGO'
    end as estado,
    case
      when abs(f.total_cargos_mes) <= 0.01 and abs(f.saldo_actual) <= 0.01 and f.pagos_del_mes <= 0.01 then 'Sin cargo para este mes.'
      when f.pendiente_hoy <= 0.01 and f.saldo_a_favor_final > 0.01 then 'Saldo a favor disponible.'
      when f.pendiente_hoy <= 0.01 then 'Cuenta al dia.'
      when f.pendiente_hoy > 0.01 and f.pagos_del_mes > 0.01 then 'Pago parcial registrado.'
      else 'Cuenta pendiente.'
    end as observacion,
    round(f.cargo_equipo_mes::numeric, 2) as equipo_mes,
    round(f.cargo_abono_mes::numeric, 2) as abono_mes,
    round(f.total_cargos_mes::numeric, 2) as total_mes,
    round(f.pagos_del_mes::numeric, 2) as pagado,
    round(f.saldo_a_favor_final::numeric, 2) as ajuste_saldo_favor,
    round(f.equipo_pendiente::numeric, 2) as equipo_pendiente,
    round(greatest(f.pendiente_hoy - f.equipo_pendiente, 0)::numeric, 2) as abono_pendiente,
    f.router_estado,
    f.mac_1,
    f.mac_2
  from final f
  where v_can_read
     or (v_is_usuario and f.persona_id = v_persona_id)
  order by f.nombre;
end;
$$;

revoke all on function public.get_calculo_mensual_estado(text) from public;
grant execute on function public.get_calculo_mensual_estado(text) to authenticated;

commit;
