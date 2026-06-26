-- Starlink Admin ACC Cordoba - RPC estado mensual
-- Ejecutar despues de las migraciones anteriores.

create or replace function public.get_calculo_mensual_estado(p_mes text)
returns table (
  persona_id uuid,
  nombre text,
  dependencia text,
  mes text,
  equipo_mes numeric,
  abono_mes numeric,
  total_mes numeric,
  pagado numeric,
  ajuste_saldo_favor numeric,
  pendiente_hoy numeric,
  estado text,
  observacion text,
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
      ac.compra_equipo,
      ac.recargo_compra_pct,
      ac.abono_mensual,
      ac.recargo_abono_pct
    from public.app_config ac
    order by ac.updated_at desc
    limit 1
  ),
  activos as (
    select p.*
    from public.personas p
    where p.estado = 'ACTIVO'
  ),
  cantidad_activos as (
    select count(*)::numeric as cantidad
    from activos
  ),
  base as (
    select
      round((cfg.compra_equipo * (1 + cfg.recargo_compra_pct / 100))::numeric, 2) as total_equipo_actualizado,
      round((cfg.abono_mensual * (1 + cfg.recargo_abono_pct / 100))::numeric, 2) as total_abono_actualizado,
      cantidad_activos.cantidad as usuarios_activos
    from cfg
    cross join cantidad_activos
  ),
  calculo_base as (
    select
      p.id as persona_id,
      p.nombre,
      p.dependencia,
      p.router_estado,
      p.mac_1,
      p.mac_2,
      case
        when b.usuarios_activos > 0 then round((b.total_equipo_actualizado / b.usuarios_activos)::numeric, 2)
        else 0::numeric
      end as equipo_objetivo,
      case
        when b.usuarios_activos > 0 then round((b.total_abono_actualizado / b.usuarios_activos)::numeric, 2)
        else 0::numeric
      end as abono_mes
    from activos p
    cross join base b
    where v_can_read
       or (v_is_usuario and p.id = v_persona_id)
  ),
  pagos_calculados as (
    select
      cb.*,
      coalesce(sum(pg.monto) filter (
        where pg.concepto in ('COMPRA_INICIAL', 'REGULARIZACION')
          and pg.mes_aplicado < v_mes
      ), 0)::numeric as pagado_equipo_previo,
      coalesce(sum(pg.monto) filter (
        where pg.concepto in ('COMPRA_INICIAL', 'REGULARIZACION')
          and pg.mes_aplicado = v_mes
      ), 0)::numeric as pagado_equipo_mes,
      coalesce(sum(pg.monto) filter (
        where pg.concepto = 'ABONO'
          and pg.mes_aplicado = v_mes
      ), 0)::numeric as pagado_abono_mes,
      coalesce(sum(pg.monto) filter (
        where pg.concepto = 'AJUSTE'
          and pg.mes_aplicado = v_mes
      ), 0)::numeric as pagado_ajuste_mes
    from calculo_base cb
    left join public.pagos pg on pg.persona_id = cb.persona_id
    group by
      cb.persona_id,
      cb.nombre,
      cb.dependencia,
      cb.router_estado,
      cb.mac_1,
      cb.mac_2,
      cb.equipo_objetivo,
      cb.abono_mes
  ),
  importes as (
    select
      pc.*,
      round(greatest(pc.equipo_objetivo - pc.pagado_equipo_previo, 0)::numeric, 2) as equipo_mes,
      round(pc.abono_mes::numeric, 2) as abono_mes_redondeado,
      round((pc.pagado_equipo_mes + pc.pagado_abono_mes + pc.pagado_ajuste_mes)::numeric, 2) as pagado,
      round(pc.pagado_ajuste_mes::numeric, 2) as ajuste_saldo_favor
    from pagos_calculados pc
  ),
  estado_calculado as (
    select
      i.*,
      round((i.equipo_mes + i.abono_mes_redondeado)::numeric, 2) as total_mes,
      round(greatest(i.equipo_mes + i.abono_mes_redondeado - i.pagado_equipo_mes - i.pagado_abono_mes, 0)::numeric, 2) as pendiente_hoy,
      round((i.pagado_equipo_mes + i.pagado_abono_mes)::numeric, 2) as pagado_sin_ajuste
    from importes i
  )
  select
    ec.persona_id,
    ec.nombre,
    ec.dependencia,
    v_mes as mes,
    round(ec.equipo_mes::numeric, 2) as equipo_mes,
    round(ec.abono_mes_redondeado::numeric, 2) as abono_mes,
    round(ec.total_mes::numeric, 2) as total_mes,
    round(ec.pagado::numeric, 2) as pagado,
    round(ec.ajuste_saldo_favor::numeric, 2) as ajuste_saldo_favor,
    round(ec.pendiente_hoy::numeric, 2) as pendiente_hoy,
    case
      when ec.total_mes <= 0.01 and ec.pagado <= 0.01 then 'SIN CARGO'
      when ec.pendiente_hoy <= 0.01 and ec.ajuste_saldo_favor > 0.01 then 'SALDO A FAVOR'
      when ec.pendiente_hoy <= 0.01 then 'AL DIA'
      when ec.pendiente_hoy > 0.01 and ec.pagado_sin_ajuste <= 0.01 then 'PENDIENTE'
      when ec.pendiente_hoy > 0.01 and ec.pagado_sin_ajuste > 0.01 then 'PARCIAL'
      else 'SIN CARGO'
    end as estado,
    case
      when ec.total_mes <= 0.01 and ec.pagado <= 0.01 then 'Sin cargo para este mes.'
      when ec.pendiente_hoy <= 0.01 and ec.ajuste_saldo_favor > 0.01 then 'Saldo a favor registrado.'
      when ec.pendiente_hoy <= 0.01 and ec.equipo_mes > 0.01 then 'Compra inicial / regularizacion + abono registrados.'
      when ec.pendiente_hoy <= 0.01 then 'Cuota mensual registrada.'
      when ec.pendiente_hoy > 0.01 and ec.pagado_sin_ajuste > 0.01 then 'Pago parcial registrado.'
      else 'Cuota mensual pendiente.'
    end as observacion,
    ec.router_estado,
    ec.mac_1,
    ec.mac_2
  from estado_calculado ec
  order by ec.nombre;
end;
$$;

revoke all on function public.get_calculo_mensual_estado(text) from public;
grant execute on function public.get_calculo_mensual_estado(text) to authenticated;
