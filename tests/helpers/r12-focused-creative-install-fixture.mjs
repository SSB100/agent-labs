/** Offline fixture only. Substitute explicit production identity/hash literals,
 * retaining the reviewed operator SQL, guards, write set and financial ceiling.
 * No live approval or catalog qualification is represented by synthetic hashes. */
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {TARGET,CATALOG_PINS_SQL,INSTALL_SQL,runOperatorRecipe} from '../../scripts/r12-focused-creative-install.mjs';
import {reviewRecipeClient} from './r12-review-fixture.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const safetyTables=['private.r05_cap_versions','private.r05_policies','private.r05_confirmations','private.r05_operations','private.r05_server_keys','private.r07_server_keys','private.r05_requests','private.r05_settlements','private.r12_focused_creative_scopes','public.workflow_runs','public.creative_approvals','public.creative_runs','private.creative_run_capabilities','public.creative_cost_reservations','public.creative_cost_settlements'];
export async function focusedCreativeInstallationFixture(db,{businessId,ownerId,adoptionId,nested=false,negativeCoverage=false}){
 const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
 const pack=await one("select id from public.packs where pack_key='workflow.etsy-creative-pipeline' and version='1.0.0'");assert.ok(pack);
 const identities=[[TARGET.businessId,businessId],[TARGET.ownerId,ownerId],[TARGET.packId,pack.id]];
 const render=(sql,pins=identities)=>pins.reduce((value,[from,to])=>value.replaceAll(from,to),sql);
 const read=()=>one(render(CATALOG_PINS_SQL)),catalog=await read();assert.equal(catalog.owner_id,ownerId);
 const pins=[...identities,[TARGET.snapshotHash,catalog.snapshot_hash],[TARGET.catalogHash,catalog.catalog_hash]];
 const raw=reviewRecipeClient(db,nested),client={query:(sql,args)=>raw.query(sql===INSTALL_SQL?render(sql,pins):sql,args)};
 const adoption=await one('select proof_hash,proof,private.stage14_hash(result) result_hash,private.stage4_deterministic_uuid(\'r12:focused-creative-installation:\'||id) installation_id from private.r12_focused_adoptions where id=$1',[adoptionId]);assert.ok(adoption);
 const input={version:'r12.focused-creative-install.1',businessId,ownerId,adoptionId,adoptionProofHash:adoption.proof_hash,resultHash:adoption.result_hash,installationId:adoption.installation_id,snapshotHash:catalog.snapshot_hash,catalogHash:catalog.catalog_hash,approvalHash:sha('inert-reviewed-scoped-creative-install'),independentReviewHash:sha('inert-independent-scoped-creative-install'),installBy:adoption.proof.expiresAt,installForFocusedPrivateLearning:true,dispatchAuthorized:false};
 const safety=()=>one(`select jsonb_build_object(${safetyTables.map(table=>`'${table}',coalesce((select jsonb_agg(to_jsonb(row) order by to_jsonb(row)::text) from ${table} row),'[]'::jsonb)`).join(',')}) snapshot`);
 const before=await safety();
 const none=async()=>assert.equal((await one("select count(*)::int n from public.installed_packs where business_id=$1 and root_pack_key='workflow.etsy-creative-pipeline'",[businessId])).n,0);
 await none();
 const reject=async(action,pattern)=>{await db.exec('savepoint creative_install_negative');try{await assert.rejects(action,pattern);}finally{await db.exec('rollback to savepoint creative_install_negative');await db.exec('release savepoint creative_install_negative');}};
 if(negativeCoverage){
  assert.equal(nested,true,'Mutation matrix runs in the isolated parent transaction');
  for(const mutate of [
   x=>x.extraPermission=true,x=>x.businessId=randomUUID(),x=>x.ownerId=randomUUID(),x=>x.adoptionId=randomUUID(),
   x=>x.adoptionProofHash='0'.repeat(64),x=>x.resultHash='0'.repeat(64),x=>x.snapshotHash='0'.repeat(64),x=>x.catalogHash='0'.repeat(64),
   x=>delete x.approvalHash,x=>delete x.independentReviewHash,x=>x.installationId=randomUUID(),x=>x.installBy=new Date(Date.now()-1000).toISOString(),
   x=>x.installBy=new Date(Date.now()+2*86400000).toISOString(),x=>x.installForFocusedPrivateLearning=false,x=>x.dispatchAuthorized=true,
  ]){const bad=structuredClone(input);mutate(bad);await reject(()=>runOperatorRecipe(client,'install',bad));await none();}
  for(const role of ['anon','authenticated','service_role'])await reject(async()=>{await db.exec('set role '+role);await runOperatorRecipe(client,'install',input);},/operator_required|permission denied/);
  await reject(async()=>{await db.query("update public.businesses set owner_user_id='95050000-0000-4000-8000-000000000002' where id=$1",[businessId]);await runOperatorRecipe(client,'install',input);},/owner_changed/);
  await reject(async()=>{await db.query("update public.worker_definitions set name=name||' changed' where pack_id in(select id from public.packs where pack_key='worker.etsy-creative-director')");await runOperatorRecipe(client,'install',input);},/catalog_drift/);
  await reject(async()=>{await db.query("update public.packs set status='qualified' where id=$1",[pack.id]);await runOperatorRecipe(client,'install',input);},/experimental_root_required/);
  for(const [kind,target] of [['business',businessId],['quest',adoption.proof.goalId],['pack',input.installationId]])await reject(async()=>{
   await db.query('insert into private.r05_pause_events(business_id,kind,target_id,paused,actor_id) values($1,$2,$3,true,$4)',[businessId,kind,target,ownerId]);
   await runOperatorRecipe(client,'install',input);
  },/scope_paused|current_completed_plan_required/);
  await reject(async()=>{
   await db.query("update private.r07_heads set state='stopped' where plan_id=$1",[adoption.proof.planId]);
   await runOperatorRecipe(client,'install',input);
  },/current_completed_plan_required/);
  await reject(async()=>{
   await db.query("insert into public.installed_packs(id,business_id,root_pack_id,root_pack_key,status,snapshot) values($1,$2,$3,'workflow.etsy-creative-pipeline','active',jsonb_build_object('fixtureMismatch',true))",[randomUUID(),businessId,pack.id]);
   const existing=await one("select to_jsonb(row) value from public.installed_packs row where business_id=$1 and root_pack_key='workflow.etsy-creative-pipeline'",[businessId]);
   await assert.rejects(runOperatorRecipe(client,'install',input),/already_present_readback_required/);
   assert.deepEqual(await one("select to_jsonb(row) value from public.installed_packs row where business_id=$1 and root_pack_key='workflow.etsy-creative-pipeline'",[businessId]),existing,'Existing mismatched installation must never be overwritten or superseded');
   throw Error('inert_existing_installation_verified');
  },/inert_existing_installation_verified/);
  // Inject transport failure only after the exact unmodified SQL has inserted
  // the installation AND audit event. Verify recipe rollback before any outer
  // fixture cleanup can hide a partial persistent write.
  const failedReadClient={query:async(sql,args)=>{
   if(sql==='select payload from pg_temp.r12_bootstrap_result'){
    assert.equal((await one('select count(*)::int n from public.installed_packs where id=$1',[input.installationId])).n,1);
    assert.equal((await one("select count(*)::int n from public.events where business_id=$1 and event_type='r12.focused.creative.installation_reviewed'",[businessId])).n,1);
    throw Error('inert_result_transport_failure_after_inserts');
   }
   return client.query(sql,args);
  }};
  await assert.rejects(runOperatorRecipe(failedReadClient,'install',input),/inert_result_transport_failure_after_inserts/);
  await none();assert.equal((await one("select count(*)::int n from public.events where business_id=$1 and event_type='r12.focused.creative.installation_reviewed'",[businessId])).n,0);
  assert.deepEqual(await safety(),before,'Both persistent inserts and all other state roll back after result transport failure');
  await reject(()=>db.query('select public.activate_business_pack($1,$2)',[businessId,pack.id]),/unqualified/);
 }
 const installed=await runOperatorRecipe(client,'install',input);
 assert.equal(installed.installationId,input.installationId);assert.equal(installed.authorityCreated,false);assert.equal(installed.shouldDispatch,false);assert.equal(installed.providerCalls,0);
 assert.deepEqual(await safety(),before,'Install cannot create approval, run, cap, policy, verifier, request, settlement or enrollment');
 assert.deepEqual(await read(),catalog,'Every complete catalog row and experimental status remains unchanged');
 const row=await one('select snapshot,status from public.installed_packs where id=$1',[installed.installationId]);assert.equal(row.status,'active');
 assert.equal((await one('select private.stage14_hash($1::jsonb) hash',[row.snapshot])).hash,input.snapshotHash);
 const event=await one("select payload from public.events where business_id=$1 and event_type='r12.focused.creative.installation_reviewed' and payload->'receipt'->>'installationId'=$2",[businessId,installed.installationId]);assert.deepEqual(event.payload,{review:input,receipt:installed});
 if(negativeCoverage){
  await reject(()=>runOperatorRecipe(client,'install',input),/already_present_readback_required/);
  await reject(()=>db.query('select public.activate_business_pack($1,$2)',[businessId,pack.id]),/unqualified/);
  await reject(()=>db.query('select public.begin_installed_pack_run($1,$2,$3,$4,$5,$6,$7)',[businessId,installed.installationId,'etsy.creative-pipeline',{},'inert-generic-install-rejection',randomUUID(),'inert-qualification-only-runtime-0123456789']),/qualified|unqualified|explicit|approval|creative/i);
 }
 return installed;
}
