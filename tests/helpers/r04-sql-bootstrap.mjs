/** Minimal inert Supabase database shape, used only in isolated database tests. */
export const r04SqlBootstrap = `create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema extensions; create extension pgcrypto with schema extensions;
grant usage on schema extensions to anon,authenticated,service_role;
create function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',aud text,role text,encrypted_password text,email_confirmed_at timestamptz,raw_app_meta_data jsonb,created_at timestamptz,updated_at timestamptz);
grant usage on schema auth to authenticated,anon,service_role; grant execute on function auth.uid() to authenticated,anon,service_role;
create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb default '{}',owner uuid,unique(bucket_id,name));
alter table storage.objects enable row level security;
grant usage on schema storage to anon,authenticated; grant select,insert,update,delete on storage.objects to anon,authenticated;
create publication supabase_realtime;`;
