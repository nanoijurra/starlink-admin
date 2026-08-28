-- Starlink Admin ACC Cordoba - concepto neutral para pagos reales
-- Ejecutar despues de sql/010_cuenta_corriente_por_fecha_pago.sql.

begin;

alter table public.pagos
drop constraint if exists pagos_concepto_check;

alter table public.pagos
add constraint pagos_concepto_check
check (concepto in ('COMPRA_INICIAL','REGULARIZACION','ABONO','AJUSTE','PAGO'));

commit;
