-- Starlink Admin ACC Cordoba - RLS
-- Ejecutar despues de 001_schema.sql.

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.rol
  from public.profiles p
  where p.id = auth.uid()
    and p.activo = true
  limit 1;
$$;

create or replace function public.current_user_is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.activo = true
  );
$$;

create or replace function public.current_user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_profile_role() = 'ADMIN';
$$;

create or replace function public.current_user_can_read()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_profile_role() in ('ADMIN', 'LECTURA');
$$;

alter table public.profiles enable row level security;
alter table public.app_config enable row level security;
alter table public.personas enable row level security;
alter table public.pagos enable row level security;
alter table public.cierres_mensuales enable row level security;
alter table public.cargos_mensuales enable row level security;
alter table public.audit_log enable row level security;

drop policy if exists profiles_select_active on public.profiles;
create policy profiles_select_active
on public.profiles
for select
to authenticated
using (public.current_user_can_read());

drop policy if exists profiles_insert_admin on public.profiles;
create policy profiles_insert_admin
on public.profiles
for insert
to authenticated
with check (public.current_user_is_admin());

drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin
on public.profiles
for update
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists profiles_delete_admin on public.profiles;

drop policy if exists app_config_select_readers on public.app_config;
create policy app_config_select_readers
on public.app_config
for select
to authenticated
using (public.current_user_can_read());

drop policy if exists app_config_insert_admin on public.app_config;
create policy app_config_insert_admin
on public.app_config
for insert
to authenticated
with check (public.current_user_is_admin());

drop policy if exists app_config_update_admin on public.app_config;
create policy app_config_update_admin
on public.app_config
for update
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists app_config_delete_admin on public.app_config;

drop policy if exists personas_select_readers on public.personas;
create policy personas_select_readers
on public.personas
for select
to authenticated
using (public.current_user_can_read());

drop policy if exists personas_insert_admin on public.personas;
create policy personas_insert_admin
on public.personas
for insert
to authenticated
with check (public.current_user_is_admin());

drop policy if exists personas_update_admin on public.personas;
create policy personas_update_admin
on public.personas
for update
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists personas_delete_admin on public.personas;

drop policy if exists pagos_select_readers on public.pagos;
create policy pagos_select_readers
on public.pagos
for select
to authenticated
using (public.current_user_can_read());

drop policy if exists pagos_insert_admin on public.pagos;
create policy pagos_insert_admin
on public.pagos
for insert
to authenticated
with check (public.current_user_is_admin());

drop policy if exists pagos_update_admin on public.pagos;
create policy pagos_update_admin
on public.pagos
for update
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists pagos_delete_admin on public.pagos;

drop policy if exists cierres_select_readers on public.cierres_mensuales;
create policy cierres_select_readers
on public.cierres_mensuales
for select
to authenticated
using (public.current_user_can_read());

drop policy if exists cierres_insert_admin on public.cierres_mensuales;
create policy cierres_insert_admin
on public.cierres_mensuales
for insert
to authenticated
with check (public.current_user_is_admin());

drop policy if exists cierres_update_admin on public.cierres_mensuales;
create policy cierres_update_admin
on public.cierres_mensuales
for update
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists cierres_delete_admin on public.cierres_mensuales;

drop policy if exists cargos_select_readers on public.cargos_mensuales;
create policy cargos_select_readers
on public.cargos_mensuales
for select
to authenticated
using (public.current_user_can_read());

drop policy if exists cargos_insert_admin on public.cargos_mensuales;
create policy cargos_insert_admin
on public.cargos_mensuales
for insert
to authenticated
with check (public.current_user_is_admin());

drop policy if exists cargos_update_admin on public.cargos_mensuales;
create policy cargos_update_admin
on public.cargos_mensuales
for update
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists cargos_delete_admin on public.cargos_mensuales;

drop policy if exists audit_select_readers on public.audit_log;
create policy audit_select_readers
on public.audit_log
for select
to authenticated
using (public.current_user_can_read());

drop policy if exists audit_insert_admin on public.audit_log;
drop policy if exists audit_update_admin on public.audit_log;
drop policy if exists audit_delete_admin on public.audit_log;

-- Sin politicas para anon: cualquier usuario no autenticado queda bloqueado por RLS.
