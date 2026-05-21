alter table public.canciones
add column if not exists cover_url text;

drop function if exists public.actualizar_portada(uuid, text);
drop function if exists public.actualizar_portada(text, text);
drop function if exists public.actualizar_portada(bigint, text);

create or replace function public.actualizar_portada(
  cancion_id bigint,
  nueva_url text,
  p_id_dj text default null,
  p_numero text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  filas integer;
begin
  update public.canciones
  set cover_url = nueva_url
  where id = cancion_id
    and (p_id_dj is null or id_dj = p_id_dj);

  get diagnostics filas = row_count;

  if filas = 0 and p_id_dj is not null and p_numero is not null then
    update public.canciones
    set cover_url = nueva_url
    where id_dj = p_id_dj
      and numero::text = p_numero;
    get diagnostics filas = row_count;
  end if;

  return filas;
end;
$$;

grant execute on function public.actualizar_portada(bigint, text, text, text) to anon, authenticated;
