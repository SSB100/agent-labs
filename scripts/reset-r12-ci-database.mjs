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
  // No FORCE and no session termination: an unexpected active connection fails.
  await db.query('drop database r12_test');
  await db.query('create database r12_test owner r12_test');
 }finally{await db.end();}
 const check=new Client({connectionString:url.toString()});await check.connect();
 try{
  const {count}=(await check.query("select count(*)::int count from pg_tables where schemaname in ('public','private')")).rows[0];
  assert.equal(count,0,'Fresh synthetic database required');
 }finally{await check.end();}
 console.log('Reset the isolated r12_test CI service database for the full-shape regression.');
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await resetR12CiDatabase();
