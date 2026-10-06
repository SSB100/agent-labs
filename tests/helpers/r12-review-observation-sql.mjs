/** Draft fixture assertions. Invoke only in an isolated SQL fixture after the
 * actual review request is admitted, marked, wire-bound and transport-claimed,
 * before its candidate is staged. All writes are rolled back. No HTTP is used.
 * Parent integrates this helper with its fixture; it is not run by check.mjs. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
export async function assertR12ResponseObservationSql(db,{businessId,attemptId,scopeId,controller},{nested=false}={}){
 const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
 const binding=await one('select b.request_id,b.wire_hash from private.r07_bindings b where b.attempt_id=$1 and b.business_id=$2',[attemptId,businessId]);
 assert.ok(binding);const requestId=binding.request_id,identity={scopeId,attemptId,requestId};
 const hash=text=>createHash('sha256').update(text).digest('hex');
 const observation=content=>({...identity,version:'r12.review-observation.1',receivedAt:new Date().toISOString(),providerRequestId:'gen-r12-observation-sql',providerModelId:'unknown/unqualified-model',finishReason:'length',nativeFinishReason:null,contentState:'complete',content,contentBytes:Buffer.byteLength(content),contentHash:hash(content)});
 const diagnostic=(observationSaved=false)=>({...identity,version:'r12.review-diagnostic.1',recordedAt:new Date().toISOString(),code:'response_schema',httpStatus:null,observationSaved,issues:[{path:'$.checks[0].rationale',constraint:'max_length',limit:240}]});
 const rpc=async(op,payload,key=controller)=>{
  await db.exec('savepoint response_rpc');
  try{
   await db.exec('set role anon');
   const result=(await one('select public.r12_discovery_server($1,$2,$3,$4,$5) result',[businessId,attemptId,op,payload,key])).result;
   await db.exec('reset role');await db.exec('release savepoint response_rpc');return result;
  }catch(error){await db.exec('rollback to savepoint response_rpc');await db.exec('reset role');await db.exec('release savepoint response_rpc');throw error;}
 };
 const put=async(kind,payload)=>{const key=kind==='observe'?'observation':'diagnostic';return rpc(kind,{[key]:payload,[key+'Hash']:(await one('select private.stage14_hash($1::jsonb) hash',[payload])).hash});};
 const reset=async()=>{await db.exec('rollback to savepoint response_scenario');};
 await db.exec(nested?'savepoint response_suite':'begin');
 try{
  assert.equal((await one('select count(*)::int n from private.r12_discovery_response_observations where request_id=$1',[requestId])).n,0);
  assert.equal((await one('select count(*)::int n from private.r12_discovery_candidates where request_id=$1',[requestId])).n,0);
  const counters=await one('select (select count(*)::int from private.r12_discovery_transport_claims) claims,(select count(*)::int from private.r12_discovery_receipt_checks) receipt_checks,(select count(*)::int from private.r07_responses) responses,(select count(*)::int from public.artifacts) artifacts');
  await db.exec('savepoint response_scenario');

  // Diagnostic persists truthfully even when observation persistence failed.
  await assert.rejects(put('diagnose',diagnostic(true)),/diagnostic_invalid/);
  const rejected=diagnostic(false);assert.equal((await put('diagnose',rejected)).replayed,false);assert.equal((await put('diagnose',rejected)).replayed,true);
  await assert.rejects(put('diagnose',{...rejected,code:'response_size',issues:[]}),/response_conflict/);
  await assert.rejects(put('observe',observation('Late completion must stay absent')),/already_rejected/);
  const failed=await rpc('load',{});assert.equal(failed.observationSaved,false);assert.deepEqual(failed.diagnostic,rejected);assert.equal(failed.candidate,null);
  await reset();

  // Invalid and wrong-identity output is unqualified evidence, never a candidate.
  const sentinel='UNQUALIFIED_RESPONSE_SENTINEL',received=observation(sentinel);
  assert.equal((await put('observe',received)).replayed,false);assert.equal((await put('observe',received)).replayed,true);
  await assert.rejects(put('observe',{...received,content:'Different content',contentBytes:17,contentHash:hash('Different content')}),/response_conflict/);
  await assert.rejects(put('diagnose',diagnostic(false)),/diagnostic_invalid/);
  assert.equal((await put('diagnose',diagnostic(true))).saved,true);
  const load=await rpc('load',{});assert.equal(load.observationSaved,true);assert.equal(load.candidate,null);assert.equal(JSON.stringify(load).includes(sentinel),false);
  await db.exec('set role authenticated');
  const view=await one('select public.r12_discovery_owner_read($1,$2,false) result',[businessId,scopeId]);await db.exec('reset role');
  const phase=view.result.phases.find(p=>p.phase==='review');assert.equal(phase.candidateSaved,false);assert.equal(phase.receipt,null);assert.equal(phase.responseObservation.contentHash,hash(sentinel));assert.equal(phase.responseDiagnostic.code,'response_schema');assert.equal(JSON.stringify(view).includes(sentinel),false);
  await assert.rejects(rpc('claim',{candidateHash:hash(sentinel)}),/candidate_required/);
  assert.equal((await rpc('send',{wireHash:binding.wire_hash})).shouldDispatch,false);
  assert.deepEqual(await one('select (select count(*)::int from private.r12_discovery_transport_claims) claims,(select count(*)::int from private.r12_discovery_receipt_checks) receipt_checks,(select count(*)::int from private.r07_responses) responses,(select count(*)::int from public.artifacts) artifacts'),counters);
  await reset();

  // UTF-8 bytes, rather than JS characters; no truncated completion retention.
  const boundary=observation('é'.repeat(8192));assert.equal((await put('observe',boundary)).saved,true);
  assert.equal((await one("select payload->>'content' content from private.r12_discovery_response_observations where request_id=$1 and kind='received'",[requestId])).content,boundary.content);await reset();
  const tooLarge=observation('é'.repeat(8193));await assert.rejects(put('observe',tooLarge),/content_invalid/);
  const oversized={...tooLarge,content:null,contentState:'oversized'};assert.equal((await put('observe',oversized)).saved,true);
  assert.deepEqual((await one("select payload from private.r12_discovery_response_observations where request_id=$1 and kind='received'",[requestId])).payload,oversized);await reset();
  const credential=observation('token=INERT_FIXTURE_DO_NOT_RETAIN');await assert.rejects(put('observe',credential),/content_invalid/);
  const redacted={...credential,content:null,contentState:'redacted'};assert.equal((await put('observe',redacted)).saved,true);await reset();
  for(const content of [JSON.stringify({password:'INERT_FIXTURE_DO_NOT_RETAIN'}),'password\u00a0=INERT_FIXTURE_DO_NOT_RETAIN','password\ufeff=INERT_FIXTURE_DO_NOT_RETAIN','épassword=INERT_FIXTURE_DO_NOT_RETAIN','"password"\u00a0:"INERT_FIXTURE_DO_NOT_RETAIN"','"password"\ufeff:"INERT_FIXTURE_DO_NOT_RETAIN"','{"pass'+String.fromCharCode(92,10)+'word":"INERT_FIXTURE_DO_NOT_RETAIN"}',JSON.stringify({api_key:'INERT_FIXTURE_DO_NOT_RETAIN'}),'{"pass\\u0077ord":"INERT_FIXTURE_DO_NOT_RETAIN"}','{"nested":{"access-token":"INERT_FIXTURE_DO_NOT_RETAIN"}}','{"API Key":"INERT_FIXTURE_DO_NOT_RETAIN"','malformed {"client\\u005fsecret":"INERT_FIXTURE_DO_NOT_RETAIN",','{"invalid\\q":"INERT_FIXTURE_DO_NOT_RETAIN"}']){
   const rejectedContent=observation(content);await assert.rejects(put('observe',rejectedContent),/content_invalid/);
   const safeContent={...rejectedContent,content:null,contentState:'redacted'};assert.equal((await put('observe',safeContent)).saved,true);
   const saved=(await one("select payload from private.r12_discovery_response_observations where request_id=$1 and kind='received'",[requestId])).payload;assert.deepEqual(saved,safeContent);assert.equal(JSON.stringify(saved).includes('INERT_FIXTURE_DO_NOT_RETAIN'),false);await reset();
  }
  for(const contentState of ['missing','unsupported']){assert.equal((await put('observe',{...observation(''),contentState,content:null,contentHash:null})).saved,true);await reset();}

  // Exact keys, hash, identity, time and bounded safe diagnostic vocabulary.
  for(const change of [{requestId:randomUUID()},{scopeId:randomUUID()},{attemptId:randomUUID()},{headers:{authorization:'Not retained'}},{prompt:'Not retained'},{receivedAt:'infinity'},{receivedAt:'2000-01-01T00:00:00.000Z'},{receivedAt:'2099-01-01T00:00:00.000Z'},{providerRequestId:'unrecognized-id'},{contentBytes:100},{contentHash:'0'.repeat(64)}])await assert.rejects(put('observe',{...observation('inert text'),...change}));
  await assert.rejects(rpc('observe',{observation:observation('inert text'),observationHash:'0'.repeat(64)}),/identity_invalid/);
  for(const change of [{observationSaved:true},{code:'arbitrary_message'},{message:'Full provider error'},{httpStatus:600},{issues:Array(13).fill({path:'$',constraint:'shape',limit:null})},{issues:[{path:'$.model_supplied_secret',constraint:'shape',limit:null}]},{issues:[{path:'$',constraint:'full provider message',limit:null}]},{issues:[{path:'$',constraint:'shape',limit:1}]},{issues:[{path:'$',constraint:'max_length',limit:1000001}]}])await assert.rejects(put('diagnose',{...diagnostic(false),...change}));
  assert.equal((await one('select count(*)::int n from private.r12_discovery_response_observations where request_id=$1',[requestId])).n,0);

  // Row/hash history cannot be mutated even by the fixture owner.
  await put('observe',observation('Immutable inert text'));
  await db.exec('savepoint immutable_case');await assert.rejects(db.query("update private.r12_discovery_response_observations set payload_hash=repeat('0',64) where request_id=$1",[requestId]),/immutable/);await db.exec('rollback to savepoint immutable_case');
  await assert.rejects(db.query('delete from private.r12_discovery_response_observations where request_id=$1',[requestId]),/immutable/);await db.exec('rollback to savepoint immutable_case');await db.exec('release savepoint immutable_case');
  for(const role of ['anon','authenticated','service_role']){const acl=await one("select has_table_privilege($1,'private.r12_discovery_response_observations','SELECT') can_read,has_table_privilege($1,'private.r12_discovery_response_observations','INSERT') can_write",[role]);assert.deepEqual(acl,{can_read:false,can_write:false});}
  return{actualRpcAssertions:true,providerCalls:0,persistedFixtureWrites:0};
 }finally{await db.exec(nested?'rollback to savepoint response_suite':'rollback');if(nested)await db.exec('release savepoint response_suite');}
}
