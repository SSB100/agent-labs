import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './helpers/r10-sql-fixture.mjs';
import {researchPostgresRaces,researchOperationExpiryRace} from './helpers/r11-public-research-races.mjs';
import {RESEARCH_KEY,RESEARCH_OTHER,sha,hash,canonical,value,authenticate,validateResearchPostgresUrl,setupResearchFixture,seedResearch,enrollResearch,research,financial,financialOwner,revoke,admission,guard,settle,collectionPayload,collectedResearch,counts,recanonicalizeCollection,legacyResearchExposure} from './helpers/r11-public-research-fixture.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const host=process.env.R11_SQL_TEST_HOST,pgUrl=process.env.R11_PUBLIC_RESEARCH_POSTGRES_URL;
const migration='20261005054758_r11_public_research.sql';
const functionSnapshot="select p.oid::regprocedure::text id,pg_get_functiondef(p.oid) body,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f' order by 1";
const tables=['r11_research_policies','r11_research_revocations','r11_research_collections','r11_research_bindings','r11_research_grants','r11_research_grant_revocations','r11_research_activations','r11_research_results'];
const reject=/r11_|r05_|r04_|invalid input syntax|violates check constraint|duplicate key/;

test('R11 public research SQL harness refuses remote, wrong-identity, shared, or options-bearing PostgreSQL targets',()=>{
 assert.equal(validateResearchPostgresUrl('postgresql://r11_test:inert@127.0.0.1:55432/r11_research_test'),'postgresql://r11_test:inert@127.0.0.1:55432/r11_research_test');
 for(const url of ['postgresql://r11_test:x@production.example/r11_research_test','postgresql://postgres:x@127.0.0.1/r11_research_test','postgresql://r11_test:x@127.0.0.1/r11_test','postgresql://r11_test:x@127.0.0.1/production','postgresql://r11_test:x@localhost/r11_research_test','postgresql://r11_test:x@127.0.0.1/r11_research_test?options=-csearch_path%3Dpublic','postgresql://r11_test:x@127.0.0.1/r11_research_test#anything','https://r11_test:x@127.0.0.1/r11_research_test'])assert.throws(()=>validateResearchPostgresUrl(url));
});

test('R11 public research additive SQL, source binding, collection custody and dispatch fence',{skip:!host,timeout:120000},async t=>{
 const require=createRequire(path.resolve(host,'package.json'));let db,Client;
 if(pgUrl){
  validateResearchPostgresUrl(pgUrl);({Client}=require('pg'));db=new Client({connectionString:pgUrl,connectionTimeoutMillis:5000,statement_timeout:15000,application_name:'r11-public-research-isolated'});await db.connect();
  const target=(await db.query('select current_database() db,current_user actor,inet_server_addr()::text address')).rows[0];assert.equal(target.db,'r11_research_test');assert.equal(target.actor,'r11_test');assert.equal(db.connection.stream.remoteAddress,'127.0.0.1','The actual PostgreSQL client socket must be loopback');assert.ok(target.address,'PostgreSQL must report a TCP server address');
  assert.equal(Number((await db.query("select count(*) from pg_tables where schemaname in ('public','private','auth','storage')")).rows[0].count),0,'Fresh empty database required; this harness never resets an existing database');db.exec=sql=>db.query(sql);db.close=()=>db.end();
 }else{const {PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');db=new PGlite({extensions:{pgcrypto}});}
 try{
  await db.exec(r04SqlBootstrap+sessionBootstrap);let before;let installed=false;
  for(const name of readdirSync(path.join(root,'supabase/migrations')).filter(n=>n.endsWith('.sql')).sort()){
   const source=readFileSync(path.join(root,'supabase/migrations',name),'utf8');
   if(name===migration){
    before=(await db.query(functionSnapshot)).rows;
    assert.match(source,/commit;\s*$/i);
    await assert.rejects(db.exec(source.replace(/commit;\s*$/i,()=>"do $$ begin raise exception 'r11_research_rollback_probe';end $$;commit;")),/r11_research_rollback_probe/);await db.exec('rollback');
    assert.deepEqual((await db.query(functionSnapshot)).rows,before);
    for(const table of tables)assert.equal(await value(db,'select to_regclass($1)::text result',[`private.${table}`]),null);
    installed=true;
   }
   try{await db.exec(source);}catch(e){throw Error(`${name}: ${e.message}\n${e.where??''}\n${e.internalQuery??''}`);}
  }
  assert.equal(installed,true,'The additive public research migration must exist');
  const after=new Map((await db.query(functionSnapshot)).rows.map(x=>[x.id,x]));for(const row of before)assert.deepEqual(after.get(row.id),row,`Existing function/ACL changed: ${row.id}`);
  for(const table of tables)assert.equal(await value(db,`select count(*)::int result from private.${table}`),0,'Migration must not seed source authority');
  await setupResearchFixture(db);
  async function noSideEffects(s,operation){const before=await counts(db,s);await assert.rejects(operation(),reject);assert.deepEqual(await counts(db,s),before);}

  await t.test('direct tables, authority issuance and immutable rows are closed to every application role',async()=>{
   const s=await seedResearch(db);
   for(const role of ['anon','authenticated','service_role']){
    for(const table of tables){const grants=(await db.query("select has_table_privilege($1,$2,'SELECT') s,has_table_privilege($1,$2,'INSERT') i,has_table_privilege($1,$2,'UPDATE') u,has_table_privilege($1,$2,'DELETE') d",[role,`private.${table}`])).rows[0];assert.deepEqual(grants,{s:false,i:false,u:false,d:false});}
    const internal=(await db.query("select p.oid::regprocedure::text signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'r11_research_%'")).rows;
    for(const fn of internal)assert.equal(await value(db,"select has_function_privilege($1,$2,'EXECUTE') result",[role,fn.signature]),false);
    await db.exec(`set role ${role}`);
    try{await assert.rejects(db.query('select * from private.r11_research_policies'),/permission denied/);await assert.rejects(enrollResearch(db,{...s,policy:{...s.policy,id:randomUUID()}}),/permission denied|guarded/);}finally{await db.exec('reset role');}
   }
   await assert.rejects(db.query("update private.r11_research_policies set search_wire_hash=repeat('a',64) where id=$1",[s.policy.id]),/immutable/);
   await assert.rejects(db.query('delete from private.r11_research_policies where id=$1',[s.policy.id]),/immutable/);
   await noSideEffects(s,()=>research(db,s,'load',{policyId:s.policy.id},'wrong'));
   await noSideEffects(s,()=>research(db,s,'load',{policyId:randomUUID()}));
   for(const operation of [null,'unknown'])await noSideEffects(s,()=>research(db,s,operation,{policyId:s.policy.id}));
   await noSideEffects(s,()=>research(db,s,'guard',null));
  });
  await t.test('administrative policy import rejects malformed scope, changed query review and invalid bounded dates',async()=>{
   const base=await seedResearch(db,{enroll:false});
   const mutations=[p=>p.query+=' unreviewed private context',p=>p.queryReviewHash='0'.repeat(64),p=>p.allowedDomains=['etsy.com'],p=>p.excludedDomains=[],p=>p.sourceReviews[0].basis='owner_asserted',p=>p.recipients.search='other.example',p=>p.retention.inference='default',p=>p.priceLimit.request=1,p=>p.validFrom=null,p=>p.validUntil='infinity',p=>p.quoteValidUntil='infinity',p=>p.quoteValidUntil=p.validFrom,p=>p.maximumMicrousd=250001,p=>p.selectorMicrousd=100,p=>p.unreviewedContext='extra'];
   for(const mutate of mutations){const candidate=structuredClone(base);candidate.policy.id=randomUUID();mutate(candidate.policy);candidate.policyHash=hash(candidate.policy);await assert.rejects(enrollResearch(db,candidate),reject);}
   assert.equal(await value(db,'select count(*)::int result from private.r11_research_policies where business_id=$1',[base.businessId]),0);
  });
  await t.test('owner/business/key scope is checked and load returns only exact immutable descriptors',async()=>{
   const s=await seedResearch(db),loaded=await research(db,s,'load',{policyId:s.policy.id});
   assert.deepEqual(loaded.policy,s.policy);assert.equal(loaded.policyHash,s.policyHash);assert.deepEqual(loaded.search,s.search);assert.equal(loaded.collection,null);assert.equal(JSON.stringify(loaded).includes(RESEARCH_KEY),false);
   const other=await seedResearch(db);await noSideEffects(other,()=>research(db,other,'load',{policyId:s.policy.id}));
   await authenticate(db,RESEARCH_OTHER);try{await assert.rejects(revoke(db,s),reject);}finally{await authenticate(db);}
   await db.query('update public.businesses set owner_user_id=$1 where id=$2',[RESEARCH_OTHER,s.businessId]);await noSideEffects(s,()=>research(db,s,'load',{policyId:s.policy.id}));
   const inactive='inert-expired-r11-research-authority-123456789';await db.query("insert into private.r05_server_keys values($1,clock_timestamp()-interval '1 second')",[sha(inactive)]);await noSideEffects(s,()=>research(db,s,'load',{policyId:s.policy.id},inactive));
  });
  await t.test('only exact admitted search and settled collection can dispatch the selector once',async()=>{
   const s=await seedResearch(db),{marked,payload,result}=await collectedResearch(db,s);
   assert.ok(result.collectionId);assert.equal(result.collectionHash,payload.collectionHash);assert.equal(result.lineageHash,payload.lineageHash);assert.equal(result.replayed,false);
   const replay=await guard(db,s);assert.equal(replay.shouldDispatch,false);assert.equal(replay.requestId,marked.requestId);
   assert.equal((await research(db,s,'collect',payload)).replayed,true);
   const loaded=await research(db,s,'load',{policyId:s.policy.id});assert.equal(loaded.collection.id,result.collectionId);assert.deepEqual(loaded.collection.collection,payload.collection);assert.deepEqual(loaded.collection.lineage,payload.lineage);assert.deepEqual(loaded.collection.selector,s.selector);
   const selected=await guard(db,s,'select');assert.equal(selected.shouldDispatch,true);
   const again=await guard(db,s,'select');assert.equal(again.shouldDispatch,false);assert.equal(again.requestId,selected.requestId);
   assert.deepEqual(await counts(db,s),{requests:2,reservations:2,markers:2,bindings:2,collections:1});
   const stored=(await db.query('select phase,logical_request_hash,wire_hash from private.r11_research_bindings where business_id=$1 order by phase',[s.businessId])).rows;assert.deepEqual(stored.map(x=>x.phase),['search','select']);assert.equal(stored[0].wire_hash,s.search.wireHash);assert.equal(stored[1].logical_request_hash,s.selector.requestHash);
   assert.equal(await value(db,'select count(*)::int result from public.product_research_cost_reservations where business_id=$1',[s.businessId]),0,'New lane uses R05, not a second legacy research reservation');
  });
  await t.test('forged logical/wire/request context is rejected atomically before R05 state',async()=>{
   const s=await seedResearch(db);
   for(const override of [{requestHash:'0'.repeat(64)},{wireRequestHash:'0'.repeat(64)},{wireRequestBytes:s.search.wireBytes+1},{maximumOutputTokens:s.search.maxTokens+1},{providerModelId:'other/model'},{sourceDomains:[]},{sourceDomains:['etsy.com']},{dataClasses:['public_evidence']},{dataClasses:['business_context','public_evidence']},{accountId:randomUUID(),accountRevision:randomUUID()},{liabilityMicrounits:'59'},{currency:'EUR'},{workflowRunId:randomUUID()},{operationKey:'research.model'},{idempotencyKey:`r11:${s.policy.id}:different`},{accounting:{kind:'research',callKey:'selector:luna.standard'}}])await noSideEffects(s,()=>guard(db,s,'search',override));
   for(const extra of [{phase:'unknown'},{phase:null},{collectionId:randomUUID()},{policyId:randomUUID()},{unexpected:'unreviewed'}])await noSideEffects(s,()=>guard(db,s,'search',{},extra));
   await noSideEffects(s,()=>guard(db,s,'search',{runtimeCapability:'wrong'}));
  });
  await t.test('changing an idempotency key cannot mint a second search or selector binding',async()=>{
   const s=await seedResearch(db);await collectedResearch(db,s);
   await noSideEffects(s,()=>guard(db,s,'search',{idempotencyKey:'fresh-forged-search'}));
   await guard(db,s,'select');await noSideEffects(s,()=>guard(db,s,'select',{idempotencyKey:'fresh-forged-select'}));
   assert.equal((await counts(db,s)).bindings,2);
  });
  await t.test('legacy direct guard and prepared dispatch cannot bypass research binding',async()=>{
   for(const phase of ['search','select']){
    const s=await seedResearch(db);if(phase==='select')s.selector={...s.search};
    const input=admission(s,phase);await noSideEffects(s,()=>financial(db,s,'guard',input));
    const prepared=await financial(db,s,'prepare',input);assert.ok(prepared.requestId);
    await noSideEffects(s,()=>financial(db,s,'dispatch',{requestId:prepared.requestId}));
    assert.equal((await counts(db,s)).markers,0);assert.equal((await counts(db,s)).bindings,0);
   }
  });
  await t.test('marker fence rejects alternate source-bearing operations while source-free legacy work is unchanged',async()=>{
   const closed=await seedResearch(db),source=admission(closed,'search',{operationKey:'creative.image',liabilityMicrounits:'40',idempotencyKey:'inert-other-source-op'});
   await noSideEffects(closed,()=>financial(db,closed,'guard',source));
   const allowed=await seedResearch(db),plain=admission(allowed,'search',{operationKey:'creative.text',liabilityMicrounits:'40',sourceDomains:[],dataClasses:['business_context'],idempotencyKey:'inert-source-free-op'});
   assert.equal((await financial(db,allowed,'guard',plain)).shouldDispatch,true);assert.equal((await counts(db,allowed)).bindings,0);
  });
  await t.test('collection requires a marked search, known settlement and the exact claimed provider receipt',async()=>{
   const s=await seedResearch(db),prepared=await financial(db,s,'prepare',admission(s));
   const receipt=`inert-${randomUUID()}`,payload=collectionPayload(s,prepared.requestId,receipt);
   await noSideEffects(s,()=>research(db,s,'collect',payload));
   const marked=await guard(db,s);assert.equal(marked.requestId,prepared.requestId);
   await noSideEffects(s,()=>research(db,s,'collect',payload));
   await settle(db,s,marked.requestId,receipt,null);await noSideEffects(s,()=>research(db,s,'collect',payload));
   await settle(db,s,marked.requestId,receipt,'20');
   const wrong=collectionPayload(s,marked.requestId,`unclaimed-${randomUUID()}`);await noSideEffects(s,()=>research(db,s,'collect',wrong));
   const accepted=await research(db,s,'collect',payload);assert.ok(accepted.collectionId);
  });
  await t.test('a settlement cannot inherit a provider receipt claimed by another request or business',async()=>{
   const target=await seedResearch(db),other=await seedResearch(db),targetMarked=await guard(db,target),otherMarked=await guard(db,other),receipt=`inert-claimed-${randomUUID()}`;
   await settle(db,other,otherMarked.requestId,receipt);
   // A deliberately inert administrator-corruption fixture proves the claimant predicate
   // independently from the normal R05 settlement writer's duplicate-receipt rejection.
   await db.query("insert into private.r05_settlements(request_id,business_id,currency,actual_microunits,provider_request_id,receipt_hash) values($1,$2,'USD',20,$3,$4)",[targetMarked.requestId,target.businessId,receipt,hash({corrupt:targetMarked.requestId})]);
   await noSideEffects(target,()=>research(db,target,'collect',collectionPayload(target,targetMarked.requestId,receipt)));
  });
  await t.test('null, infinite, stale and forged source metadata cannot acquire valid lineage by rehashing',async()=>{
   const s=await seedResearch(db),marked=await guard(db,s),receipt=`inert-${randomUUID()}`;await settle(db,s,marked.requestId,receipt);const exact=collectionPayload(s,marked.requestId,receipt);
   const mutations=[c=>c.sources[0].retrievedAt=null,c=>c.sources[0].retrievalExpiresAt=null,c=>c.sources[0].retrievedAt='-infinity',c=>c.sources[0].retrievalExpiresAt='infinity',c=>c.sources[0].retrievalExpiresAt=new Date(Date.now()-1000).toISOString(),c=>c.sources[0].url='https://etsy.com/listing/1',c=>c.sources[0].url='https://user:pass@gardening.example/report',c=>c.sources[0].url='https://gardening.example:444/report',c=>c.sources[0].contentHash='0'.repeat(64),c=>c.providerMetadata.searchRequestId=randomUUID(),c=>c.providerMetadata.requestedInferenceEndpoint='unapproved',c=>c.evidence[0].quote='This statement is not present in the attributed source excerpt.',c=>c.query+=' altered'];
   for(const mutate of mutations){const payload=structuredClone(exact);mutate(payload.collection);recanonicalizeCollection(payload);await noSideEffects(s,()=>research(db,s,'collect',payload));}
  });
  await t.test('credential/tracker query names and fragments are rejected even with fully rebased source hashes',async()=>{
   const s=await seedResearch(db),marked=await guard(db,s),receipt=`inert-${randomUUID()}`;await settle(db,s,marked.requestId,receipt);const exact=collectionPayload(s,marked.requestId,receipt);
   function withUrl(url){const payload=structuredClone(exact),source=payload.collection.sources[0],evidence=payload.collection.evidence[0];source.url=url;source.id=`src-${sha(`${url}:${source.contentHash}`).slice(0,24)}`;evidence.sourceId=source.id;evidence.id=`evi-${sha(`${source.id}:${evidence.quote}`).slice(0,24)}`;return recanonicalizeCollection(payload);}
   for(const suffix of ['?token=inert','?access_token=inert','?api_key=inert','?auth=inert','?password=inert','?ToKeN=inert','?%74oken=inert','?%61ccess_token=inert','?utm_source=inert','?%75tm_source=inert','?fbclid=inert','?gclid=inert','#inert-fragment'])await noSideEffects(s,()=>research(db,s,'collect',withUrl(`https://gardening.example/report${suffix}`)));
   const accepted=await research(db,s,'collect',withUrl('https://gardening.example/report?sort=popular'));assert.ok(accepted.collectionId);
  });
  await t.test('collection content, canonical bytes, lineage and selector descriptors cannot be forged or rebound',async()=>{
   const s=await seedResearch(db),marked=await guard(db,s),receipt=`inert-${randomUUID()}`;await settle(db,s,marked.requestId,receipt);const exact=collectionPayload(s,marked.requestId,receipt);
   const mutations=[p=>p.collection.sources[0].excerpt+=' altered',p=>p.collectionCanonical+=' ',p=>p.collectionHash='f'.repeat(64),p=>p.lineageHash='f'.repeat(64),p=>p.lineageCanonical+=' ',p=>p.selectorRequestHash='not-hash',p=>p.selectorWireHash='not-hash',p=>p.selectorWireBytes=0,p=>p.selectorMaxTokens=0,p=>p.searchRequestId=randomUUID(),p=>p.policyId=randomUUID(),p=>{p.lineage.policyId=randomUUID();p.lineageCanonical=canonical(p.lineage);p.lineageHash=hash(p.lineage);},p=>{p.lineage.sourceDomains=['etsy.com'];p.lineageCanonical=canonical(p.lineage);p.lineageHash=hash(p.lineage);}];
   for(const mutation of mutations){const payload=structuredClone(exact);mutation(payload);await noSideEffects(s,()=>research(db,s,'collect',payload));}
   const first=await research(db,s,'collect',exact);
   await noSideEffects(s,()=>research(db,s,'collect',{...exact,selectorWireHash:'1'.repeat(64)}));
   assert.equal((await counts(db,s)).collections,1);s.collectionId=first.collectionId;
   for(const override of [{requestHash:'a'.repeat(64)},{wireRequestHash:'b'.repeat(64)},{wireRequestBytes:2001},{maximumOutputTokens:999}])await noSideEffects(s,()=>guard(db,s,'select',override));
   await noSideEffects(s,()=>guard(db,s,'select',{}, {collectionId:randomUUID()}));
  });
  await t.test('over-cap search costs remain recorded but cannot qualify a collection or selector',async()=>{
   const s=await seedResearch(db),marked=await guard(db,s),receipt=`inert-overcap-${randomUUID()}`;await settle(db,s,marked.requestId,receipt,'61');
   await noSideEffects(s,()=>research(db,s,'collect',collectionPayload(s,marked.requestId,receipt)));
   assert.equal(await value(db,'select max(actual_microunits)::text result from private.r05_settlements where request_id=$1',[marked.requestId]),'61');
   assert.equal((await counts(db,s)).markers,1);assert.equal((await counts(db,s)).collections,0);
  });
  await t.test('revoked collection producer and different admission key cannot renew source authority',async()=>{
   const s=await seedResearch(db),key=`inert-r11-isolated-producer-${randomUUID()}`;await db.query("insert into private.r05_server_keys values($1,clock_timestamp()+interval '1 hour')",[sha(key)]);
   const marked=await research(db,s,'guard',{policyId:s.policy.id,phase:'search',collectionId:null,admission:admission(s)},key);assert.equal(marked.shouldDispatch,true);
   await noSideEffects(s,()=>guard(db,s));
   const receipt=`inert-${randomUUID()}`;await settle(db,s,marked.requestId,receipt);const payload=collectionPayload(s,marked.requestId,receipt);s.collectionId=(await research(db,s,'collect',payload,key)).collectionId;
   await db.query('insert into private.r05_server_revocations(key_hash) values($1)',[sha(key)]);
   await noSideEffects(s,()=>guard(db,s,'select'));await noSideEffects(s,()=>research(db,s,'load',{policyId:s.policy.id}));
  });
  await t.test('selector cannot borrow a collection from another policy or business',async()=>{
   const left=await seedResearch(db),right=await seedResearch(db);await collectedResearch(db,left);await collectedResearch(db,right);
   await noSideEffects(left,()=>guard(db,left,'select',{}, {collectionId:right.collectionId}));
   await noSideEffects(left,()=>research(db,left,'load',{policyId:right.policy.id}));
  });
  await t.test('owner revocation is key-free, idempotent and fences both phases without rewriting history',async()=>{
   const s=await seedResearch(db);await collectedResearch(db,s);const before=await counts(db,s);
   await db.exec('set role authenticated');try{await revoke(db,s);await revoke(db,s);}finally{await db.exec('reset role');}
   await noSideEffects(s,()=>guard(db,s,'select'));await noSideEffects(s,()=>guard(db,s));await noSideEffects(s,()=>research(db,s,'load',{policyId:s.policy.id}));assert.deepEqual(await counts(db,s),before);
   assert.equal(await value(db,'select count(*)::int result from private.r11_research_revocations where policy_id=$1',[s.policy.id]),1);
  });
  await t.test('policy and quote expiry fence admission using current wall-clock time',async()=>{
   for(const field of ['validUntil','quoteValidUntil']){const expiry=new Date(Date.now()+300).toISOString(),s=await seedResearch(db,{policyOverrides:{validUntil:expiry,[field]:expiry}});await pause(350);await noSideEffects(s,()=>guard(db,s));}
  });
  await t.test('a newer confirmed financial policy cannot silently replace the research policy binding',async()=>{
   const s=await seedResearch(db),updated={...structuredClone(s.operatingPayload),expectedCapRevision:1};
   const newer=await financialOwner(db,s,'propose',updated);await financialOwner(db,s,'confirm',{policyId:newer.id,policyHash:newer.hash});
   await db.query("insert into private.r05_policy_proofs values($1,$2,repeat('d',64),clock_timestamp()+interval '1 hour')",[newer.id,newer.hash]);
   await noSideEffects(s,()=>guard(db,s));assert.equal((await counts(db,s)).markers,0);
  });
  await t.test('R05 cap, unknown legacy exposure, pause and policy revocation remain authoritative',async()=>{
   const capped=await seedResearch(db,{ceiling:60});await collectedResearch(db,capped);assert.equal((await guard(db,capped,'select')).shouldDispatch,true); // 20 settled + 40 selector exactly fits.
   const legacy=await seedResearch(db);await legacyResearchExposure(db,legacy);const unknown=await guard(db,legacy);assert.equal(unknown.shouldDispatch,false);assert.equal(unknown.reason,'unresolved_prior_liability');assert.equal((await counts(db,legacy)).markers,0);
   const overage=await seedResearch(db,{ceiling:60}),marked=await guard(db,overage),receipt=`inert-${randomUUID()}`;await settle(db,overage,marked.requestId,receipt,'50');const payload=collectionPayload(overage,marked.requestId,receipt);overage.collectionId=(await research(db,overage,'collect',payload)).collectionId;
   const denied=await guard(db,overage,'select');assert.equal(denied.shouldDispatch,false);assert.equal(denied.reason,'financial_cap_exceeded');assert.equal((await counts(db,overage)).markers,1);
   const paused=await seedResearch(db);await financialOwner(db,paused,'pause',{kind:'business',id:paused.businessId});const pauseResult=await guard(db,paused);assert.equal(pauseResult.shouldDispatch,false);assert.equal(pauseResult.reason,'scope_paused');assert.equal((await counts(db,paused)).markers,0);
   const revoked=await seedResearch(db);await financialOwner(db,revoked,'revoke',{policyId:revoked.operatingPolicyId,policyHash:revoked.operatingPolicyHash});await noSideEffects(revoked,()=>guard(db,revoked));assert.equal((await counts(db,revoked)).markers,0);
  });
  await researchPostgresRaces(t,{db,Client,pgUrl});
 }finally{await db.close();}
});

const expiryUrl=process.env.R11_RESEARCH_EXPIRY_POSTGRES_URL;
test('R11 actual PostgreSQL immutable operation expiry during an observed installed-pack lock wait',{skip:!host||!expiryUrl,timeout:30000},async()=>{
 validateResearchPostgresUrl(expiryUrl);assert.equal(new URL(expiryUrl).port,'5433','Operation-expiry race requires its dedicated second PostgreSQL service on port 5433');
 if(pgUrl)assert.notEqual(new URL(pgUrl).port||'5432','5433','The main and operation-expiry harnesses must use separate PostgreSQL services');
 const require=createRequire(path.resolve(host,'package.json')),{Client}=require('pg'),db=new Client({connectionString:expiryUrl,connectionTimeoutMillis:5000,statement_timeout:15000,application_name:'r11-isolated-operation-expiry'});
 try{
  await db.connect();const target=(await db.query('select current_database() db,current_user actor,inet_server_addr()::text address')).rows[0];
  assert.equal(target.db,'r11_research_test');assert.equal(target.actor,'r11_test');assert.equal(db.connection.stream.remoteAddress,'127.0.0.1','The actual PostgreSQL client socket must be loopback');assert.ok(target.address,'PostgreSQL must report a TCP server address');
  assert.equal(Number((await db.query("select count(*) from pg_tables where schemaname in ('public','private','auth','storage')")).rows[0].count),0,'Require a fresh empty dedicated database; never reset an existing database');
  db.exec=sql=>db.query(sql);await db.exec(r04SqlBootstrap+sessionBootstrap);
  for(const name of readdirSync(path.join(root,'supabase/migrations')).filter(n=>n.endsWith('.sql')).sort())await db.exec(readFileSync(path.join(root,'supabase/migrations',name),'utf8'));
  const expires=Date.now()+2500;await setupResearchFixture(db,{registryValidUntil:new Date(expires).toISOString()});
  await researchOperationExpiryRace({db,Client,pgUrl:expiryUrl,expires});
 }finally{await db.end();}
});
