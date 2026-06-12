-- Starlink Admin ACC Cordoba - migracion contacto y MAC
-- Ejecutar despues de las migraciones anteriores.

alter table public.personas
add column if not exists telefono_whatsapp text;

alter table public.personas
add column if not exists mac_1 text;

alter table public.personas
add column if not exists mac_2 text;

update public.personas
set mac_1 = mac
where mac_1 is null
  and mac is not null;
