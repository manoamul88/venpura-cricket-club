create table if not exists public.venpura_state (
  id text primary key check (id = 'venpura'),
  state jsonb not null,
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);

alter table public.venpura_state enable row level security;

revoke all on table public.venpura_state from anon, authenticated;
grant select, insert, update on table public.venpura_state to service_role;

create or replace function public.venpura_save_state(
  p_state jsonb,
  p_expected_revision integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_revision integer;
begin
  if p_expected_revision = 0 then
    insert into public.venpura_state (id, state, revision, updated_at)
    values ('venpura', p_state, 1, now())
    on conflict (id) do nothing
    returning revision into saved_revision;

    if found then
      return saved_revision;
    end if;
  end if;

  update public.venpura_state
  set state = p_state,
      revision = revision + 1,
      updated_at = now()
  where id = 'venpura'
    and revision = p_expected_revision
  returning revision into saved_revision;

  if not found then
    raise exception 'VENPURA_STATE_CONFLICT';
  end if;

  return saved_revision;
end;
$$;

revoke all on function public.venpura_save_state(jsonb, integer) from public, anon, authenticated;
grant execute on function public.venpura_save_state(jsonb, integer) to service_role;

-- Keep match media private; the app serves files only after checking a member session.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'venpura-match-media',
  'venpura-match-media',
  false,
  50000000,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'video/mp4', 'video/webm', 'video/quicktime']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
