create schema if not exists private;
revoke all on schema private from public;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length check (
    display_name is null
    or char_length(btrim(display_name)) between 1 and 120
  )
);

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint businesses_name_length check (
    char_length(btrim(name)) between 1 and 120
  )
);

create table public.business_members (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  created_at timestamptz not null default now(),
  primary key (business_id, user_id),
  constraint business_members_role check (role in ('owner', 'member'))
);

create index businesses_owner_user_id_idx
  on public.businesses (owner_user_id);

create index business_members_user_id_idx
  on public.business_members (user_id);

create unique index business_members_one_owner_idx
  on public.business_members (business_id)
  where role = 'owner';

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create trigger businesses_set_updated_at
before update on public.businesses
for each row execute function private.set_updated_at();

create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    nullif(
      btrim(
        coalesce(
          new.raw_user_meta_data ->> 'display_name',
          new.raw_user_meta_data ->> 'full_name',
          ''
        )
      ),
      ''
    )
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create function private.handle_new_business()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.business_members (business_id, user_id, role)
  values (new.id, new.owner_user_id, 'owner');

  return new;
end;
$$;

revoke all on function private.handle_new_business() from public, anon, authenticated;

create trigger on_business_created
  after insert on public.businesses
  for each row execute function private.handle_new_business();

alter table public.profiles enable row level security;
alter table public.businesses enable row level security;
alter table public.business_members enable row level security;

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.businesses from anon, authenticated;
revoke all on table public.business_members from anon, authenticated;

grant select, insert, update on table public.profiles to authenticated;
grant select, insert, update, delete on table public.businesses to authenticated;
grant select on table public.business_members to authenticated;

create policy profiles_select_own
on public.profiles
for select
to authenticated
using (
  (select auth.uid()) is not null
  and id = (select auth.uid())
);

create policy profiles_insert_own
on public.profiles
for insert
to authenticated
with check (
  (select auth.uid()) is not null
  and id = (select auth.uid())
);

create policy profiles_update_own
on public.profiles
for update
to authenticated
using (
  (select auth.uid()) is not null
  and id = (select auth.uid())
)
with check (
  (select auth.uid()) is not null
  and id = (select auth.uid())
);

create policy businesses_select_owned
on public.businesses
for select
to authenticated
using (
  (select auth.uid()) is not null
  and owner_user_id = (select auth.uid())
);

create policy businesses_insert_owned
on public.businesses
for insert
to authenticated
with check (
  (select auth.uid()) is not null
  and owner_user_id = (select auth.uid())
);

create policy businesses_update_owned
on public.businesses
for update
to authenticated
using (
  (select auth.uid()) is not null
  and owner_user_id = (select auth.uid())
)
with check (
  (select auth.uid()) is not null
  and owner_user_id = (select auth.uid())
);

create policy businesses_delete_owned
on public.businesses
for delete
to authenticated
using (
  (select auth.uid()) is not null
  and owner_user_id = (select auth.uid())
);

create policy business_members_select_own
on public.business_members
for select
to authenticated
using (
  (select auth.uid()) is not null
  and user_id = (select auth.uid())
);

comment on table public.profiles is
  'Owner profile records linked one-to-one with Supabase Auth users.';
comment on table public.businesses is
  'Durable owner-scoped business containers for Agent Labs workflows and packs.';
comment on table public.business_members is
  'Membership records for businesses. Stage 1 creates owner membership automatically.';
