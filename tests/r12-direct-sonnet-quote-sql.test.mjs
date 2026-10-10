/** Additive direct quote qualification; catalogs and all provider IO are inert. */
import test from 'node:test';import assert from 'node:assert/strict';
import {directSonnetDatabase,applyDirectSonnet} from './helpers/r12-direct-sonnet-database.mjs';
import {directRepairFixture} from './helpers/r12-direct-controller-repair-fixture.mjs';
import {directRepairModelComplete as complete} from './helpers/r12-direct-controller-repair-model-fixture.mjs';
import {r12PhaseOutputFixture} from './helpers/r12-phase-output-fixture.mjs';
import {directSonnetCatalogFixture} from './helpers/r12-direct-sonnet-catalog-fixture.mjs';
import {qualifyDirectSonnetInferenceQuote} from '../.core-tests/products/discovery-r12-public-reviewer-quote.js';
import {qualifyPublicResearchSonnetQuote} from '../.core-tests/products/discovery-r12-public-preparation.js';
import {one} from './helpers/r12-owner-initial-sql-fixture.mjs';
import {discoveryV2Hash as hash} from '../.core-tests/products/discovery-v2-hash.js';
const options={skip:!process.env.R12_SQL_TEST_HOST&&!process.env.R12_REQUIRE_POSTGRES&&!process.env.R12_POSTGRES_URL,timeout:180000};
const rehash=q=>{q.baseQuoteHash=hash({version:'r12.direct-inference-catalog.1',luna:q.luna,reviewer:q.reviewer});const{quoteHash,verifiedAt,validUntil,...body}=q;void quoteHash;return{...body,quoteHash:hash(body),verifiedAt,validUntil};};
test('saved Haiku state and warmed legacy validators survive additive Sonnet qualification; malformed new quotes fail',options,async()=>{const db=await directSonnetDatabase({apply:false});try{
 const f=await directRepairFixture(db);f.authority.db=db;
 const output=r12PhaseOutputFixture(f.profile.audience);output.plan.queryFocus=[];
 const a=await f.schedule('plan'),done=await complete(f,a,output.plan),before={attempt:await f.rpc('attempt',{attemptId:a.attemptId}),state:(await f.read()).state};
 const signatures=['private.r12_adaptive_quote_check(jsonb,jsonb)','private.r12_adaptive_quote_check_etsy(jsonb,jsonb)','private.r12_discovery_proof_validate(private.r12_discovery_candidates,jsonb)'];
 const definitions=()=>db.query("select oid::text,pg_get_functiondef(oid) definition,proacl::text acl,proconfig from pg_proc where oid=any($1::regprocedure[]) order by oid",[signatures]);
 const original=(await definitions()).rows;
 const warm=async()=>{
  await db.query('select private.r12_adaptive_quote_check_etsy($1)',[f.quote.inference]);
  await db.query('select private.r12_direct_research_quote(e,$2,$2) from private.r12_direct_test_envelopes e where id=$1',[f.authority.prepared.testEnvelopeId,f.quote]);
  await db.query("select private.r12_discovery_proof_validate(jsonb_populate_record(null::private.r12_discovery_candidates,jsonb_build_object('candidate',$1::jsonb)),$2)",[done.candidate,done.proof]);
 };await warm();await applyDirectSonnet(db);await warm();
 assert.deepEqual((await definitions()).rows,original,'Original legacy OIDs, bodies, ACLs and configurations remain byte-identical');
 assert.deepEqual(await f.rpc('attempt',{attemptId:a.attemptId}),before.attempt);assert.deepEqual((await f.read()).state,before.state);
 assert.equal(f.quote.inference.reviewer.modelId,'anthropic/claude-haiku-4.5');
 const legacyContext=await f.authority.server('research_quote_context',{testEnvelopeId:f.authority.prepared.testEnvelopeId,testEnvelopeHash:f.authority.prepared.testEnvelopeHash});assert.deepEqual(Object.keys(legacyContext).sort(),['browserQuote','browserRevalidation','maximumAttemptsInWindow','originalRunMaximumMicrounits','approvedQuote'].sort());assert.equal(legacyContext.approvedQuote,null);

 const q=qualifyDirectSonnetInferenceQuote(directSonnetCatalogFixture(Date.now()));
 await db.query('select private.r12_direct_inference_quote_check($1)',[q]);assert.deepEqual(q.ceilings,{plan:43521,strategy:82891,review:795908});
 const increasedCatalog=directSonnetCatalogFixture(Date.now());for(const row of [increasedCatalog.reviewerAlias.payload.data.endpoints[0],increasedCatalog.reviewerCanonical.payload.data.endpoints[0],increasedCatalog.zdr.payload.data[1]]){row.pricing.prompt='0.0000022';row.pricing.input_cache_write_1h='0.0000077';};
 const increased=qualifyDirectSonnetInferenceQuote(increasedCatalog);assert.deepEqual(increased.ceilings,q.ceilings);await db.query('select private.r12_direct_inference_quote_check($1)',[increased]);
 await db.query('select private.r12_direct_inference_quote_check($1,$2)',[increased,q]);assert.notEqual(increased.quoteHash,q.quoteHash);
 for(const row of [increasedCatalog.reviewerAlias.payload.data.endpoints[0],increasedCatalog.reviewerCanonical.payload.data.endpoints[0],increasedCatalog.zdr.payload.data[1]])row.pricing.input_cache_write_1h='0.00000770002';
 const crossing=qualifyDirectSonnetInferenceQuote(increasedCatalog);await assert.rejects(db.query('select private.r12_direct_inference_quote_check($1,$2)',[crossing,q]),/ceiling_invalid/);

 const check=x=>db.query('select private.r12_direct_inference_quote_check($1)',[x]);
 const boundaryCatalog=directSonnetCatalogFixture(Date.now());for(const row of [boundaryCatalog.reviewerAlias.payload.data.endpoints[0],boundaryCatalog.reviewerCanonical.payload.data.endpoints[0],boundaryCatalog.zdr.payload.data[1]]){row.pricing.prompt='0.00001';row.pricing.completion='0.00031568';row.pricing.input_cache_write='0';row.pricing.input_cache_write_1h='0';}
 const boundary=qualifyDirectSonnetInferenceQuote(boundaryCatalog);assert.equal(boundary.ceilings.review,2000000);await check(boundary);
 const above=structuredClone(boundary);above.reviewer.tokenPricesUsd.completion='0.000315680000000001';above.reviewer.priceLimit.completion=315.680001;above.ceilings.review=2000001;await assert.rejects(check(rehash(above)),/ceiling_invalid/);

 for(const mutate of [x=>x.maximumExtraActions=10,x=>x.maximumRunMicrousd=10000000,x=>x.reviewer.modelId='anthropic/claude-haiku-4.5',x=>x.reviewer.endpoint='amazon-bedrock',x=>x.reviewer.sourceHashes.identity=hash('wrong'),x=>x.reviewer.sourceHashes.zdr=hash('wrong'),x=>x.reviewer.sourceHashes.alias=null,x=>x.luna.sourceHashes.identity=null,x=>x.ceilings.review--,x=>x.reviewer.tokenPricesUsd.cacheWrite='0',x=>x.reviewer.tokenPricesUsd.prompt=null,x=>x.reviewer.priceLimit.prompt=1,x=>x.retention.inference='training_allowed',x=>x.validUntil=new Date(Date.parse(x.validUntil)+1).toISOString(),x=>x.verifiedAt=null]){
  const changed=structuredClone(q);mutate(changed);await assert.rejects(check(rehash(changed)),/r12_direct_inference|keys/);
 }
 await assert.rejects(db.query('select private.r12_adaptive_quote_check_etsy($1)',[q]),/r12_|keys/);
 await assert.rejects(db.query('select private.r12_direct_inference_quote_check($1)',[f.quote.inference]),/r12_|keys/);
 const newPublic=qualifyPublicResearchSonnetQuote(q,f.quote.browser,'10000000');
 await assert.rejects(db.query('select private.r12_direct_research_quote(e,$2,$3) from private.r12_direct_test_envelopes e where id=$1',[f.authority.prepared.testEnvelopeId,newPublic,f.quote]),/fresh_envelope|sonnet_enrollment_required/);
 await assert.rejects(db.query('select private.r12_direct_research_quote(e,$2) from private.r12_direct_test_envelopes e where id=$1',[f.authority.prepared.testEnvelopeId,newPublic]),/research_quote_unqualified|sonnet_enrollment_required/);
 const oldObservation=await f.rpc('observe_quote',{inferenceQuote:f.quote.inference});assert.equal(oldObservation.quote.version,'r12.public-research-quote.2');assert.equal(oldObservation.quote.inference.reviewer.modelId,'anthropic/claude-haiku-4.5');
 await assert.rejects(f.rpc('observe_quote',{inferenceQuote:q}),/r12_|keys/);
 const exposed=(await db.query("select n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and (p.proname like '%sonnet%' or p.proname in ('r12_direct_inference_quote_check','r12_direct_model_proof_validate')) and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute') or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE'))")).rows;assert.deepEqual(exposed,[]);
 assert.deepEqual((await f.read()).state,before.state);assert.equal((await one(db,'select count(*)::int n from private.r12_direct_test_envelopes')).n,1);
 }finally{await db.close();}});
