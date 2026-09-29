begin;

insert into auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '11111111-1111-4111-8111-111111111111',
    'authenticated',
    'authenticated',
    'stage1-user-a@example.invalid',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"Stage One A"}'::jsonb,
    now(),
    now()
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'authenticated',
    'authenticated',
    'stage1-user-b@example.invalid',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"Stage One B"}'::jsonb,
    now(),
    now()
  );

do $$
declare
  profile_count integer;
begin
  select count(*) into profile_count
  from public.profiles
  where id in (
    '11111111-1111-4111-8111-111111111111'::uuid,
    '22222222-2222-4222-8222-222222222222'::uuid
  );

  if profile_count <> 2 then
    raise exception 'profile trigger verification failed';
  end if;
end;
$$;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);

insert into public.businesses (id, owner_user_id, name)
values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '11111111-1111-4111-8111-111111111111',
  'Stage One RLS Fixture'
);

do $$
declare
  business_count integer;
  membership_count integer;
begin
  select count(*) into business_count from public.businesses;
  select count(*) into membership_count from public.business_members;

  if business_count <> 1 or membership_count <> 1 then
    raise exception 'owner read or membership trigger verification failed';
  end if;
end;
$$;

do $$
begin
  begin
    insert into public.businesses (id, owner_user_id, name)
    values (
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      '22222222-2222-4222-8222-222222222222',
      'Forbidden Cross Owner Business'
    );

    raise exception 'cross-owner insert unexpectedly succeeded';
  exception
    when insufficient_privilege then
      null;
  end;
end;
$$;

select set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',
  true
);

do $$
declare
  business_count integer;
  membership_count integer;
  changed_rows integer;
begin
  select count(*) into business_count from public.businesses;
  select count(*) into membership_count from public.business_members;

  update public.businesses
  set name = 'Unauthorized Change'
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  get diagnostics changed_rows = row_count;

  if business_count <> 0 or membership_count <> 0 or changed_rows <> 0 then
    raise exception 'cross-owner isolation verification failed';
  end if;
end;
$$;

rollback;
