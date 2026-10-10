/** Genuine mixed-lane allocation. Every credential, review and provider is inert. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './helpers/r10-sql-fixture.mjs';
import {validateOwnerInitialRaceEnvironment} from './helpers/r12-owner-initial-postgres-races.mjs';
import {prepareDirectTestAuthorityFixture} from './helpers/r12-direct-test-authority-fixture.mjs';
import {qualifyInertOwnerRenderer} from './helpers/r12-direct-setup-renewal-fixture.mjs';
import {one,sha} from './helpers/r12-owner-initial-sql-fixture.mjs';
import {r12QuoteFixture} from './helpers/r12-provider-fixture.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const migration='20261010120755_r12_direct_grant_total_compatibility.sql';
const host=process.env.R12_SQL_TEST_HOST;
const metadata=`select p.oid::text id,p.proowner::text owner,p.proacl::text acl,p.proconfig config,
 p.prosecdef security_definer,p.provolatile volatility,p.proisstrict strict,
 pg_get_function_arguments(p.oid) arguments,pg_get_function_result(p.oid) result
 from pg_proc p where p.oid='private.r12_direct_grant_total_guard()'::regprocedure`;

test('20755 preserves reviewed initial grant selection and charges genuine direct allocation to every cumulative limit',
 {skip:!host&&!process.env.R12_REQUIRE_POSTGRES&&!process.env.R12_POSTGRES_URL,timeout:150000},async t=>{
 assert.ok(host,'R12_SQL_TEST_HOST required');const req=createRequire(path.resolve(host,'package.json'));let db;
 if(process.env.R12_REQUIRE_POSTGRES||process.env.R12_POSTGRES_URL){
  const target=validateOwnerInitialRaceEnvironment(process.env),{Client}=req('pg');
  db=new Client({connectionString:target.url});await db.connect();db.exec=sql=>db.query(sql);db.close=()=>db.end();
  assert.deepEqual(await one(db,'select current_user actor,current_database() db,host(inet_server_addr()) address'),{actor:'r12_test',db:'r12_test',address:target.address});
  assert.equal((await one(db,"select count(*)::int n from pg_tables where schemaname in ('public','private')")).n,0);
 }else{const {PGlite}=req('@electric-sql/pglite'),{pgcrypto}=req('@electric-sql/pglite/contrib/pgcrypto');db=new PGlite({extensions:{pgcrypto}});}
 const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('External transport forbidden');};
 try{
  await db.exec(r04SqlBootstrap+sessionBootstrap);
  for(const file of readdirSync(path.join(root,'supabase/migrations')).filter(x=>x.endsWith('.sql')&&x<migration).sort())await db.exec(readFileSync(path.join(root,'supabase/migrations',file),'utf8'));
  const priorMetadata=await one(db,metadata);
  const priorUsage=(await one(db,"select pg_get_functiondef('private.r12_direct_grant_usage(uuid)'::regprocedure) definition")).definition;
  const x=await prepareDirectTestAuthorityFixture(db,{configureReview:v=>qualifyInertOwnerRenderer(db,v)});
  const f=x.f;await x.confirm();
  const usage=async()=>(await one(db,'select private.r12_direct_grant_usage($1) value',[f.rootId])).value;
  const initial=Number((await one(db,'select allocation_microunits amount from private.r12_owner_activations where grant_root_id=$1',[f.rootId])).amount);
  const before=await usage();assert.deepEqual(before,{scopes:2,allocationMicrounits:String(10000000+initial)});
  const originalRoot=await one(db,'select to_jsonb(r) value from private.r12_owner_grant_roots r where id=$1',[f.rootId]);
  assert.equal(originalRoot.value.maximum_scopes,2);
  const objective='Investigate original gardening T-shirt evidence after a separately bounded astronomy test.';
  const content={...structuredClone(f.content),originalIntent:objective,objective};
  const goal=await f.rpc('r04_quest_transition',[f.businessId,'quest.save',{goalId:null,expectedRevision:0,content},randomUUID()]);
  await f.rpc('r04_quest_transition',[f.businessId,'quest.preference',{goalId:goal.id,expectedRevision:1,preference:'ready'},randomUUID()]);
  const enroll=async(maximumScopes,maximumAllocation)=>{
   const grantId=randomUUID(),key='inert-reviewed-cumulative-capability-'+grantId;
   await db.query(`insert into private.r12_owner_bootstrap_grants
    (id,root_id,business_id,owner_id,profile_id,maximum_scopes,maximum_allocation_microunits,server_key_hash,approval_hash,valid_from,valid_until,business_revision,business_hash)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [grantId,f.rootId,f.businessId,f.ownerId,f.profileId,maximumScopes,maximumAllocation,sha(key),sha('inert-explicit-review-'+grantId),f.profile.validFrom,f.profile.validUntil,f.businessRevision,f.businessHash]);
   const prepared=await f.server('prepare',{input:{...f.input,goalId:goal.id,grantId,topicKey:'gardening',businessLifetimeLimitMicrounits:'12000000',researchLifetimeLimitMicrounits:'12000000',submissionId:randomUUID()},quote:r12QuoteFixture()},key);
   return {prepared,key,confirm:()=>f.server('confirm',f.confirmPayload(prepared),key)};
  };
  const expanded=await enroll(3,12000000);
  await assert.rejects(expanded.confirm(),/r12_direct_cumulative_grant_exhausted/,'Reproduce the published intersection regression');
  assert.deepEqual(await usage(),before);
  await db.exec(readFileSync(path.join(root,'supabase/migrations',migration),'utf8'));
  assert.deepEqual(await one(db,metadata),priorMetadata,'Replace body without changing trigger OID, owner, ACL or configuration');
  assert.equal((await one(db,"select pg_get_functiondef('private.r12_direct_grant_usage(uuid)'::regprocedure) definition")).definition,priorUsage);
  const snapshot=async()=>{
   const result={};for(const table of ['r12_owner_activations','r12_owner_episode_activations','r12_adaptive_activations','r12_direct_test_confirmations','r12_direct_test_envelopes','r12_direct_origin_freezes','r12_discovery_authorities','r12_discovery_scopes','r05_confirmations','r05_cap_versions','r05_requests','r07_attempts']){
    // Some cumulative rows use only a root/foreign key; the isolated database
    // contains this one Business, so preserving all rows is stronger here.
    result[table]=(await one(db,`select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) value from private.${table} r`)).value;
   }return result;
  };
  const scopeLimited=await enroll(2,12000000),scopeBefore=await snapshot();
  await assert.rejects(scopeLimited.confirm(),/r12_direct_cumulative_grant_exhausted/);
  assert.deepEqual(await snapshot(),scopeBefore,'Direct scope allocation cannot be omitted by the older initial endpoint');
  const amountLimited=await enroll(3,initial*2),amountBefore=await snapshot();
  await assert.rejects(amountLimited.confirm(),/r12_direct_cumulative_grant_exhausted/);
  assert.deepEqual(await snapshot(),amountBefore,'Direct cash allocation cannot be omitted by the older initial endpoint');
  const active=await expanded.confirm();assert.equal(active.activated,true);
  assert.deepEqual(await usage(),{scopes:3,allocationMicrounits:String(10000000+initial*2)});
  assert.deepEqual(await one(db,'select to_jsonb(r) value from private.r12_owner_grant_roots r where id=$1',[f.rootId]),originalRoot);
  const after=await snapshot();assert.equal((await expanded.confirm()).scopeId,active.scopeId);assert.deepEqual(await snapshot(),after,'Exact replay consumes no second allocation');
  await x.server('stop_test',{testEnvelopeId:x.prepared.testEnvelopeId,testEnvelopeHash:x.prepared.testEnvelopeHash,submissionId:randomUUID()},'');
  assert.deepEqual(await usage(),{scopes:3,allocationMicrounits:String(10000000+initial*2)},'Stop never refunds the reviewed cumulative allocation');
  const source=readFileSync(path.join(root,'supabase/migrations',migration),'utf8');
  assert.match(source,/if tg_relid='private\.r12_owner_activations'::regclass then/);
  assert.match(source,/else\s+-- Episode, adaptive and direct grants retain their stricter intersection\.\s+max_scopes:=least\(coalesce\(rv.maximum_scopes,rt.maximum_scopes\),coalesce\(gr.maximum_scopes,2147483647\)\);max_amount:=least\(coalesce\(rv.maximum_allocation_microunits,rt.maximum_allocation_microunits\),coalesce\(gr.maximum_allocation_microunits,9007199254740991\)\);/);
  assert.equal(network,0);t.diagnostic(JSON.stringify({initialAllocation:initial,directAllocation:10000000,total:await usage(),negativeLimits:['scopes','allocation'],rootUnchanged:true,externalCalls:network}));
 }finally{globalThis.fetch=originalFetch;await db.close();}
});
