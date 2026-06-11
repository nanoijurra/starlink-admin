-- Starlink Admin ACC Cordoba - schema
-- Ejecutar primero en el SQL editor de Supabase.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  rol text not null check (rol in ('ADMIN', 'LECTURA')),
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.app_config (
  id uuid primary key default gen_random_uuid(),
  compra_equipo numeric not null check (compra_equipo >= 0),
  recargo_compra_pct numeric not null check (recargo_compra_pct >= 0),
  abono_mensual numeric not null check (abono_mensual >= 0),
  recargo_abono_pct numeric not null check (recargo_abono_pct >= 0),
  fundadores_iniciales integer not null default 49 check (fundadores_iniciales > 0),
  meses_mora_suspension integer not null default 3 check (meses_mora_suspension > 0),
  metodo_equilibrio text not null default 'RAPIDO' check (metodo_equilibrio in ('RAPIDO')),
  updated_at timestamptz not null default now()
);

create table if not exists public.personas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  dependencia text,
  estado text not null check (estado in ('ACTIVO','PENDIENTE','NO_PARTICIPA','SUSPENDIDO_MORA','BAJA_DEFINITIVA')),
  es_fundador boolean not null default false,
  fecha_ingreso date,
  mac text,
  observaciones text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pagos (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid not null references public.personas(id) on delete restrict,
  fecha_pago date not null,
  monto numeric not null check (monto >= 0),
  concepto text not null check (concepto in ('COMPRA_INICIAL','ABONO','REGULARIZACION','AJUSTE')),
  mes_aplicado text not null check (mes_aplicado ~ '^[0-9]{4}-[0-9]{2}$'),
  medio text not null default 'TRANSFERENCIA',
  observaciones text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create table if not exists public.cierres_mensuales (
  id uuid primary key default gen_random_uuid(),
  mes text not null check (mes ~ '^[0-9]{4}-[0-9]{2}$'),
  total_equipo_actualizado numeric not null check (total_equipo_actualizado >= 0),
  total_abono_actualizado numeric not null check (total_abono_actualizado >= 0),
  usuarios_activos integer not null check (usuarios_activos >= 0),
  estado text not null check (estado in ('ABIERTO','CERRADO','ANULADO')),
  created_at timestamptz not null default now(),
  cerrado_por uuid references auth.users(id)
);

create table if not exists public.cargos_mensuales (
  id uuid primary key default gen_random_uuid(),
  cierre_mensual_id uuid not null references public.cierres_mensuales(id) on delete cascade,
  persona_id uuid not null references public.personas(id) on delete restrict,
  mes text not null check (mes ~ '^[0-9]{4}-[0-9]{2}$'),
  monto_a_pagar numeric not null check (monto_a_pagar >= 0),
  concepto text not null,
  saldo_equipo_antes numeric,
  saldo_equipo_despues numeric,
  pagado boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  usuario uuid references auth.users(id),
  accion text not null,
  tabla text not null,
  registro_id uuid,
  detalle jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_profiles_rol on public.profiles (rol);
create index if not exists idx_personas_estado on public.personas (estado);
create index if not exists idx_personas_fundador on public.personas (es_fundador);
create index if not exists idx_pagos_persona on public.pagos (persona_id);
create index if not exists idx_pagos_mes on public.pagos (mes_aplicado);
create index if not exists idx_pagos_concepto on public.pagos (concepto);
create unique index if not exists uq_cierres_mes_vigente
on public.cierres_mensuales (mes)
where estado in ('ABIERTO', 'CERRADO');
create index if not exists idx_cargos_mes on public.cargos_mensuales (mes);
create index if not exists idx_cargos_persona on public.cargos_mensuales (persona_id);
create index if not exists idx_audit_usuario on public.audit_log (usuario);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_app_config_updated_at on public.app_config;
create trigger trg_app_config_updated_at
before update on public.app_config
for each row execute function public.set_updated_at();

drop trigger if exists trg_personas_updated_at on public.personas;
create trigger trg_personas_updated_at
before update on public.personas
for each row execute function public.set_updated_at();

create or replace function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_registro_id uuid;
  v_detalle jsonb;
begin
  if tg_op = 'DELETE' then
    v_registro_id = old.id;
    v_detalle = to_jsonb(old);
  else
    v_registro_id = new.id;
    v_detalle = to_jsonb(new);
  end if;

  insert into public.audit_log (usuario, accion, tabla, registro_id, detalle)
  values (auth.uid(), tg_op, tg_table_name, v_registro_id, v_detalle);

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_audit_app_config on public.app_config;
create trigger trg_audit_app_config
after insert or update or delete on public.app_config
for each row execute function public.write_audit_log();

drop trigger if exists trg_audit_personas on public.personas;
create trigger trg_audit_personas
after insert or update or delete on public.personas
for each row execute function public.write_audit_log();

drop trigger if exists trg_audit_pagos on public.pagos;
create trigger trg_audit_pagos
after insert or update or delete on public.pagos
for each row execute function public.write_audit_log();

drop trigger if exists trg_audit_cierres on public.cierres_mensuales;
create trigger trg_audit_cierres
after insert or update or delete on public.cierres_mensuales
for each row execute function public.write_audit_log();

drop trigger if exists trg_audit_cargos on public.cargos_mensuales;
create trigger trg_audit_cargos
after insert or update or delete on public.cargos_mensuales
for each row execute function public.write_audit_log();
