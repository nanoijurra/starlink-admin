-- Starlink Admin ACC Cordoba - comprobantes pendientes
-- Ejecutar despues de 007_migracion_usuarios_personas.sql.

insert into storage.buckets (id, name, public)
values ('comprobantes-pago', 'comprobantes-pago', false)
on conflict (id) do nothing;

create table if not exists public.comprobantes_pago (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid not null references public.personas(id) on delete cascade,
  mes_aplicado text not null check (mes_aplicado ~ '^[0-9]{4}-[0-9]{2}$'),
  monto_informado numeric check (monto_informado is null or monto_informado >= 0),
  archivo_bucket text not null default 'comprobantes-pago',
  archivo_path text not null,
  archivo_nombre text,
  archivo_tipo text,
  archivo_tamano integer,
  estado text not null default 'PENDIENTE',
  observaciones text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) default auth.uid(),
  revisado_at timestamptz,
  revisado_by uuid references auth.users(id) on delete set null,
  pago_ids jsonb not null default '[]'::jsonb,
  constraint comprobantes_pago_estado_check
    check (estado in ('PENDIENTE', 'PROCESADO', 'DESCARTADO'))
);

create index if not exists idx_comprobantes_persona
on public.comprobantes_pago(persona_id);

create index if not exists idx_comprobantes_mes
on public.comprobantes_pago(mes_aplicado);

create index if not exists idx_comprobantes_estado
on public.comprobantes_pago(estado);

create index if not exists idx_comprobantes_created_at
on public.comprobantes_pago(created_at);

alter table public.comprobantes_pago enable row level security;

drop policy if exists comprobantes_select_own_usuario on public.comprobantes_pago;
create policy comprobantes_select_own_usuario
on public.comprobantes_pago
for select
to authenticated
using (
  public.current_user_is_usuario()
  and persona_id = public.current_user_persona_id()
);

drop policy if exists comprobantes_insert_own_usuario on public.comprobantes_pago;
create policy comprobantes_insert_own_usuario
on public.comprobantes_pago
for insert
to authenticated
with check (
  public.current_user_is_usuario()
  and persona_id = public.current_user_persona_id()
  and estado = 'PENDIENTE'
  and revisado_at is null
  and revisado_by is null
  and pago_ids = '[]'::jsonb
);

drop policy if exists comprobantes_select_readers on public.comprobantes_pago;
create policy comprobantes_select_readers
on public.comprobantes_pago
for select
to authenticated
using (public.current_user_can_read());

drop policy if exists comprobantes_insert_admin on public.comprobantes_pago;
create policy comprobantes_insert_admin
on public.comprobantes_pago
for insert
to authenticated
with check (public.current_user_is_admin());

drop policy if exists comprobantes_update_admin on public.comprobantes_pago;
create policy comprobantes_update_admin
on public.comprobantes_pago
for update
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists comprobantes_delete_admin on public.comprobantes_pago;

drop policy if exists storage_comprobantes_insert_own_usuario on storage.objects;
drop policy if exists comprobantes_storage_insert_own_usuario on storage.objects;
create policy comprobantes_storage_insert_own_usuario
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'comprobantes-pago'
  and public.current_user_is_usuario()
  and (storage.foldername(name))[1] = public.current_user_persona_id()::text
);

drop policy if exists storage_comprobantes_select_own_usuario on storage.objects;
drop policy if exists comprobantes_storage_select_own_usuario on storage.objects;
create policy comprobantes_storage_select_own_usuario
on storage.objects
for select
to authenticated
using (
  bucket_id = 'comprobantes-pago'
  and public.current_user_is_usuario()
  and (storage.foldername(name))[1] = public.current_user_persona_id()::text
);

drop policy if exists storage_comprobantes_select_readers on storage.objects;
drop policy if exists comprobantes_storage_select_readers on storage.objects;
create policy comprobantes_storage_select_readers
on storage.objects
for select
to authenticated
using (
  bucket_id = 'comprobantes-pago'
  and public.current_user_can_read()
);

drop policy if exists storage_comprobantes_insert_admin on storage.objects;
drop policy if exists comprobantes_storage_insert_admin on storage.objects;
create policy comprobantes_storage_insert_admin
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'comprobantes-pago'
  and public.current_user_is_admin()
);

drop policy if exists storage_comprobantes_update_admin on storage.objects;
drop policy if exists comprobantes_storage_update_admin on storage.objects;
create policy comprobantes_storage_update_admin
on storage.objects
for update
to authenticated
using (
  bucket_id = 'comprobantes-pago'
  and public.current_user_is_admin()
)
with check (
  bucket_id = 'comprobantes-pago'
  and public.current_user_is_admin()
);

drop policy if exists storage_comprobantes_delete_admin on storage.objects;
drop policy if exists comprobantes_storage_delete_admin on storage.objects;
create policy comprobantes_storage_delete_admin
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'comprobantes-pago'
  and public.current_user_is_admin()
);
