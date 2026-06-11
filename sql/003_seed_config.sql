-- Starlink Admin ACC Cordoba - seed inicial
-- Ejecutar despues de 001_schema.sql y 002_rls.sql.

insert into public.app_config (
  compra_equipo,
  recargo_compra_pct,
  abono_mensual,
  recargo_abono_pct,
  fundadores_iniciales,
  meses_mora_suspension,
  metodo_equilibrio
)
select
  1077399,
  1.5,
  65000,
  1.5,
  49,
  3,
  'RAPIDO'
where not exists (select 1 from public.app_config);
