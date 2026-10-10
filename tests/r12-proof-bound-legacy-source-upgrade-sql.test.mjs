/** Warm source .1/.2 records and IO must keep their exact old authority. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {proofBoundResearchDatabase} from './helpers/r12-proof-bound-research-database.mjs';
import {landingControllerFixture} from './helpers/r12-landing-controller-fixture.mjs';
import {proofBoundResearchRuntimeComposition,INERT_DIRECT_RUNTIME_ROOT} from './helpers/r12-proof-bound-research-runtime-fixture.mjs';
import {fixture as resultFixture} from './helpers/etsy-insights-playwright-fixture.mjs';
import {landingFixture} from './helpers/etsy-insights-landing-fixture.mjs';
import {one} from './helpers/r12-owner-initial-sql-fixture.mjs';
const enabled=!!process.env.R12_SQL_TEST_HOST;
function requests(factory){return options=>{let browser;options.beforeNavigate=url=>browser.request(url);options.beforeSubmit=url=>browser.request(url);browser=factory(options);return browser;};}
test('proof-bound upgrade preserves warm legacy source qualifications and genuine .1 and .2 browser IO',{skip:!enabled,timeout:240000},async()=>{
 const fetch=globalThis.fetch,prior={VERCEL_ENV:process.env.VERCEL_ENV,R05_ADMISSION_SERVER_KEY:process.env.R05_ADMISSION_SERVER_KEY};let db,external=0,old;
 globalThis.fetch=async()=>{external++;throw Error('No external transport');};Object.assign(process.env,{VERCEL_ENV:'production',R05_ADMISSION_SERVER_KEY:INERT_DIRECT_RUNTIME_ROOT});
 try{
  db=await proofBoundResearchDatabase({beforeResearchMigration:async d=>{
   const f=await landingControllerFixture(d,{landingVerification:false,landingSource:false}),h=proofBoundResearchRuntimeComposition(d,f,{browserFactory:requests(resultFixture)});
   assert.equal((await h.step()).reason,'accepted');const a=await f.schedule('source'),q=await f.rpc('qualify_renderer',{attemptId:a.attemptId},'source');
   const oid=await one(d,"select 'private.r12_direct_source_port(uuid,text,jsonb)'::regprocedure::oid::text source,'private.r12_landing_source(uuid)'::regprocedure::oid::text landing,'private.r12_direct_renderer_check(jsonb,jsonb,text)'::regprocedure::oid::text renderer");
   old={f,h,a,q,oid};
  }});
  assert.deepEqual(await one(db,"select 'private.r12_direct_source_port(uuid,text,jsonb)'::regprocedure::oid::text source,'private.r12_landing_source(uuid)'::regprocedure::oid::text landing,'private.r12_direct_renderer_check(jsonb,jsonb,text)'::regprocedure::oid::text renderer"),old.oid);
  assert.deepEqual(await old.f.rpc('qualify_renderer',{attemptId:old.a.attemptId},'source'),old.q);
  assert.equal(old.q.version,'r12.etsy-insights-renderer-qualification.1');
  assert.equal((await old.h.step()).reason,'source_recorded',JSON.stringify(old.h.sqlErrors));assert.equal(old.h.sourceResults[0].run.receipt.status,'completed');
  assert.equal(old.h.browserPosts.length,1);assert.equal(old.h.browsers[0].events.filter(x=>x==='submit').length,1);
  const f=await landingControllerFixture(db),h=proofBoundResearchRuntimeComposition(db,f,{browserFactory:requests(landingFixture)});
  assert.equal((await h.step()).reason,'accepted');assert.equal((await h.step()).reason,'source_recorded',JSON.stringify(h.sqlErrors));
  assert.equal(h.sourceResults[0].run.receipt.status,'completed');assert.equal(h.browserPosts.length,1);assert.equal(h.browsers[0].events.filter(x=>x==='submit').length,1);
  const q=(await one(db,'select content from private.r12_direct_source_renderer_qualifications where attempt_id=$1',[h.browserPosts[0].attemptId])).content;
  assert.equal(q.version,'r12.etsy-insights-renderer-qualification.2');assert.equal(Object.hasOwn(q,'readiness'),false);
  assert.equal((await one(db,'select count(*)::int n from private.r12_verification_candidate_selections')).n,0);assert.equal(external,0);
 }finally{globalThis.fetch=fetch;for(const[k,v]of Object.entries(prior))if(v===undefined)delete process.env[k];else process.env[k]=v;await db?.close();}
});
