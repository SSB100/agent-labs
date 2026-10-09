import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './helpers/r10-sql-fixture.mjs';
import {ownerInitialSqlFixture,sha} from './helpers/r12-owner-initial-sql-fixture.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url),ts=require('typescript');
const core=name=>require('../.core-tests/'+name+'.js');
const host=process.env.R12_SQL_TEST_HOST??process.env.R11_SQL_TEST_HOST;
function source(file,dependencies){
 const fixtureModule={exports:{}},code=ts.transpileModule(readFileSync(path.join(root,file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 new Function('require','module','exports',code)(name=>{assert.ok(Object.hasOwn(dependencies,name),'Unexpected dependency '+name);return dependencies[name];},fixtureModule,fixtureModule.exports);
 return fixtureModule.exports;
}

// Every profile, enrollment and packet below is isolated engineering data. The
// application read boundary is real; no provider transport or live data is used.
test('actual SQL catalog with twenty packets and multiple profiles survives bounded per-record screening', {skip:!host,timeout:120000}, async()=>{
 const sqlRequire=createRequire(path.resolve(host,'package.json')),{PGlite}=sqlRequire('@electric-sql/pglite'),{pgcrypto}=sqlRequire('@electric-sql/pglite/contrib/pgcrypto');
 const db=new PGlite({extensions:{pgcrypto}});
 try{
  await db.exec(r04SqlBootstrap+sessionBootstrap);
  for(const file of readdirSync(root+'/supabase/migrations').filter(x=>x.endsWith('.sql')).sort())await db.exec(readFileSync(root+'/supabase/migrations/'+file,'utf8'));
  const f=await ownerInitialSqlFixture(db),{discoveryV2Hash:hash}=core('products/discovery-v2');
  for(let i=1;i<=2;i++){
   const profile={...structuredClone(f.profile),id:randomUUID(),title:'Synthetic additional public profile '+i};
   await db.query('insert into private.r12_owner_profiles values($1,$2,$3,$4,$5,clock_timestamp())',[profile.id,profile,hash(profile),f.pins,hash(f.pins)]);
   await db.query(`insert into private.r12_owner_bootstrap_grants(id,root_id,business_id,owner_id,profile_id,server_key_hash,approval_hash,valid_from,valid_until,business_revision,business_hash)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[randomUUID(),f.rootId,f.businessId,f.ownerId,profile.id,sha('inert-additional-catalog-'+profile.id),'6'.repeat(64),profile.validFrom,profile.validUntil,f.businessRevision,f.businessHash]);
  }
  const receipts=[];
  for(let i=0;i<20;i++)receipts.push(await f.prepare({submissionId:randomUUID()}));
  const data=await f.read();
  assert.equal(data.setups.length,20);assert.equal(data.profiles.length,3);assert.equal(data.setupsTruncated,false);
  assert.equal(core('core/quest-intake').containsCredentialLikeValue(data),true,'The old aggregate scanner rejects this legitimate bounded catalog');
  assert.ok(JSON.stringify(data).length<1_048_576);
  const denied=()=>{throw Error('No quote, authority or provider effect in read regression');};
  const server=source('src/products/discovery-r12-goal-preparation-server.ts',{
   'server-only':{},'node:crypto':require('node:crypto'),'../lib/core-ui/owner-business':source('src/lib/core-ui/owner-business.ts',{}),
   '../core/request-deadline':core('core/request-deadline'),'../core/quest-intake':core('core/quest-intake'),'./discovery-v2':core('products/discovery-v2'),
   './discovery-r12-server-dependencies':{discoveryR12ServerDependencies:denied},'./discovery-r12-server':{prepareDiscoveryR12Authority:denied},
   './discovery-r12-goal-scope':core('products/discovery-r12-goal-scope'),'./discovery-r12-goal-preparation-contract':core('products/discovery-r12-goal-preparation-contract'),
  });
  let mutate=null;
  const context={userId:f.ownerId,businesses:[{id:f.businessId,name:'Synthetic catalog Business'}],supabase:{
   auth:{getClaims:async()=>({data:{claims:{sub:f.ownerId}},error:null})},
   rpc:async(name,args)=>{assert.equal(name,'r12_owner_research_read');assert.equal(args.p_business_id,f.businessId);const value=await f.read(args.p_goal_id,args.p_setup_id);mutate?.(value);return{data:value,error:null};},
  }};
  const loaded=await server.readOwnerResearchCatalog(context,f.businessId,f.goalId,null);
  assert.equal(loaded.available,true);assert.equal(loaded.catalog.setups.length,20);assert.equal(loaded.catalog.profiles.length,3);
  assert.deepEqual(loaded.catalog.setups,data.setups);
  const oldest=receipts[0],exact=await server.readOwnerResearchCatalog(context,f.businessId,f.goalId,oldest.setupId);
  assert.equal(exact.available,true);assert.equal(exact.catalog.setups.length,1);assert.equal(exact.catalog.setups[0].setupId,oldest.setupId);
  // Corrupt only the inert read transport, never persist credential-shaped data.
  // These are placeholders, not authentication material.
  for(const [label,change] of [
   ['Business',value=>{value.business.note='password: inert-not-a-real-credential';}],
   ['Goal',value=>{value.goal.content.objective='password: inert-not-a-real-credential';}],
   ['profile',value=>{value.profiles[1].profile.title='password: inert-not-a-real-credential';}],
   ['funding',value=>{value.funding.note='password: inert-not-a-real-credential';}],
   ['saved packet',value=>{value.setups[13].preview.objective='password: inert-not-a-real-credential';}],
  ]){
   mutate=change;
   assert.deepEqual(await server.readOwnerResearchCatalog(context,f.businessId,f.goalId,null),{available:false,catalog:null},label+' is screened independently');
  }
  mutate=null;
  assert.equal((await server.readOwnerResearchCatalog(context,f.businessId,f.goalId,null)).available,true,'Rejected transport corruption does not change saved catalog');
  const counts=(await db.query('select (select count(*)::int from private.r12_owner_activations) activations,(select count(*)::int from private.r05_requests) requests,(select count(*)::int from private.r07_plans) plans')).rows[0];
  assert.deepEqual(counts,{activations:0,requests:0,plans:0});
 }finally{await db.close();}
});
