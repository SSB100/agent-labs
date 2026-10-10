import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {steelReadbackDatabase,readbackOwner,readbackTarget,readbackFixture,publishReadback,readbackStatus,readbackServer,claimReadback,readbackProof,proofPayload,readbackCounts,one,hash,sha,readbackOwnerRuntime,withReadbackEnvironment,cannedReadback,INERT_READBACK_KEY} from './helpers/r12-steel-readback-sql-fixture.mjs';
import {setupResearchFixture,RESEARCH_OWNER} from './helpers/r11-public-research-fixture.mjs';
import {seedOwnerGrant,activateOwnerGrant,OWNER_PROOF_KEY} from './helpers/r11-public-research-owner-proof.mjs';
import {ownerInitialSqlFixture} from './helpers/r12-owner-initial-sql-fixture.mjs';
const options={skip:!process.env.R12_SQL_TEST_HOST,timeout:240000};
let sharedDatabase;
// One fresh database per invocation also supports the guarded native runner.
before(async()=>{if(!options.skip)sharedDatabase=await steelReadbackDatabase();},{timeout:240000});
after(async()=>{await sharedDatabase?.close();});
const keys=['version','businessId','targetHash','status','observedAt','proofHash'].sort();
function safe(value,status){assert.deepEqual(Object.keys(value).sort(),keys);if(status)assert.equal(value.status,status);assert.doesNotMatch(JSON.stringify(value),/PRIVATE_SENTINEL|private\.invalid|inert-provider-key|serverKey|credentialBinding|knownSession|returnedSession|providerProject|configuration|claimId/);return value;}
const cancel=(db,f)=>readbackServer(db,f,'cancel',{targetHash:f.target.targetHash});
async function deniedUnchanged(db,work,pattern){const before=await readbackCounts(db);await assert.rejects(work,pattern);assert.deepEqual(await readbackCounts(db),before);}

test('21400 metadata precursor enforces private targets, existing-root claims, exact proofs and no create authority',options,async t=>{
 const savedFetch=globalThis.fetch;let externalCalls=0;globalThis.fetch=async()=>{externalCalls++;throw Error('External traffic forbidden');};
 const db=sharedDatabase;
 try{
  await t.test('safe owner status works without a grant, route, target or provider configuration',async()=>{
   const f=await readbackOwner(db);safe(await readbackStatus(db,f),'review_required');
   assert.deepEqual(await readbackCounts(db),{targets:0,claims:0,results:0,attestations:0,permits:0,uses:0,routes:0,grants:0,operations:0});
   await assert.rejects(readbackStatus(db,{...f,ownerId:randomUUID()}),/owner_required/);
   await assert.rejects(readbackStatus(db,f,'f'.repeat(64)),/target_unavailable/);
  });
  await t.test('only a trusted immutable exact reviewed target can be published',async()=>{
   const f=await readbackOwner(db);
   const invalid=[{version:'wrong'},{businessId:randomUUID()},{ownerId:randomUUID()},{providerProjectId:randomUUID()},{knownSessionId:'not-uuid'},{observedTerminalState:'Live'},{expectedProviderStatus:'live'},{expectedCreatedAt:'infinity'},{expectedCreatedAt:new Date().toISOString()},{knownBefore:new Date(Date.now()+100000).toISOString()},{validFrom:'-infinity'},{expiresAt:'infinity'},{expiresAt:new Date(Date.now()-10000).toISOString()},{expiresAt:new Date(Date.now()+90000000).toISOString()},{serverKeyHash:'forbidden-new-purpose-enrollment'},{configurationHash:'0'.repeat(64)},{deploymentEvidenceHash:'bad'},{routeReviewHash:'bad'},{tariffEvidenceHash:'bad'},{extra:'not allowed'}];
   for(const change of invalid)await deniedUnchanged(db,()=>publishReadback(db,readbackTarget(f,change)));
   for(const change of [{environment:'preview'},{providerProjectId:randomUUID()},{baseUrl:'https://unreviewed.invalid'},{deploymentId:'bad'},{releaseCommitSha:'bad'},{region:'\n'},{extra:true}]){
    const target=readbackTarget(f);target.configuration={...target.configuration,...change};target.configurationHash=hash(target.configuration);const{targetHash,...body}=target;void targetHash;target.targetHash=hash(body);
    await deniedUnchanged(db,()=>publishReadback(db,target));
   }
   const target=readbackTarget(f);await deniedUnchanged(db,()=>publishReadback(db,{...target,targetHash:'0'.repeat(64)}));
   const published=await publishReadback(db,target);assert.equal(published.authorityCreated,false);assert.equal(published.targetHash,target.targetHash);assert.deepEqual(await publishReadback(db,target),published);
   for(const role of ['anon','authenticated','service_role']){
    await db.exec('set role '+role);try{await assert.rejects(db.query('select private.r12_steel_publish_readback_target($1)',[target]),/permission denied/);await assert.rejects(db.query('select * from private.r12_steel_readback_targets'),/permission denied/);}finally{await db.exec('reset role');}
   }
   await assert.rejects(db.query('update private.r12_steel_readback_targets set expires_at=expires_at where target_hash=$1',[target.targetHash]),/trusted_immutable/);
   const tables=(await db.query("select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname like 'r12_steel_readback_%' and c.relkind='r'")).rows;assert.equal(tables.length,4);assert.ok(tables.every(x=>x.relrowsecurity));
   assert.deepEqual((await db.query("select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and (p.proname like 'r12_steel_readback_%' or p.proname='r12_steel_publish_readback_target') and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute'))")).rows,[]);
  });
  await t.test('owner JWT alone, foreign owner/Business and wrong target/key cannot obtain a fetch claim',async()=>{
   const f=await readbackFixture(db),other=await readbackOwner(db),payload={targetHash:f.target.targetHash,submissionId:randomUUID()};
   for(const key of [null,'','short','wrong-root-key-'+'x'.repeat(32)])await deniedUnchanged(db,()=>readbackServer(db,f,'claim',payload,key),/server_required/);
   await deniedUnchanged(db,()=>readbackServer(db,{...f,ownerId:other.ownerId},'claim',payload),/owner_required/);
   await deniedUnchanged(db,()=>readbackServer(db,{...other,key:f.key},'claim',payload),/target_unavailable/);
   for(const role of ['anon','service_role'])await deniedUnchanged(db,()=>readbackServer(db,f,'claim',payload,f.key,{role}),/permission denied/);
   await deniedUnchanged(db,()=>readbackServer(db,f,'claim',payload,f.key,{ownerId:null}),/owner_required/);
   for(const kind of ['expired','revoked']){const key='inert-'+kind+'-r05-root-'+randomUUID();await db.query("insert into private.r05_server_keys(key_hash,expires_at) values($1,clock_timestamp()+($2::text)::interval)",[sha(key),kind==='expired'?'-1 second':'1 day']);if(kind==='revoked')await db.query('insert into private.r05_server_revocations(key_hash) values($1)',[sha(key)]);await deniedUnchanged(db,()=>readbackServer(db,f,'claim',payload,key),/server_required/);}
   for(const wrong of [{...payload,targetHash:'f'.repeat(64)},{...payload,targetHash:'BAD'},{...payload,submissionId:null},{...payload,submissionId:'bad'},{...payload,extra:true},{targetHash:f.target.targetHash}])await deniedUnchanged(db,()=>readbackServer(db,f,'claim',wrong));
   for(const operation of ['create','list','renew','publish','grant'])await deniedUnchanged(db,()=>readbackServer(db,f,operation,payload),/operation_invalid/);
   safe(await readbackStatus(db,f),'ready');const before=Date.now(),claim=await claimReadback(db,f);
   assert.equal(claim.mayFetch,true);assert.equal(claim.target.targetHash,f.target.targetHash);assert.ok(Date.parse(claim.claim.expiresAt)>before&&Date.parse(claim.claim.expiresAt)<=Date.now()+20000);
   const cached=await claimReadback(db,f);assert.equal(cached.mayFetch,false);safe(cached.status,'pending');assert.deepEqual(Object.keys(cached).sort(),['version','targetHash','mayFetch','status'].sort());
   assert.equal((await one(db,'select count(*)::int n from private.r12_steel_readback_claims where target_hash=$1',[f.target.targetHash])).n,1);
  });
  await t.test('exact proof identity, project, configuration, creation and observation pins are mandatory',async()=>{
   const f=await readbackFixture(db),claim=await claimReadback(db,f),proof=readbackProof(f,claim),payload=proofPayload(f,claim,proof);
   const changes=[{version:'wrong'},{method:'POST'},{endpoint:'https://api.steel.dev/v1/sessions'},{requestedSessionId:randomUUID()},{returnedSessionId:randomUUID()},{returnedProjectId:randomUUID()},{providerStatus:'live'},{providerStatus:'failed'},{sessionCreatedAt:new Date(Date.parse(f.target.expectedCreatedAt)+1).toISOString()},{sessionCreatedAt:f.target.knownBefore},{sessionCreatedAt:null},{sessionCreatedAt:'-infinity'},{observedAt:f.target.expectedCreatedAt},{observedAt:new Date(Date.now()+30000).toISOString()},{observedAt:null},{observedAt:'infinity'},{observedAt:proof.observedAt.replace('Z','+00:00')},{configurationHash:'a'.repeat(64)},{credentialBindingHash:'bad'},{responseHash:'bad'},{extra:'unexpected'}];
   for(const change of changes)await deniedUnchanged(db,()=>readbackServer(db,f,'record',{...payload,proof:{...proof,...change}}));
   for(const change of [{claimId:randomUUID()},{claimHash:'a'.repeat(64)},{proof:null},{proof:{...proof,extra:'x'.repeat(13000)}}])await deniedUnchanged(db,()=>readbackServer(db,f,'record',{...payload,...change}));
   await deniedUnchanged(db,()=>readbackServer(db,f,'record',payload,''),/server_required/);
   const otherRoot='inert-other-existing-root-'+randomUUID();await db.query("insert into private.r05_server_keys(key_hash,expires_at) values($1,clock_timestamp()+interval '1 day')",[sha(otherRoot)]);await deniedUnchanged(db,()=>readbackServer(db,f,'record',payload,otherRoot),/claim_required/);
   const result=safe(await readbackServer(db,f,'record',payload),'verified');assert.equal(result.proofHash,hash(proof));assert.equal(result.observedAt,proof.observedAt);
   assert.deepEqual(await readbackServer(db,f,'record',payload),result,'lost record reply can replay the identical proof without another GET');
   await deniedUnchanged(db,()=>readbackServer(db,f,'record',{...payload,proof:{...proof,responseHash:hash('different response')}}),/result_conflict/);
   const row=await one(db,'select proof,proof_hash from private.r12_steel_readback_results where target_hash=$1',[f.target.targetHash]);assert.deepEqual(row.proof,proof);assert.equal(row.proof_hash,result.proofHash);
   safe((await claimReadback(db,f)).status,'verified');assert.equal((await claimReadback(db,f)).mayFetch,false);
   await assert.rejects(db.query('delete from private.r12_steel_readback_results where target_hash=$1',[f.target.targetHash]),/trusted_immutable/);
   const unknown=await readbackFixture(db,{expectedCreatedAt:null,expectedProviderStatus:null}),c=await claimReadback(db,unknown);
   await deniedUnchanged(db,()=>readbackServer(db,unknown,'record',proofPayload(unknown,c,readbackProof(unknown,c,{sessionCreatedAt:unknown.target.knownBefore}))),/proof_invalid/);
   safe(await readbackServer(db,unknown,'record',proofPayload(unknown,c,readbackProof(unknown,c,{providerStatus:'failed'}))),'verified');
  });
  await t.test('expiry, revocation and immutable cancellation prevent claim renewal and late proof',async()=>{
   const expired=await readbackFixture(db,{expiresAt:new Date(Date.now()+1000).toISOString()});await pause(1050);assert.equal((await claimReadback(db,expired)).mayFetch,false);safe(await readbackStatus(db,expired),'expired');
   const late=await readbackFixture(db,{expiresAt:new Date(Date.now()+1000).toISOString()}),claim=await claimReadback(db,late),proof=readbackProof(late,claim);await pause(1050);await deniedUnchanged(db,()=>readbackServer(db,late,'record',proofPayload(late,claim,proof)),/claim_expired/);assert.equal((await claimReadback(db,late)).mayFetch,false);
   const revoked=await readbackFixture(db);await db.query("insert into private.r12_steel_readback_revocations(target_hash,reason) values($1,'operator_revoked')",[revoked.target.targetHash]);assert.equal((await claimReadback(db,revoked)).mayFetch,false);safe(await readbackStatus(db,revoked),'review_required');
   const revokedAfter=await readbackFixture(db),c=await claimReadback(db,revokedAfter);await db.query("insert into private.r12_steel_readback_revocations(target_hash,reason) values($1,'operator_revoked')",[revokedAfter.target.targetHash]);await deniedUnchanged(db,()=>readbackServer(db,revokedAfter,'record',proofPayload(revokedAfter,c)),/claim_expired/);
   for(const after of [false,true]){const f=await readbackFixture(db),c=after?await claimReadback(db,f):null;safe(await cancel(db,f),'cancelled');safe(await cancel(db,f),'cancelled');assert.equal((await claimReadback(db,f)).mayFetch,false);if(c)await deniedUnchanged(db,()=>readbackServer(db,f,'record',proofPayload(f,c)),/result_conflict/);}
   for(const kind of ['expired','revoked']){const f=await readbackFixture(db),key='inert-root-after-claim-'+kind+'-'+randomUUID();await db.query("insert into private.r05_server_keys(key_hash,expires_at) values($1,clock_timestamp()+($2::text)::interval)",[sha(key),kind==='expired'?'1 second':'1 day']);f.key=key;const c=await claimReadback(db,f),proof=readbackProof(f,c);if(kind==='expired'){assert.ok(Date.parse(c.claim.expiresAt)<=Date.now()+1000);await pause(1050);}else await db.query('insert into private.r05_server_revocations(key_hash) values($1)',[sha(key)]);await deniedUnchanged(db,()=>readbackServer(db,f,'record',proofPayload(f,c,proof)),/server_required/);await deniedUnchanged(db,()=>claimReadback(db,f),/server_required/);}
   const failed=await readbackFixture(db),c2=await claimReadback(db,failed);await deniedUnchanged(db,()=>readbackServer(db,failed,'fail',{targetHash:failed.target.targetHash,claimId:c2.claim.id,claimHash:c2.claim.hash,reason:'provider said PRIVATE_SENTINEL'}),/failure_invalid/);safe(await readbackServer(db,failed,'fail',{targetHash:failed.target.targetHash,claimId:c2.claim.id,claimHash:c2.claim.hash,reason:'provider_readback_unverified'}),'failed');assert.equal((await claimReadback(db,failed)).mayFetch,false);
  });
  const counts=await readbackCounts(db);for(const k of ['attestations','permits','uses','routes','grants','operations'])assert.equal(counts[k],0,k+' must not be created');assert.equal(externalCalls,0);
  await t.test('genuine delegated R11 and R12 authority cannot be reused as the existing root',async()=>{
   const validFrom=new Date(Date.now()-1000).toISOString(),validUntil=new Date(Date.now()+240000).toISOString();await setupResearchFixture(db,{registryValidFrom:validFrom,registryValidUntil:validUntil});await db.query("insert into private.r05_server_keys values($1,$2::timestamptz+interval '30 minutes')",[sha(OWNER_PROOF_KEY),validUntil]);
   const r11=await seedOwnerGrant(db,{validFrom,validUntil});await activateOwnerGrant(db,r11);const f11={businessId:r11.businessId,ownerId:RESEARCH_OWNER,providerProjectId:randomUUID(),key:OWNER_PROOF_KEY};f11.target=readbackTarget(f11);await publishReadback(db,f11.target);assert.equal((await one(db,'select authority_key_hash from private.r11_research_policies where id=$1',[r11.policy.id])).authority_key_hash,sha(OWNER_PROOF_KEY));await deniedUnchanged(db,()=>claimReadback(db,f11),{code:'42501',message:/root_required/});
   const r12=await ownerInitialSqlFixture(db),prepared=await r12.prepare();await r12.server('confirm',r12.confirmPayload(prepared));const f12={businessId:r12.businessId,ownerId:r12.ownerId,providerProjectId:randomUUID(),key:'inert-admission-'+prepared.scopeId};f12.target=readbackTarget(f12);await publishReadback(db,f12.target);assert.equal((await one(db,'select count(*)::int n from private.r12_discovery_authorities where admission_key_hash=$1',[sha(f12.key)])).n,1);await deniedUnchanged(db,()=>claimReadback(db,f12),{code:'42501',message:/root_required/});
   assert.equal(externalCalls,0);
  });
 }finally{globalThis.fetch=savedFetch;}
});

test('actual owner action → genuine SQL claim → one inert Steel GET → saved private proof → six-field owner readback',options,async t=>{
 const db=sharedDatabase,baseline=await readbackCounts(db),restore=withReadbackEnvironment(),savedFetch=globalThis.fetch;let calls=0;
 try{
  await t.test('fresh success and duplicate action/readback preserve one GET and private proof',async()=>{
   const f=await readbackFixture(db),requests=[],ui=readbackOwnerRuntime(db,f);globalThis.fetch=cannedReadback(f,requests);
   safe(await ui.server.readSteelConfigReadback(ui.context,f.businessId,f.target.targetHash),'ready');
   const result=safe(await ui.server.runSteelConfigReadback(ui.context,f.businessId,f.target.targetHash),'verified');assert.equal(requests.length,1);calls++;
   assert.deepEqual(await ui.server.readSteelConfigReadback(ui.context,f.businessId,f.target.targetHash),result);assert.deepEqual(await ui.server.runSteelConfigReadback(ui.context,f.businessId,f.target.targetHash),result);assert.equal(requests.length,1);
   assert.ok([...ui.loaded.keys()].some(x=>x.endsWith('/src/browser/etsy-steel-config-readback.ts')));assert.deepEqual(ui.sqlErrors,[]);
   const stored=await one(db,'select proof,proof_hash from private.r12_steel_readback_results where target_hash=$1',[f.target.targetHash]);assert.equal(stored.proof_hash,result.proofHash);assert.equal(stored.proof.returnedSessionId,f.target.knownSessionId);assert.equal(stored.proof.configurationHash,f.target.configurationHash);assert.equal(stored.proof_hash,hash(stored.proof));assert.doesNotMatch(JSON.stringify(stored),/PRIVATE_SENTINEL|private\.invalid/);
   assert.deepEqual(ui.calls.filter(c=>c.args.p_operation).map(c=>c.args.p_operation),['claim','record','claim']);
  });
  await t.test('lost claim acknowledgement never GETs or renews, and lost record acknowledgement reads the stored proof',async()=>{
   const f=await readbackFixture(db),requests=[],ui=readbackOwnerRuntime(db,f,{afterRpc:({args})=>{if(args.p_operation==='claim')throw Error('Inert lost claim reply');}});globalThis.fetch=cannedReadback(f,requests);
   safe(await ui.server.runSteelConfigReadback(ui.context,f.businessId,f.target.targetHash),'pending');safe(await ui.server.runSteelConfigReadback(ui.context,f.businessId,f.target.targetHash),'pending');assert.equal(requests.length,0);
   const g=await readbackFixture(db),gets=[],lost=readbackOwnerRuntime(db,g,{afterRpc:({args})=>{if(args.p_operation==='record')throw Error('Inert lost record reply');}});globalThis.fetch=cannedReadback(g,gets);
   const result=safe(await lost.server.runSteelConfigReadback(lost.context,g.businessId,g.target.targetHash),'verified');assert.equal(gets.length,1);calls++;assert.deepEqual(await lost.server.runSteelConfigReadback(lost.context,g.businessId,g.target.targetHash),result);assert.equal(gets.length,1);
   assert.deepEqual(lost.calls.map(c=>c.args.p_operation??'read'),['claim','record','read','claim']);
  });
  await t.test('wrong runtime deployment/configuration and mismatched owner claims produce zero GETs',async()=>{
   const f=await readbackFixture(db),requests=[],ui=readbackOwnerRuntime(db,f);globalThis.fetch=cannedReadback(f,requests);const old=process.env.VERCEL_DEPLOYMENT_ID;process.env.VERCEL_DEPLOYMENT_ID='dpl_wrong';try{safe(await ui.server.runSteelConfigReadback(ui.context,f.businessId,f.target.targetHash),'failed');}finally{process.env.VERCEL_DEPLOYMENT_ID=old;}assert.equal(requests.length,0);
   const g=await readbackFixture(db),foreign=readbackOwnerRuntime(db,g,{claimsOwner:randomUUID()});await assert.rejects(foreign.server.runSteelConfigReadback(foreign.context,g.businessId,g.target.targetHash),/unavailable/);assert.equal(foreign.calls.length,0);
   const stale=await readbackFixture(db),successor=await readbackOwner(db),cached=readbackOwnerRuntime(db,stale),none=[];globalThis.fetch=cannedReadback(stale,none);await db.query('update public.businesses set owner_user_id=$2 where id=$1',[stale.businessId,successor.ownerId]);await assert.rejects(cached.server.runSteelConfigReadback(cached.context,stale.businessId,stale.target.targetHash),/unavailable/);assert.equal(none.length,0);assert.ok(cached.sqlErrors.some(e=>e.includes('owner_required')));
  });
  await t.test('definite wrong/revoked existing-root authority rejects instead of reporting safe pending as success',async()=>{
   const f=await readbackFixture(db),requests=[],ui=readbackOwnerRuntime(db,f),old=process.env.R05_ADMISSION_SERVER_KEY;globalThis.fetch=cannedReadback(f,requests);process.env.R05_ADMISSION_SERVER_KEY='inert-unregistered-root-'+randomUUID();try{await assert.rejects(ui.server.runSteelConfigReadback(ui.context,f.businessId,f.target.targetHash),/^SteelReadbackAuthorityUnavailable: Steel configuration readback authority is unavailable\.$/);await assert.rejects(ui.server.cancelSteelConfigReadback(ui.context,f.businessId,f.target.targetHash),/authority is unavailable/);}finally{process.env.R05_ADMISSION_SERVER_KEY=old;}assert.equal(requests.length,0);safe(await ui.server.readSteelConfigReadback(ui.context,f.businessId,f.target.targetHash),'ready');
   const g=await readbackFixture(db),gets=[],revoked=readbackOwnerRuntime(db,g),key='inert-revoked-during-fetch-'+randomUUID();await db.query("insert into private.r05_server_keys values($1,clock_timestamp()+interval '1 day')",[sha(key)]);globalThis.fetch=cannedReadback(g,gets,{fetcher:async()=>{await db.query('insert into private.r05_server_revocations(key_hash) values($1)',[sha(key)]);return Response.json({id:g.target.knownSessionId,projectId:g.providerProjectId,status:'released',createdAt:g.target.expectedCreatedAt});}});process.env.R05_ADMISSION_SERVER_KEY=key;try{await assert.rejects(revoked.server.runSteelConfigReadback(revoked.context,g.businessId,g.target.targetHash),/authority is unavailable/);}finally{process.env.R05_ADMISSION_SERVER_KEY=old;}assert.equal(gets.length,1);calls++;assert.equal((await one(db,'select count(*)::int n from private.r12_steel_readback_results where target_hash=$1',[g.target.targetHash])).n,0);
  });
  await t.test('malformed, oversized and wrong session/project provider replies save only generic failed status',async()=>{
   for(const kind of ['malformed','oversized','wrong-id','wrong-project','new-session','live']){
    const f=await readbackFixture(db),requests=[],ui=readbackOwnerRuntime(db,f);const payload=kind==='wrong-id'?{id:randomUUID()}:kind==='wrong-project'?{projectId:randomUUID()}:kind==='new-session'?{createdAt:f.target.knownBefore}:kind==='live'?{status:'live'}:{};
    globalThis.fetch=cannedReadback(f,requests,{payload,...(kind==='malformed'?{fetcher:async()=>new Response('{PRIVATE_SENTINEL')}:kind==='oversized'?{fetcher:async()=>new Response('x'.repeat(65537))}:{})});
    safe(await ui.server.runSteelConfigReadback(ui.context,f.businessId,f.target.targetHash),'failed');assert.equal(requests.length,1);calls++;safe(await ui.server.runSteelConfigReadback(ui.context,f.businessId,f.target.targetHash),'failed');assert.equal(requests.length,1);
    const row=await one(db,'select proof,proof_hash,reason from private.r12_steel_readback_results where target_hash=$1',[f.target.targetHash]);assert.deepEqual(row,{proof:null,proof_hash:null,reason:'provider_readback_unverified'});
   }
  });
  await t.test('owner cancel before claim, during fetch and caller abort leave no saved proof or second GET',async()=>{
   const f=await readbackFixture(db),requests=[],ui=readbackOwnerRuntime(db,f);globalThis.fetch=cannedReadback(f,requests);safe(await ui.server.cancelSteelConfigReadback(ui.context,f.businessId,f.target.targetHash),'cancelled');safe(await ui.server.runSteelConfigReadback(ui.context,f.businessId,f.target.targetHash),'cancelled');assert.equal(requests.length,0);
   const g=await readbackFixture(db),gets=[],during=readbackOwnerRuntime(db,g);globalThis.fetch=cannedReadback(g,gets,{fetcher:async()=>{safe(await during.server.cancelSteelConfigReadback(during.context,g.businessId,g.target.targetHash),'cancelled');return Response.json({id:g.target.knownSessionId,projectId:g.providerProjectId,status:'released',createdAt:g.target.expectedCreatedAt});}});safe(await during.server.runSteelConfigReadback(during.context,g.businessId,g.target.targetHash),'cancelled');assert.equal(gets.length,1);calls++;assert.equal((await one(db,'select proof from private.r12_steel_readback_results where target_hash=$1',[g.target.targetHash])).proof,null);
   const h=await readbackFixture(db),stop=new AbortController(),abortGets=[],aborted=readbackOwnerRuntime(db,h);globalThis.fetch=cannedReadback(h,abortGets,{fetcher:async()=>{stop.abort();return new Promise(()=>{});}});safe(await aborted.server.runSteelConfigReadback(aborted.context,h.businessId,h.target.targetHash,stop.signal),'cancelled');assert.equal(abortGets.length,1);calls++;
   const j=await readbackFixture(db),pre=new AbortController(),none=readbackOwnerRuntime(db,j);pre.abort();await assert.rejects(none.server.runSteelConfigReadback(none.context,j.businessId,j.target.targetHash,pre.signal));assert.equal(none.calls.length,0);
  });
  const counts=await readbackCounts(db);for(const k of ['attestations','permits','uses','routes','grants','operations'])assert.equal(counts[k],baseline[k]);assert.equal(INERT_READBACK_KEY.startsWith('inert-'),true);assert.equal(calls,11);
 }finally{globalThis.fetch=savedFetch;restore();}
});
