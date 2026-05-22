alter table public.canciones
add column if not exists cover_url text;

alter table public.canciones
add column if not exists intentos_busqueda integer not null default 0;

drop function if exists public.actualizar_portada(uuid, text);
drop function if exists public.actualizar_portada(text, text);
drop function if exists public.actualizar_portada(bigint, text);
drop function if exists public.actualizar_portada(bigint, text, text, text);

create or replace function public.actualizar_portada(cancion_id bigint, nueva_url text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  filas integer;
  url text := nullif(trim(nueva_url), '');
begin
  if url is not null and url like 'http%' then
    update public.canciones
    set cover_url = url,
        intentos_busqueda = 0
    where id = cancion_id;
  elsif url = 'not_found' then
    update public.canciones
    set cover_url = 'not_found'
    where id = cancion_id;
  else
    update public.canciones
    set intentos_busqueda = least(intentos_busqueda + 1, 10)
    where id = cancion_id;
  end if;

  get diagnostics filas = row_count;
  return filas;
end;
$$;

grant execute on function public.actualizar_portada(bigint, text) to anon, authenticated;
