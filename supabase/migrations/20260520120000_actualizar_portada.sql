drop function if exists public.actualizar_portada(uuid, text);
drop function if exists public.actualizar_portada(text, text);

create or replace function public.actualizar_portada(cancion_id bigint, nueva_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.canciones
  set cover_url = nueva_url
  where id = cancion_id;
end;
$$;

grant execute on function public.actualizar_portada(bigint, text) to anon, authenticated;
