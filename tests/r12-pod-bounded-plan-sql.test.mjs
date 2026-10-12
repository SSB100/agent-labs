import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './helpers/r10-sql-fixture.mjs';

const host=process.env.R12_SQL_TEST_HOST,file='20261012110903_r12_pod_bounded_query_plan.sql';
test('Bounded-proof plan migration preserves exact predicate and all authority, fails closed on drift, and rolls back cleanly',{skip:!host,timeout:60000},async()=>{
 const require=createRequire(path.resolve(host,'package.json')),{PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
 const db=new PGlite({extensions:{pgcrypto}}),sql=readFileSync('supabase/migrations/'+file,'utf8');
 const snapshot=async()=>{const r=(await db.query("select to_jsonb(p) attributes,l.lanname,pg_get_functiondef(p.oid) definition from pg_proc p join pg_language l on l.oid=p.prolang where p.oid='private.r12_pod_bounded_source(uuid,text,bigint)'::regprocedure")).rows[0];return r;};
 try{
  await db.exec(r04SqlBootstrap+sessionBootstrap);
  for(const f of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')&&f<file).sort())await db.exec(readFileSync('supabase/migrations/'+f,'utf8'));
  const before=await snapshot();assert.equal(before.lanname,'sql');
  await db.exec('begin');await db.exec(sql);assert.equal((await snapshot()).lanname,'plpgsql');await db.exec('rollback');assert.deepEqual(await snapshot(),before);
  for(const mutation of [before.definition.replace(before.attributes.prosrc,()=>before.attributes.prosrc+'\n-- inert predicate drift\n'),before.definition.replace('LANGUAGE sql','LANGUAGE sql SECURITY DEFINER')]){
   await db.exec('begin');await db.exec(mutation);await assert.rejects(db.exec(sql),/r12_pod_bounded_plan_precondition_changed/);await db.exec('rollback');assert.deepEqual(await snapshot(),before);
  }
  await db.exec(sql);const after=await snapshot();assert.equal(after.lanname,'plpgsql');
  assert.equal(after.attributes.prosrc,'BEGIN RETURN ('+before.attributes.prosrc.replace(/^ +| +$/g,'')+'); END');
  assert.deepEqual(after.attributes.proconfig,['search_path=""','plan_cache_mode=force_generic_plan']);
  const normalize=x=>Object.fromEntries(Object.entries(x).filter(([key])=>!['prolang','prosrc','proconfig'].includes(key)));
  assert.deepEqual(normalize(after.attributes),normalize(before.attributes),'Only language, wrapper and local plan setting change; OID/owner/ACL/security/signature remain exact');
  const permission=(await db.query("select has_function_privilege('anon','private.r12_pod_bounded_source(uuid,text,bigint)','EXECUTE') anon,has_function_privilege('authenticated','private.r12_pod_bounded_source(uuid,text,bigint)','EXECUTE') authenticated,has_function_privilege('service_role','private.r12_pod_bounded_source(uuid,text,bigint)','EXECUTE') service_role")).rows[0];
  assert.deepEqual(permission,{anon:false,authenticated:false,service_role:false});
  assert.equal((await db.query('select private.r12_pod_bounded_source(null,null,null) result')).rows[0].result,false,'Preserve non-STRICT false-on-null semantics');
  await db.exec('begin');await assert.rejects(db.exec(sql),/r12_pod_bounded_plan_precondition_changed/);await db.exec('rollback');assert.deepEqual(await snapshot(),after,'A repeated install cannot silently drift the implementation');
 }finally{await db.close();}
});
