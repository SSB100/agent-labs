/** Reset only the named disposable GitHub Actions PostgreSQL service fixture. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function validateR12CiResetTarget(env){
 assert.equal(env.CI,'true','Only the isolated CI fixture may be reset');
 assert.equal(env.GITHUB_ACTIONS,'true','Only the GitHub Actions service fixture may be reset');
 assert.equal(env.R12_REQUIRE_POSTGRES,'1','Native PostgreSQL fixture required');
 const url=new URL(env.R12_POSTGRES_URL);
 assert.ok(url.protocol==='postgresql:'&&url.hostname==='127.0.0.1'&&url.port==='5432'
  &&url.username==='r12_test'&&url.password==='r12-isolated-fixture'&&url.pathname==='/r12_test'
  &&!url.search&&!url.hash,'Only the exact inert r12_test CI service may be reset');
 assert.ok(!env.PGOPTIONS&&!env.PGSERVICE&&!env.PGSERVICEFILE,'No inherited database options are allowed');
 assert.ok(/^\d{1,3}(?:\.\d{1,3}){3}$/.test(env.R12_CI_POSTGRES_ADDRESS??'')
  &&env.R12_CI_POSTGRES_ADDRESS.split('.').every(part=>Number(part)<=255),'An inspected PostgreSQL service IPv4 address is required');
 return url;
}

export function validateR12CiApiRoles(rows){
 assert.deepEqual(rows,['anon','authenticated','service_role'].map(name=>({
  name,superuser:false,inherit:true,create_role:false,create_db:false,login:false,
  replication:false,bypass_rls:name==='service_role',connection_limit:-1,
  valid_until:null,settings:null,has_password:false,
 })),'Unexpected attributes on the three synthetic API roles');
}

export async function resetR12CiDatabase(env=process.env){
 const url=validateR12CiResetTarget(env),maintenance=new URL(url);
 maintenance.pathname='/postgres';
 assert.ok(env.R12_SQL_TEST_HOST,'Pinned isolated SQL runtime required');
 const {Client}=createRequire(path.resolve(env.R12_SQL_TEST_HOST,'package.json'))('pg');
 const db=new Client({connectionString:maintenance.toString()});
 await db.connect();
 try{
  const identity=(await db.query("select current_user role,current_database() db,host(inet_server_addr()) host,inet_server_port() port")).rows[0];
  assert.deepEqual(identity,{role:'r12_test',db:'postgres',host:env.R12_CI_POSTGRES_ADDRESS,port:5432},'Unexpected PostgreSQL service identity');
  const fixture=(await db.query("select pg_get_userbyid(datdba) owner,datistemplate template from pg_database where datname='r12_test'")).rows[0];
  assert.deepEqual(fixture,{owner:'r12_test',template:false},'Unexpected fixture ownership');
  // The shared bootstrap creates these roles at cluster scope. Reject altered
  // privileges, memberships, settings or unrelated dependencies before any reset.
  validateR12CiApiRoles((await db.query(`select rolname name,rolsuper superuser,
   rolinherit inherit,rolcreaterole create_role,rolcreatedb create_db,rolcanlogin login,
   rolreplication replication,rolbypassrls bypass_rls,rolconnlimit connection_limit,
   rolvaliduntil valid_until,(select setconfig from pg_db_role_setting
    where setdatabase=0 and setrole=pg_authid.oid) settings,rolpassword is not null has_password
   from pg_authid where rolname in ('anon','authenticated','service_role') order by rolname`)).rows);
  const unexpected=(await db.query(`with api as (
   select oid from pg_roles where rolname in ('anon','authenticated','service_role')
  ) select
   (select count(*)::int from pg_auth_members where roleid in(select oid from api)
    or member in(select oid from api) or grantor in(select oid from api)) memberships,
   (select count(*)::int from pg_db_role_setting where setrole in(select oid from api)) settings,
   (select count(*)::int from pg_shdepend where refclassid='pg_authid'::regclass
    and refobjid in(select oid from api)
    and dbid<>(select oid from pg_database where datname='r12_test')) outside_dependencies`)).rows[0];
  assert.deepEqual(unexpected,{memberships:0,settings:0,outside_dependencies:0},'Synthetic API roles have unexpected cluster-wide state');
  // No FORCE and no session termination: an unexpected active connection fails.
  await db.query('drop database r12_test');
  // Only the exact validated bootstrap roles; no IF EXISTS, CASCADE, DROP OWNED
  // or deletion of unrelated cluster roles, settings or tablespaces.
  await db.query('drop role anon,authenticated,service_role');
  await db.query('create database r12_test owner r12_test');
 }finally{await db.end();}
 const check=new Client({connectionString:url.toString()});await check.connect();
 try{
  const {count}=(await check.query("select count(*)::int count from pg_tables where schemaname in ('public','private')")).rows[0];
  assert.equal(count,0,'Fresh synthetic database required');
  assert.equal((await check.query("select count(*)::int count from pg_roles where rolname in ('anon','authenticated','service_role')")).rows[0].count,0,'Bootstrap roles must be recreated by the next suite');
  assert.deepEqual((await check.query('select extname from pg_extension order by extname')).rows,[{extname:'plpgsql'}],'Bootstrap extensions must not survive database reset');
  assert.equal((await check.query('select count(*)::int count from pg_publication')).rows[0].count,0,'Bootstrap publication must not survive database reset');
 }finally{await check.end();}
 console.log('Reset the isolated r12_test CI service database for the full-shape regression.');
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await resetR12CiDatabase();
