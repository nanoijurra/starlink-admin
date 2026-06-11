-- Starlink Admin ACC Cordoba - migracion alias bancario
-- Ejecutar despues de 003_seed_config.sql.

alter table public.app_config
add column if not exists alias_bancario text;
