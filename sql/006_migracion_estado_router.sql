alter table public.personas
add column if not exists router_estado text not null default 'BLOQUEADO';

alter table public.personas
drop constraint if exists personas_router_estado_check;

alter table public.personas
add constraint personas_router_estado_check
check (router_estado in ('HABILITADO', 'BLOQUEADO'));
