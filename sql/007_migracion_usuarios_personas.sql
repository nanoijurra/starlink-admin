-- Starlink Admin ACC Cordoba - usuarios comunes vinculados a personas
-- Ejecutar despues de las migraciones anteriores.

alter table public.profiles
add column if not exists persona_id uuid references public.personas(id) on delete set null;

alter table public.profiles
drop constraint if exists profiles_rol_check;

alter table public.profiles
add constraint profiles_rol_check
check (rol in ('ADMIN', 'LECTURA', 'USUARIO'));

create index if not exists idx_profiles_persona_id
on public.profiles(persona_id);

create index if not exists idx_profiles_rol
on public.profiles(rol);

create or replace function public.current_user_persona_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select persona_id
  from public.profiles
  where id = auth.uid()
    and activo = true
  limit 1;
$$;

create or replace function public.current_user_is_usuario()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and activo = true
      and rol = 'USUARIO'
  );
$$;

create or replace function public.current_user_is_active()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and activo = true
  );
$$;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
on public.profiles
for select
to authenticated
using (id = auth.uid());

drop policy if exists profiles_insert_self_usuario on public.profiles;
create policy profiles_insert_self_usuario
on public.profiles
for insert
to authenticated
with check (
  id = auth.uid()
  and rol = 'USUARIO'
  and activo = true
  and persona_id is null
);

drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin
on public.profiles
for update
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists profiles_delete_admin on public.profiles;

drop policy if exists personas_select_own_usuario on public.personas;
create policy personas_select_own_usuario
on public.personas
for select
to authenticated
using (
  public.current_user_is_usuario()
  and id = public.current_user_persona_id()
);

drop policy if exists pagos_select_own_usuario on public.pagos;
create policy pagos_select_own_usuario
on public.pagos
for select
to authenticated
using (
  public.current_user_is_usuario()
  and persona_id = public.current_user_persona_id()
);

drop policy if exists cargos_select_own_usuario on public.cargos_mensuales;
create policy cargos_select_own_usuario
on public.cargos_mensuales
for select
to authenticated
using (
  public.current_user_is_usuario()
  and persona_id = public.current_user_persona_id()
);

drop policy if exists app_config_select_active_users on public.app_config;
create policy app_config_select_active_users
on public.app_config
for select
to authenticated
using (public.current_user_is_active());
