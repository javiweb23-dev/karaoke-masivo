create type public.estado_codigo as enum ('disponible', 'usado');

create table public.codigos_activacion (
    id_codigo text primary key,
    fecha_generacion timestamptz not null default now(),
    estado public.estado_codigo not null default 'disponible',
    order_id_paypal text null,
    registered_id_dj text null
);

create index codigos_activacion_estado_idx on public.codigos_activacion (estado, fecha_generacion);

alter table public.codigos_activacion enable row level security;

create policy codigos_activacion_deny_all on public.codigos_activacion
    for all using (false) with check (false);

create or replace function public.claim_activation_code(p_paypal_sub_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id text;
begin
    select c.id_codigo into v_id
    from public.codigos_activacion c
    where c.estado = 'disponible'::public.estado_codigo
    order by c.fecha_generacion asc, c.id_codigo asc
    limit 1
    for update skip locked;
    if v_id is null then
        return null;
    end if;
    update public.codigos_activacion
    set estado = 'usado'::public.estado_codigo,
        order_id_paypal = p_paypal_sub_id
    where id_codigo = v_id;
    return v_id;
end;
$$;

create or replace function public.activation_token_state(p_token text)
returns text
language plpgsql
security definer
set search_path = public
stable
as $$
declare
    r public.codigos_activacion%rowtype;
begin
    if p_token is null or btrim(p_token) = '' then
        return 'missing';
    end if;
    select * into r from public.codigos_activacion where id_codigo = p_token limit 1;
    if not found then
        return 'missing';
    end if;
    if r.estado = 'disponible'::public.estado_codigo then
        return 'avail';
    end if;
    if r.registered_id_dj is not null and btrim(r.registered_id_dj) <> '' then
        return 'closed';
    end if;
    return 'paid_open';
end;
$$;

create or replace function public.register_dj_with_activation(
    p_token text,
    p_id_dj text,
    p_nombre_negocio text,
    p_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    r public.codigos_activacion%rowtype;
begin
    if p_token is null or btrim(p_token) = '' then
        return jsonb_build_object('ok', false, 'error', 'token_invalid');
    end if;
    select * into r from public.codigos_activacion where id_codigo = p_token for update;
    if not found then
        return jsonb_build_object('ok', false, 'error', 'token_invalid');
    end if;
    if r.estado <> 'usado'::public.estado_codigo then
        return jsonb_build_object('ok', false, 'error', 'token_invalid');
    end if;
    if r.registered_id_dj is not null and btrim(r.registered_id_dj) <> '' then
        return jsonb_build_object('ok', false, 'error', 'token_invalid');
    end if;
    insert into public.usuarios_dj (id_dj, nombre_negocio, pin_acceso, logo_url, color_principal)
    values (p_id_dj, p_nombre_negocio, p_pin, null, null);
    update public.codigos_activacion
    set registered_id_dj = p_id_dj
    where id_codigo = p_token;
    return jsonb_build_object('ok', true);
exception
    when unique_violation then
        return jsonb_build_object('ok', false, 'error', 'duplicate_dj');
end;
$$;

revoke all on function public.claim_activation_code(text) from public;
grant execute on function public.claim_activation_code(text) to anon, authenticated, service_role;

revoke all on function public.activation_token_state(text) from public;
grant execute on function public.activation_token_state(text) to anon, authenticated, service_role;

revoke all on function public.register_dj_with_activation(text, text, text, text) from public;
grant execute on function public.register_dj_with_activation(text, text, text, text) to anon, authenticated, service_role;

revoke all on table public.codigos_activacion from anon, authenticated;
grant all on table public.codigos_activacion to service_role;
