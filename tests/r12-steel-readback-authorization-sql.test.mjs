import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {steelReadbackDatabase,readbackFixture,readbackOwner,readbackTarget,publishReadback,readbackStatus,readbackServer,claimReadback,readbackProof,proofPayload,one,hash,sha,readbackOwnerRuntime,withReadbackEnvironment,cannedReadback,READBACK_MIGRATION,INERT_READBACK_ROOT} from './helpers/r12-steel-readback-sql-fixture.mjs';
import {authorizedReadbackFixture,publishReadbackAuthorization,stopReadbackGoal,readbackPaidCounts} from './helpers/r12-steel-readback-authorization-fixture.mjs';
const safe=(x,status)=>{assert.deepEqual(Object.keys(x).sort(),['version','businessId','targetHash','status','observedAt','proofHash'].sort());if(status)assert.equal(x.status,status);assert.doesNotMatch(JSON.stringify(x),/authorization|approval|reviewEvidence|serverKey|r11Policy|credential|PRIVATE_SENTINEL|knownSession|providerProject/);return x;};
const cancel=(db,f)=>readbackServer(db,f,'cancel',{targetHash:f.target.targetHash});
const mutate=(a,changes)=>{const b={...a,...changes};delete b.authorizationHash;return{...b,authorizationHash:hash(b)};};
const authCount=async db=>(await one(db,'select count(*)::int n from private.r12_steel_readback_authorizations')).n;

test('one-shot authorization executes actual additive migration and confines expired original-R11 root to metadata',{
 skip:!process.env.R12_SQL_TEST_HOST,timeout:240000,
},async t=>{
 const db=await steelReadbackDatabase(),savedFetch=globalThis.fetch;let external=0;globalThis.fetch=async()=>{external++;throw Error('External transport forbidden');};
 try{
  await t.test('historical no-sidecar authority and every existing paid definition/ACL remain unchanged',async()=>{
   assert.equal(db.readbackMigrationEvidence.migration,READBACK_MIGRATION);assert.ok(db.readbackMigrationEvidence.unchangedFunctions>100);
   const f=await readbackFixture(db);assert.equal((await claimReadback(db,f)).mayFetch,true);assert.equal(await authCount(db),0);
  });
  await t.test('publisher is invoker-only, immutable, private and rejects missing, extra or mismatched evidence',async()=>{
   const f=await authorizedReadbackFixture(db,{publish:false}),a=f.authorization;
   const baseline=await authCount(db);
   for(const change of [{version:'wrong'},{purpose:'browser.etsy.owner_handoff.create'},{targetHash:'f'.repeat(64)},{businessId:randomUUID()},{ownerId:randomUUID()},{goalId:randomUUID()},{goalRevision:99},{goalHash:'f'.repeat(64)},{serverKeyHash:'f'.repeat(64)},{r11PolicyId:randomUUID()},{r11PolicyHash:'f'.repeat(64)},{approvalHash:'bad'},{reviewEvidenceHash:'bad'},{validFrom:'-infinity'},{validFrom:a.validFrom.replace('Z','+00:00')},{validFrom:new Date(Date.now()+30000).toISOString()},{expiresAt:'infinity'},{expiresAt:new Date(Date.now()-1).toISOString()},{expiresAt:new Date(Date.now()+7200001).toISOString()},{extra:'forbidden'}])await assert.rejects(publishReadbackAuthorization(db,mutate(a,change)),undefined,JSON.stringify(change));
   for(const key of Object.keys(a)){const body={...a};delete body[key];await assert.rejects(publishReadbackAuthorization(db,body));}
   await assert.rejects(publishReadbackAuthorization(db,{...a,authorizationHash:'0'.repeat(64)}));assert.equal(await authCount(db),baseline);
   const receipt=await publishReadbackAuthorization(db,a);assert.equal(receipt.metadataOnly,true);assert.deepEqual(await publishReadbackAuthorization(db,a),receipt);
   for(const role of ['anon','authenticated','service_role']){
    await db.exec('set role '+role);try{
     await assert.rejects(db.query('select private.r12_steel_publish_readback_authorization($1)',[a]),/permission denied/);
     await assert.rejects(db.query('select * from private.r12_steel_readback_authorizations'),/permission denied/);
     await assert.rejects(db.query('insert into private.r12_steel_readback_authorizations select * from private.r12_steel_readback_authorizations'),/permission denied/);
    }finally{await db.exec('reset role');}
   }
   await assert.rejects(db.query('update private.r12_steel_readback_authorizations set expires_at=expires_at where target_hash=$1',[a.targetHash]),/trusted_immutable/);
   await assert.rejects(db.query('delete from private.r12_steel_readback_authorizations where target_hash=$1',[a.targetHash]),/trusted_immutable/);
   const rpcAcl=await one(db,"select prosecdef,proconfig,has_function_privilege('authenticated',oid,'execute') owner,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('service_role',oid,'execute') service from pg_proc where oid='public.r12_steel_config_readback_server(uuid,text,jsonb,text)'::regprocedure");assert.equal(rpcAcl.prosecdef,true);assert.ok(rpcAcl.proconfig.includes('search_path=""'));assert.equal(rpcAcl.owner,true);assert.equal(rpcAcl.anon,false);assert.equal(rpcAcl.service,false);
   for(const role of ['anon','authenticated','service_role'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal((await one(db,"select has_table_privilege($1,'private.r12_steel_readback_authorizations',$2) allowed",[role,privilege])).allowed,false);
   const fn=await one(db,"select prosecdef,proconfig from pg_proc where oid='private.r12_steel_publish_readback_authorization(jsonb)'::regprocedure");assert.equal(fn.prosecdef,false);assert.ok(fn.proconfig.includes('search_path=""'));
   assert.deepEqual((await db.query("select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'r12_steel_readback_author%' and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute'))")).rows,[]);
  });
  await t.test('expired R11 root only succeeds for its exact sidecar, owner, target and original provenance',async()=>{
   const f=await authorizedReadbackFixture(db,{publish:false});await assert.rejects(claimReadback(db,f),{code:'42501',message:/server_required/});
   const rootBefore=await one(db,'select to_jsonb(k) row from private.r05_server_keys k where key_hash=$1',[sha(f.key)]),policyBefore=await one(db,'select to_jsonb(p) row from private.r11_research_policies p where id=$1',[f.original.policy.id]),paidBefore=await readbackPaidCounts(db);
   await publishReadbackAuthorization(db,f.authorization);const c=await claimReadback(db,f);assert.equal(c.mayFetch,true);assert.ok(Date.parse(c.claim.expiresAt)>Date.now());assert.ok(Date.parse(c.claim.expiresAt)<=Date.now()+20000);assert.ok(Date.parse(c.claim.expiresAt)<=Date.parse(f.authorization.expiresAt));assert.ok(Date.parse(rootBefore.row.expires_at)<Date.now());
   await assert.rejects(readbackServer(db,{...f,ownerId:randomUUID()},'record',proofPayload(f,c)),/owner_required/);
   await assert.rejects(readbackServer(db,f,'record',proofPayload(f,c),'inert-other-root-'+randomUUID()),{code:'42501'});
   const other=readbackTarget(f);await publishReadback(db,other);await assert.rejects(claimReadback(db,{...f,target:other}),/server_required/);
   const result=safe(await readbackServer(db,f,'record',proofPayload(f,c)),'verified');assert.ok(result.proofHash);assert.deepEqual(await one(db,'select to_jsonb(k) row from private.r05_server_keys k where key_hash=$1',[sha(f.key)]),rootBefore);assert.deepEqual(await readbackPaidCounts(db),paidBefore);assert.deepEqual(await one(db,'select to_jsonb(p) row from private.r11_research_policies p where id=$1',[f.original.policy.id]),policyBefore);
   await assert.rejects(db.query('select private.r11_research_key($1)',[sha(f.key)]),/authority_required/);
   await assert.rejects(db.query("select public.r05_admission_server($1,'admit','{}',$2)",[f.businessId,f.key]),/authority_required/);
   const ambiguous=await authorizedReadbackFixture(db);await ambiguous.addAssociation();await assert.rejects(claimReadback(db,ambiguous),/provenance_required/);safe(await readbackStatus(db,ambiguous),'review_required');
   const unreviewed=await authorizedReadbackFixture(db,{publish:false});await unreviewed.addAssociation();await assert.rejects(publishReadbackAuthorization(db,unreviewed.authorization),/provenance_required/);
  });
  await t.test('current Goal edits and Stop gate new acquisition; issued claims still allow honest record and cancellation',async()=>{
   for(const afterClaim of [false,true]){
    const f=await authorizedReadbackFixture(db),c=afterClaim?await claimReadback(db,f):null;await stopReadbackGoal(db,f);
    if(!c){safe(await readbackStatus(db,f),'review_required');await assert.rejects(claimReadback(db,f),/goal_required/);}
    else{safe(await readbackStatus(db,f),'pending');safe(await readbackServer(db,f,'record',proofPayload(f,c)),'verified');safe(await readbackStatus(db,f),'verified');assert.equal((await claimReadback(db,f)).mayFetch,false);}
   }
   const f=await authorizedReadbackFixture(db);await claimReadback(db,f);await stopReadbackGoal(db,f);safe(await cancel(db,f),'cancelled');assert.equal((await claimReadback(db,f)).mayFetch,false);
   const stale=await authorizedReadbackFixture(db,{publish:false});await stopReadbackGoal(db,stale);await assert.rejects(publishReadbackAuthorization(db,stale.authorization),/goal_required/);
  });
  await t.test('Business and Quest financial pause events reject new claims without changing Goal history',async()=>{
   for(const settings of [{business:true},{financialPause:true}]){const f=await authorizedReadbackFixture(db);await stopReadbackGoal(db,f,settings);safe(await readbackStatus(db,f),'review_required');await assert.rejects(claimReadback(db,f),/goal_required/);}
  });
  await t.test('exact finite two-hour ceiling and prior historical consumption cannot be widened or rearmed',async()=>{
   const now=Date.now(),validFrom=new Date(now).toISOString(),expiresAt=new Date(now+7200000).toISOString();
   const f=await authorizedReadbackFixture(db,{publish:false,targetChanges:{expiresAt:new Date(now+10800000).toISOString()},authorizationChanges:{validFrom,expiresAt}});
   await assert.rejects(publishReadbackAuthorization(db,mutate(f.authorization,{expiresAt:new Date(now+7200001).toISOString()})));
   await publishReadbackAuthorization(db,f.authorization);
   for(const operation of ['claim','cancel']){const g=await authorizedReadbackFixture(db,{publish:false});await readbackServer(db,g,operation,operation==='claim'?{targetHash:g.target.targetHash,submissionId:randomUUID()}:{targetHash:g.target.targetHash},INERT_READBACK_ROOT);await assert.rejects(publishReadbackAuthorization(db,g.authorization),/target_inactive/);}
  });
  await t.test('sidecar proof pins and immutable replay still reject changed session, project, configuration and claim',async()=>{
   const f=await authorizedReadbackFixture(db),c=await claimReadback(db,f),proof=readbackProof(f,c),payload=proofPayload(f,c,proof);
   for(const changes of [{returnedSessionId:randomUUID()},{returnedProjectId:randomUUID()},{configurationHash:'a'.repeat(64)},{providerStatus:'live'},{observedAt:'infinity'},{observedAt:f.target.expectedCreatedAt}])await assert.rejects(readbackServer(db,f,'record',{...payload,proof:{...proof,...changes}}));
   await assert.rejects(readbackServer(db,f,'record',{...payload,claimHash:'a'.repeat(64)}),/claim_required/);
   await assert.rejects(readbackServer(db,f,'record',payload,INERT_READBACK_ROOT),/authorization_required/);
   const saved=safe(await readbackServer(db,f,'record',payload),'verified');assert.deepEqual(await readbackServer(db,f,'record',payload),saved);
   await assert.rejects(readbackServer(db,f,'record',{...payload,proof:{...proof,responseHash:hash('changed response')}}),/result_conflict/);
   assert.deepEqual(await cancel(db,f),saved);assert.deepEqual(await readbackServer(db,f,'fail',{targetHash:f.target.targetHash,claimId:c.claim.id,claimHash:c.claim.hash,reason:'provider_readback_unverified'}),saved);
  });
  await t.test('same owner and global/target revocations are rechecked before every mutation',async()=>{
   for(const mode of ['root','target','owner']){
    const f=await authorizedReadbackFixture(db),c=await claimReadback(db,f),proof=readbackProof(f,c);
    if(mode==='root')await db.query('insert into private.r05_server_revocations(key_hash) values($1)',[sha(f.key)]);
    if(mode==='target')await db.query("insert into private.r12_steel_readback_revocations(target_hash,reason) values($1,'operator_revoked')",[f.target.targetHash]);
    if(mode==='owner'){const other=await readbackOwner(db);await db.query('update public.businesses set owner_user_id=$2 where id=$1',[f.businessId,other.ownerId]);}
    for(const work of [()=>claimReadback(db,f),()=>cancel(db,f),()=>readbackServer(db,f,'record',proofPayload(f,c,proof)),()=>readbackServer(db,f,'fail',{targetHash:f.target.targetHash,claimId:c.claim.id,claimHash:c.claim.hash,reason:'provider_readback_unverified'})])await assert.rejects(work,{code:'42501'});
    if(mode!=='owner')safe(await readbackStatus(db,f),'review_required');
   }
   for(const mode of ['root','target']){const f=await authorizedReadbackFixture(db,{publish:false});if(mode==='root')await db.query('insert into private.r05_server_revocations(key_hash) values($1)',[sha(f.key)]);else await db.query("insert into private.r12_steel_readback_revocations(target_hash,reason) values($1,'operator_revoked')",[f.target.targetHash]);await assert.rejects(publishReadbackAuthorization(db,f.authorization));}
  });
  await t.test('authorization expiry bounds the claim and preserves readable terminal history without new mutation',async()=>{
   const f=await authorizedReadbackFixture(db,{authorizationChanges:{expiresAt:new Date(Date.now()+1200).toISOString()}}),c=await claimReadback(db,f),proof=readbackProof(f,c);assert.equal(c.claim.expiresAt,f.authorization.expiresAt);await delay(1250);
   for(const work of [()=>claimReadback(db,f),()=>cancel(db,f),()=>readbackServer(db,f,'record',proofPayload(f,c,proof)),()=>readbackServer(db,f,'fail',{targetHash:f.target.targetHash,claimId:c.claim.id,claimHash:c.claim.hash,reason:'provider_readback_unverified'})])await assert.rejects(work,{code:'42501'});
   safe(await readbackStatus(db,f),'expired');assert.deepEqual(await publishReadbackAuthorization(db,f.authorization),f.authorizationReceipt);
   await assert.rejects(publishReadbackAuthorization(db,mutate(f.authorization,{expiresAt:f.target.expiresAt})),/conflict/);
   const g=await authorizedReadbackFixture(db,{authorizationChanges:{expiresAt:new Date(Date.now()+1200).toISOString()}}),claim=await claimReadback(db,g),payload=proofPayload(g,claim);const saved=await readbackServer(db,g,'record',payload);await delay(1250);assert.deepEqual(safe(await readbackStatus(db,g),'verified'),saved);await assert.rejects(readbackServer(db,g,'record',payload),{code:'42501'});
  });
  await t.test('failed and cancelled targets are permanently consumed and cannot be rearmed by publication',async()=>{
   for(const operation of ['cancel','fail']){
    const f=await authorizedReadbackFixture(db),c=await claimReadback(db,f),payload={targetHash:f.target.targetHash,claimId:c.claim.id,claimHash:c.claim.hash,reason:'provider_readback_unverified'};
    safe(operation==='cancel'?await cancel(db,f):await readbackServer(db,f,'fail',payload),operation==='cancel'?'cancelled':'failed');assert.equal((await claimReadback(db,f)).mayFetch,false);
    assert.deepEqual(await publishReadbackAuthorization(db,f.authorization),f.authorizationReceipt);assert.equal((await claimReadback(db,f)).mayFetch,false);
    await assert.rejects(publishReadbackAuthorization(db,mutate(f.authorization,{reviewEvidenceHash:hash('changed review')})),/conflict/);
    await assert.rejects(readbackServer(db,f,'record',proofPayload(f,c)),/result_conflict/);
   }
  });
  await t.test('expired dispatch claims can terminate while sidecar is live, but can never produce verified proof',async()=>{
   const fixtures=[];for(const operation of ['fail','cancel']){const f=await authorizedReadbackFixture(db),c=await claimReadback(db,f);fixtures.push({f,c,operation,proof:readbackProof(f,c)});}
   await delay(Math.max(...fixtures.map(({c})=>Date.parse(c.claim.expiresAt)))-Date.now()+50);
   for(const {f,c,operation,proof} of fixtures){await assert.rejects(readbackServer(db,f,'record',proofPayload(f,c,proof)),/claim_expired/);safe(operation==='cancel'?await cancel(db,f):await readbackServer(db,f,'fail',{targetHash:f.target.targetHash,claimId:c.claim.id,claimHash:c.claim.hash,reason:'provider_readback_unverified'}),operation==='cancel'?'cancelled':'failed');assert.equal((await claimReadback(db,f)).mayFetch,false);}
  });
  await t.test('actual TypeScript action consumes one GET and lost acknowledgments never refetch',async()=>{
   const restore=withReadbackEnvironment();try{
    for(const fault of ['none','claim','record']){
     const f=await authorizedReadbackFixture(db),requests=[],ui=readbackOwnerRuntime(db,f,{afterRpc:({args})=>{if(args.p_operation===fault)throw Error('Inert lost acknowledgment');}});process.env.R05_ADMISSION_SERVER_KEY=f.key;globalThis.fetch=cannedReadback(f,requests);
     const result=safe(await ui.server.runSteelConfigReadback(ui.context,f.businessId,f.target.targetHash),fault==='claim'?'pending':'verified');assert.equal(requests.length,fault==='claim'?0:1);
     assert.deepEqual(await ui.server.runSteelConfigReadback(ui.context,f.businessId,f.target.targetHash),result);assert.equal(requests.length,fault==='claim'?0:1);
     assert.ok([...ui.loaded.keys()].some(p=>p.endsWith('/src/browser/etsy-steel-config-readback.ts')));
    }
   }finally{restore();globalThis.fetch=async()=>{external++;throw Error('External transport forbidden');};}
  });
  assert.equal(external,0);
 }finally{globalThis.fetch=savedFetch;await db.close();}
});
