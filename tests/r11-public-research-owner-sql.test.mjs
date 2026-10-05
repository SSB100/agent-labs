import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './helpers/r10-sql-fixture.mjs';
import {RESEARCH_OWNER,RESEARCH_OTHER,RESEARCH_SESSION,RESEARCH_KEY,setupResearchFixture,authenticate,sha,hash,canonical,value,research,admission,financial,collectionPayload,revoke,legacyResearchExposure,RESEARCH_WORKFLOW} from './helpers/r11-public-research-fixture.mjs';
import {OWNER_PROOF_KEY,ownerWorkspace,ownerBootstrap,importOwnerGrant,seedOwnerGrant,activateOwnerGrant,completionPayload} from './helpers/r11-public-research-owner-proof.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),host=process.env.R11_SQL_TEST_HOST;
const reject=/r11_|r05_|r04_|invalid input syntax|violates check constraint|duplicate key|permission denied/;
test('R11 actual owner activation, immutable proof persistence and key-free durable workspace',{skip:!host,timeout:120000},async t=>{
 const require=createRequire(path.resolve(host,'package.json')),{PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
 const db=new PGlite({extensions:{pgcrypto}});
 try{
  await db.exec(r04SqlBootstrap+sessionBootstrap);
  for(const name of readdirSync(path.join(root,'supabase/migrations')).filter(n=>n.endsWith('.sql')).sort())await db.exec(readFileSync(path.join(root,'supabase/migrations',name),'utf8'));
  const validFrom=new Date(Date.now()-5000).toISOString(),validUntil=new Date(Date.now()+240000).toISOString(),options={validFrom,validUntil};
  await setupResearchFixture(db,{registryValidFrom:validFrom,registryValidUntil:validUntil});
  await db.query("insert into private.r05_server_keys values($1,$2::timestamptz+interval '30 minutes')",[sha(OWNER_PROOF_KEY),validUntil]);
  const server=(s,op,payload)=>research(db,s,op,payload,OWNER_PROOF_KEY);
  const settle=(s,id,receipt,amount='20')=>financial(db,s,'settle',{requestId:id,currency:'USD',actualMicrounits:amount,providerRequestId:receipt,receiptHash:hash({id,receipt,amount})},OWNER_PROOF_KEY);
  const guard=(s,phase='search')=>server(s,'guard',{policyId:s.policy.id,phase,collectionId:phase==='search'?null:s.collectionId,admission:admission(s,phase)});
  async function collect(s){const marked=await guard(s),receipt=`inert-search-${randomUUID()}`;await settle(s,marked.requestId,receipt);const payload=collectionPayload(s,marked.requestId,receipt),result=await server(s,'collect',payload);s.collectionId=result.collectionId;s.lineage=payload.lineage;return payload.collection;}
  async function currentCounts(s){return(await db.query('select (select count(*) from private.r04_business_state where business_id=$1)::int business,(select count(*) from private.r04_goal_state where business_id=$1)::int goals,(select count(*) from private.r05_policies where business_id=$1)::int policies,(select count(*) from private.r05_cap_versions where business_id=$1)::int caps,(select count(*) from private.r11_research_activations a join private.r11_research_grants g on a.grant_id=g.id where g.business_id=$1)::int activations',[s.businessId])).rows[0];}
  await t.test('migration issues zero owner grants, results or activations and closes app table/function authority',async()=>{
   for(const table of ['r11_research_grants','r11_research_grant_revocations','r11_research_activations','r11_research_results']){
    assert.equal(await value(db,`select count(*)::int result from private.${table}`),0);
    for(const role of ['anon','authenticated','service_role'])for(const permission of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal(await value(db,'select has_table_privilege($1,$2,$3) result',[role,`private.${table}`,permission]),false);
   }
   for(const fn of ['r11_research_workspace(uuid)','r11_research_bootstrap(uuid,uuid,text)','r11_research_revoke(uuid,uuid)'])for(const role of ['anon','service_role'])assert.equal(await value(db,'select has_function_privilege($1,$2,\'EXECUTE\') result',[role,`public.${fn}`]),false);
  });
  await t.test('read-only workspace requires current actual owner session but no server key',async()=>{
   const s=await seedOwnerGrant(db,options),before=await currentCounts(s),workspace=await ownerWorkspace(db,s.businessId);
   assert.deepEqual(workspace.exposure,{currency:'USD',heldMicrounits:'0',hasUnknown:false});assert.equal(workspace.grants.length,1);assert.equal(workspace.policies.length,0);assert.equal(workspace.grants[0].grantHash,s.grantHash);
   assert.equal(JSON.stringify(workspace).includes(OWNER_PROOF_KEY),false);assert.equal(JSON.stringify(workspace).includes(RESEARCH_KEY),false);assert.deepEqual(await currentCounts(s),before);
   await authenticate(db,RESEARCH_OTHER);await assert.rejects(ownerWorkspace(db,s.businessId),reject);await assert.rejects(ownerBootstrap(db,s),reject);
   await authenticate(db,RESEARCH_OWNER,randomUUID());await assert.rejects(ownerWorkspace(db,s.businessId),reject);await assert.rejects(ownerBootstrap(db,s),reject);await authenticate(db);
   await db.query("update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=$1",[RESEARCH_SESSION]);await assert.rejects(ownerBootstrap(db,s),reject);await db.query('update auth.sessions set not_after=null where id=$1',[RESEARCH_SESSION]);
   assert.deepEqual(await currentCounts(s),before);
  });
  await t.test('exact grant activation calls sanctioned owner transitions once and creates no request or marker',async()=>{
   const s=await seedOwnerGrant(db,options);await assert.rejects(ownerBootstrap(db,s,'0'.repeat(64)),reject);
   await db.exec('set role authenticated');let activated;try{activated=await activateOwnerGrant(db,s);}finally{await db.exec('reset role');}
   assert.equal(activated.policyId,s.grant.policyId);assert.equal(activated.replayed,false);assert.equal((await ownerBootstrap(db,s)).replayed,true);
   assert.deepEqual(await currentCounts(s),{business:1,goals:1,policies:1,caps:1,activations:1});
   assert.equal(await value(db,'select count(*)::int result from private.r05_requests where business_id=$1',[s.businessId]),0);
   assert.equal(await value(db,'select actor_id::text result from private.r05_confirmations where policy_id=$1',[s.operatingPolicyId]),RESEARCH_OWNER);
   assert.equal(s.policyHash,hash(s.policy));assert.equal(s.policy.maximumMicrousd,250000);assert.equal((await ownerWorkspace(db,s.businessId)).policies[0].status,'ready');
   await assert.rejects(research(db,s,'load',{policyId:s.policy.id},RESEARCH_KEY),reject);
   await assert.rejects(db.query('update private.r11_research_grants set grant_hash=repeat(\'a\',64) where id=$1',[s.grant.id]),/immutable/);
   await assert.rejects(db.query('delete from private.r11_research_activations where grant_id=$1',[s.grant.id]),/immutable/);
  });
  await t.test('stale exposure, revoked grant, nonempty current authority and malformed exact templates fail atomically',async()=>{
   const stale=await seedOwnerGrant(db,{...options,expectedExposure:'1'});await assert.rejects(ownerBootstrap(db,stale),/r05_stale_exposure/);assert.deepEqual(await currentCounts(stale),{business:0,goals:0,policies:0,caps:0,activations:0});
   const stopped=await seedOwnerGrant(db,options);await db.query('insert into private.r11_research_grant_revocations(grant_id) values($1)',[stopped.grant.id]);await assert.rejects(ownerBootstrap(db,stopped),/grant_inactive/);
   const nonempty=await seedOwnerGrant(db,options);await value(db,'select public.r04_quest_transition($1,\'business.save\',$2,$3) result',[nonempty.businessId,{expectedRevision:0,content:nonempty.grant.businessContent,preference:'setup'},randomUUID()]);await assert.rejects(ownerBootstrap(db,nonempty),/empty_current_authority/);
   for(const mutate of [g=>g.operatingPolicy.maximumDispatches=3,g=>g.operatingPolicy.policyLimitMicrounits='250001',g=>g.operatingPolicy.businessLifetimeLimitMicrounits='1',g=>g.researchPolicy.maximumMicrousd=250001,g=>g.researchPolicy.validUntil=new Date(Date.parse(validUntil)+3600000).toISOString(),g=>g.serverKeyHash=sha(RESEARCH_KEY),g=>g.operatingPolicy.operations[0].sourceDomains=['etsy.com'],g=>g.approvalHash='invalid',g=>g.installationSnapshotHash='0'.repeat(64)]){
    const s=await seedOwnerGrant(db,{...options,enroll:false});mutate(s.grant);s.grantHash=hash(s.grant);await assert.rejects(importOwnerGrant(db,s),reject);assert.equal((await currentCounts(s)).policies,0);
   }
  });
  await t.test('fresh authority includes all original Business exposure without resetting a historical research root',async()=>{
   const s=await seedOwnerGrant(db,{...options,expectedExposure:'598063'}),oldGoal=randomUUID(),oldRun='3ebba15b-eaac-457e-8828-1311070b89fa';
   await db.query("insert into public.goals(id,business_id,title,description,status) values($1,$2,'Historical research','Original objective','draft')",[oldGoal,s.businessId]);
   await db.query("insert into public.workflow_runs(id,business_id,goal_id,workflow_definition_id,idempotency_key,status,state) values($1,$2,$3,$4,'historical-research-root','completed',$5)",[oldRun,s.businessId,oldGoal,RESEARCH_WORKFLOW,{legacyAllowanceMicrousd:2000000,legacyRemainingMicrousd:1890520}]);
   const reservation=await legacyResearchExposure(db,{...s,workflowRunId:oldRun},598063);
   await db.query("insert into public.product_research_cost_settlements(business_id,reservation_id,reported_microusd,provider_request_id,fingerprint) values($1,$2,598063,'inert-exact-historical-receipt',repeat('f',64))",[s.businessId,reservation]);
   const before=await value(db,'select to_jsonb(w) result from public.workflow_runs w where id=$1',[oldRun]);
   await activateOwnerGrant(db,s);
   assert.deepEqual(await value(db,'select to_jsonb(w) result from public.workflow_runs w where id=$1',[oldRun]),before);
   assert.equal(await value(db,'select maximum_microunits::text result from private.r05_cap_versions where business_id=$1',[s.businessId]),'848063');
   assert.deepEqual((await ownerWorkspace(db,s.businessId)).exposure,{currency:'USD',heldMicrounits:'598063',hasUnknown:false});
   assert.notEqual(s.goalId,oldGoal);assert.notEqual(s.workflowRunId,oldRun);
  });
  await t.test('markers and known receipts alone never imply successful proof; complete verifies every exact span and both settled receipts',async()=>{
   const s=await seedOwnerGrant(db,options);await activateOwnerGrant(db,s);const collection=await collect(s),selected=await guard(s,'select'),receipt=`inert-selector-${randomUUID()}`,payload=completionPayload(s,collection,selected.requestId,receipt);
   assert.equal((await ownerWorkspace(db,s.businessId)).policies[0].status,'selection_recording_pending');assert.equal((await ownerWorkspace(db,s.businessId)).policies[0].result,null);
   await assert.rejects(server(s,'complete',payload),/receipt_required/);await settle(s,selected.requestId,receipt,null);await assert.rejects(server(s,'complete',payload),/receipt_required/);await settle(s,selected.requestId,receipt);
   for(const mutate of [p=>p.selectorRequestId=randomUUID(),p=>p.providerRequestId=`wrong-${randomUUID()}`,p=>p.collectionId=randomUUID(),p=>p.selection.selections[0].quote='An invented quote that does not exist in this source',p=>p.selection.selections[0].sourceKey='S4',p=>p.selection.limitations=['proven_sales'],p=>p.evidencePack.claims[0].text='Invented demand proof',p=>p.evidencePack.sourceLineage.policyId=randomUUID(),p=>p.evidencePackCanonical+=' ',p=>p.evidencePackHash='0'.repeat(64)]){
    const bad=structuredClone(payload);mutate(bad);if(JSON.stringify(bad.evidencePack)!==JSON.stringify(payload.evidencePack)){bad.evidencePackCanonical=canonical(bad.evidencePack);bad.evidencePackHash=hash(bad.evidencePack);}await assert.rejects(server(s,'complete',bad),reject);
   }
   const saved=await server(s,'complete',payload);assert.ok(saved.resultId);assert.equal(saved.evidencePackHash,payload.evidencePackHash);assert.equal(saved.replayed,false);
   assert.equal((await server(s,'complete',payload)).replayed,true);await assert.rejects(guard(s,'select'),reject);
   const workspace=await ownerWorkspace(db,s.businessId);assert.equal(workspace.policies[0].status,'completed');assert.deepEqual(workspace.policies[0].result.evidencePack,payload.evidencePack);assert.equal(workspace.policies[0].result.resultId,saved.resultId);assert.equal(workspace.exposure.heldMicrounits,'40');assert.equal(workspace.exposure.hasUnknown,false);
   assert.equal(await value(db,'select status result from public.workflow_runs where id=$1',[s.workflowRunId]),'completed');
   await assert.rejects(db.query('delete from private.r11_research_results where id=$1',[saved.resultId]),/immutable/);await assert.rejects(db.query('update private.r11_research_results set selection=\'{}\' where id=$1',[saved.resultId]),/immutable/);
   await revoke(db,s);assert.equal((await ownerWorkspace(db,s.businessId)).policies[0].revoked,true);assert.equal((await ownerWorkspace(db,s.businessId)).policies[0].result.resultId,saved.resultId);
  });
  await t.test('Stop fences further calls yet already marked settled output can be retained during bounded key grace',async()=>{
   const s=await seedOwnerGrant(db,options);await activateOwnerGrant(db,s);const collection=await collect(s),selected=await guard(s,'select'),receipt=`inert-stopped-${randomUUID()}`;await settle(s,selected.requestId,receipt);await revoke(db,s);
   await assert.rejects(guard(s,'select'),reject);const saved=await server(s,'complete',completionPayload(s,collection,selected.requestId,receipt));assert.ok(saved.resultId);const read=await ownerWorkspace(db,s.businessId);assert.equal(read.policies[0].revoked,true);assert.equal(read.policies[0].status,'completed');
  });
  await t.test('over-cap selector cost is retained without a successful proof',async()=>{
   const s=await seedOwnerGrant(db,options);await activateOwnerGrant(db,s);const collection=await collect(s),selected=await guard(s,'select'),receipt=`inert-over-cap-${randomUUID()}`;await settle(s,selected.requestId,receipt,'41');
   await assert.rejects(server(s,'complete',completionPayload(s,collection,selected.requestId,receipt)),/selector_receipt_required/);
   const workspace=await ownerWorkspace(db,s.businessId);assert.equal(workspace.exposure.heldMicrounits,'61');assert.equal(workspace.policies[0].result,null);assert.notEqual(workspace.policies[0].status,'completed');
  });
  await t.test('completed evidence survives source-policy and server-key expiry on owner reload',async()=>{
   const expires=Date.now()+2000,key=`inert-short-lived-owner-proof-${randomUUID()}`;
   await db.query('insert into private.r05_server_keys values($1,$2)',[sha(key),new Date(expires+300).toISOString()]);
   const s=await seedOwnerGrant(db,{...options,validUntil:new Date(expires).toISOString(),enroll:false});s.grant.serverKeyHash=sha(key);s.grantHash=hash(s.grant);await importOwnerGrant(db,s);await activateOwnerGrant(db,s);
   const call=(op,payload)=>research(db,s,op,payload,key),mark=phase=>call('guard',{policyId:s.policy.id,phase,collectionId:phase==='search'?null:s.collectionId,admission:admission(s,phase)});
   const settleShort=(id,receipt)=>financial(db,s,'settle',{requestId:id,currency:'USD',actualMicrounits:'20',providerRequestId:receipt,receiptHash:hash({id,receipt})},key);
   const searched=await mark('search'),searchReceipt=`inert-expiring-search-${randomUUID()}`;await settleShort(searched.requestId,searchReceipt);const collection=collectionPayload(s,searched.requestId,searchReceipt);s.collectionId=(await call('collect',collection)).collectionId;s.lineage=collection.lineage;
   const selected=await mark('select'),receipt=`inert-expiring-select-${randomUUID()}`;await settleShort(selected.requestId,receipt);const saved=await call('complete',completionPayload(s,collection.collection,selected.requestId,receipt));
   await pause(Math.max(0,expires+320-Date.now()));const workspace=await ownerWorkspace(db,s.businessId);assert.equal(workspace.policies[0].expired,true);assert.equal(workspace.policies[0].status,'completed');assert.equal(workspace.policies[0].result.resultId,saved.resultId);
   await assert.rejects(call('load',{policyId:s.policy.id}),reject);
  });
  await t.test('administrative grant revocation remains authoritative after owner activation',async()=>{
   const s=await seedOwnerGrant(db,options);await activateOwnerGrant(db,s);
   await db.query('insert into private.r11_research_grant_revocations(grant_id) values($1)',[s.grant.id]);
   const workspace=await ownerWorkspace(db,s.businessId);assert.equal(workspace.policies[0].status,'revoked');assert.equal(workspace.policies[0].revoked,true);
   await assert.rejects(guard(s),/policy_inactive/);assert.equal(await value(db,'select count(*)::int result from private.r05_requests where business_id=$1',[s.businessId]),0);
  });
  await t.test('revoked server key prevents new completion but cannot erase owner-readable committed evidence',async()=>{
   const s=await seedOwnerGrant(db,options);await activateOwnerGrant(db,s);const collection=await collect(s),selected=await guard(s,'select'),receipt=`inert-key-${randomUUID()}`;await settle(s,selected.requestId,receipt);const saved=await server(s,'complete',completionPayload(s,collection,selected.requestId,receipt));
   await db.query('insert into private.r05_server_revocations(key_hash) values($1)',[sha(OWNER_PROOF_KEY)]);await assert.rejects(server(s,'complete',completionPayload(s,collection,selected.requestId,receipt)),reject);
   assert.equal((await ownerWorkspace(db,s.businessId)).policies[0].result.resultId,saved.resultId);
  });
 }finally{await db.close();}
});
