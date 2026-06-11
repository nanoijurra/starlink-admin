-- Starlink Admin ACC Cordoba - migracion componentes cargos mensuales
-- Ejecutar despues de 003_seed_config.sql.

alter table public.cargos_mensuales
add column if not exists abono_base numeric not null default 0,
add column if not exists cargo_equipo numeric not null default 0,
add column if not exists concepto_equipo text,
add column if not exists compensacion_aplicada numeric not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'cargos_mensuales_concepto_equipo_check'
      and conrelid = 'public.cargos_mensuales'::regclass
  ) then
    alter table public.cargos_mensuales
    add constraint cargos_mensuales_concepto_equipo_check
    check (concepto_equipo is null or concepto_equipo in ('COMPRA_INICIAL', 'REGULARIZACION'));
  end if;
end;
$$;
