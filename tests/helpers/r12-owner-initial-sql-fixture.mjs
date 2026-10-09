/** Isolated engineering fixture only. Synthetic catalog grants are not live approvals.
 * Uses the actual migrated owner APIs; no provider/network access or legacy fake
 * terminal record is needed to activate a native Business Goal. */
import assert from 'node:assert/strict';
import {randomUUID,createHash,createHmac} from 'node:crypto';
import {discoveryKnowledgeFixture} from '../discovery-v2-fixtures.mjs';
import {r12QuoteFixture} from './r12-provider-fixture.mjs';
import {buildDiscoveryIntentFromGoal} from '../../.core-tests/products/discovery-v2-goal.js';
import {discoveryV2Hash as hash} from '../../.core-tests/products/discovery-v2.js';
import {preflightDiscoveryR12OwnerPlanner} from '../../.core-tests/products/discovery-r12-planner-preflight.js';
export const OWNER_BOOTSTRAP_KEY='inert-owner-initial-bootstrap-capability-qualification-only';
export const sha=value=>createHash('sha256').update(value).digest('hex');
export const one=async(db,sql,args=[])=>(await db.query(sql,args)).rows[0];
export async function ownerInitialRpc(db,owner,name,args){
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.exec('set role authenticated');
 try{return(await one(db,`select public.${name}(${args.map((_,n)=>'$'+(n+1)).join(',')}) result`,args)).result;}finally{await db.exec('reset role');}
}
export async function ownerInitialRuntimeRpc(db,name,args){
 await db.exec('set role anon');try{return(await one(db,`select public.${name}(${args.map((_,n)=>'$'+(n+1)).join(',')}) result`,args)).result;}finally{await db.exec('reset role');}
}
export async function ownerPreflightPrepared(rpc,businessId,prepared){
 const quote=r12QuoteFixture();
 const input=await rpc('r12_owner_research_preflight',[businessId,prepared.setupId,prepared.setupHash,quote]);
 const receipt=await preflightDiscoveryR12OwnerPlanner(input,quote);
 Object.defineProperty(prepared,'_plannerPreflight',{value:{quote,receipt},enumerable:false});
 return prepared;
}
export function ownerConfirmPayload(prepared){
 const pin=prepared._plannerPreflight;
 assert.ok(pin,'Prepared SQL fixture requires a genuine owner planner preflight');
 return {setupId:prepared.setupId,setupHash:prepared.setupHash,submissionId:randomUUID(),controllerKeyHash:sha('inert-controller-'+prepared.scopeId),admissionKeyHash:sha('inert-admission-'+prepared.scopeId),quote:pin.quote,preflight:pin.receipt};
}
export async function ownerInitialSqlFixture(db,{maximumScopes=4,maximumAllocation=8000000,objective='Investigate original astronomy T-shirt opportunities for adult buyers.',legacy=null,bootstrapRoot=null}={}){
 const ownerId=randomUUID(),businessId=randomUUID(),profileId=randomUUID(),bindingId=randomUUID(),rootId=randomUUID(),grantId=randomUUID();
 await db.query('insert into auth.users(id,email) values($1,$2)',[ownerId,ownerId+'@example.invalid']);
 await db.query('insert into public.businesses(id,owner_user_id,name) values($1,$2,$3)',[businessId,ownerId,'Inert owner-goal research']);
 const bootstrapKey=bootstrapRoot?createHmac('sha256',bootstrapRoot).update(JSON.stringify({version:'r12.owner-bootstrap.1',businessId,ownerId,grantId})).digest('base64url'):OWNER_BOOTSTRAP_KEY;
 const rpc=(name,args)=>ownerInitialRpc(db,ownerId,name,args);
 await rpc('r04_quest_transition',[businessId,'business.save',{expectedRevision:0,content:{brandContext:'Original apparel research',operatingRules:'Bounded costs and independently reviewed outcomes',allowedActivity:'Original POD research only',restrictions:'No commerce or publication'},preference:'setup'},randomUUID()]);
 const businessHash=(await one(db,'select content_hash h from private.r04_business_versions where business_id=$1 and revision=1',[businessId])).h;
 const content={title:'Explore the next original apparel opportunity',originalIntent:objective,objective,parsed:{target:{amount:'1',currency:null,metric:'units'},budget:{amount:'2',currency:'USD'},deadline:{date:new Date(Date.now()+86400000).toISOString().slice(0,10),time:'23:59:59',timezone:'UTC'},scope:'One bounded original POD research packet',geography:['GB'],stopConstraints:['No commerce','Stop on unknown cost']},ambiguities:[]};
 const goal=await rpc('r04_quest_transition',[businessId,'quest.save',{goalId:null,expectedRevision:0,content},randomUUID()]);
 await rpc('r04_quest_transition',[businessId,'quest.preference',{goalId:goal.id,expectedRevision:1,preference:'ready'},randomUUID()]);
 const knowledge=discoveryKnowledgeFixture();
 for(const release of knowledge.snapshot.releases){const existing=await one(db,'select id from public.packs where pack_key=$1 and version=$2',[release.manifest.packKey,release.manifest.version]);if(!existing)await db.query('select private.stage10_register_pack($1)',[release.manifest]);}
 const pack=await one(db,"select id from public.packs where pack_key='workflow.product-discovery-v2' and version='1.0.0'");
 const fd=await one(db,"select id,private.r04_hash(to_jsonb(w)) hash from public.workflow_definitions w where workflow_key='product.discovery-v2.one' and version='1.0.0'");
 const snapshot=(await one(db,"select jsonb_build_object('rootPackId',$1::uuid,'releases',private.stage10_resolve($1,true)) s",[pack.id])).s;
 const snapshotHash=(await one(db,'select private.r04_hash($1) h',[snapshot])).h;
 const workers={};for(const phase of ['plan','search1','select1','strategy','review']){const worker=await one(db,"select id,private.r04_hash(to_jsonb(w)) hash from public.worker_definitions w where worker_key=$1 and version='1.0.0'",['product.discovery-v2.'+(['search1','select1'].includes(phase)?'research':phase)]);workers[phase]=worker;}
 const profile={version:'r12.owner-research-profile.1',id:profileId,title:'Inert reviewed public apparel research',purpose:'Synthetic qualification catalog for public factual apparel snippets; no real demand claim.',marketSets:[{key:'gb',label:'United Kingdom',markets:[{countryCode:'GB',currency:'GBP'}]},{key:'us-gb',label:'United States and United Kingdom',markets:[{countryCode:'US',currency:'USD'},{countryCode:'GB',currency:'GBP'}]}],topics:[{key:'astronomy',label:'Adult astronomy interests',audience:'Adult astronomy enthusiasts',queryTopic:'original astronomy-inspired T-shirt purchase criteria'},{key:'gardening',label:'Adult gardening interests',audience:'Adult gardening enthusiasts',queryTopic:'original gardening-inspired T-shirt purchase criteria'}],queryTemplate:'Find dated aggregate apparel evidence in {{markets}} relevant to {{topic}} for {{audience}}. Preserve date, population and denominator limits.',allowedDomains:['research.example'],excludedDomains:['etsy.com','etsy.me','etsystatic.com'],sourceReviews:[{domain:'research.example',basis:'documented_api_factual_snippets',reviewHash:'a'.repeat(64)}],independentReviewHash:'b'.repeat(64),purposeReviewHash:'c'.repeat(64),maximumRunMicrousd:2000000,validFrom:new Date(Date.now()-60000).toISOString(),validUntil:new Date(Date.now()+86400000).toISOString()};
 const pins={packId:pack.id,snapshot,snapshotHash,workflowDefinitionId:fd.id,workflowHash:fd.hash,plannerWorkerDefinitionId:workers.plan.id,workers,executionReviewHash:'d'.repeat(64),eligibilityReviewHash:'e'.repeat(64),policyInterpretationHash:'f'.repeat(64),knowledgeValidUntil:profile.validUntil};
 await db.query('insert into private.r12_owner_profiles values($1,$2,$3,$4,$5,clock_timestamp())',[profileId,profile,hash(profile),pins,hash(pins)]);
 // Explicit synthetic retained legacy history tests only the old ledger. The
 // application owner-initial lane never inserts product_experiments.
 if(legacy){
  legacy={...legacy,rootId:randomUUID(),semanticHash:hash({original:'synthetic prior original-POD research'})};const wf=randomUUID();
  const intent=buildDiscoveryIntentFromGoal({id:legacy.rootId,businessId,goal:'Research the preserved original geographic apparel opportunity.',maximumMicrousd:2000000,maximumCollections:1});legacy.intent=intent;
  await db.query("insert into public.workflow_runs(id,business_id,workflow_definition_id,idempotency_key,status,input) values($1,$2,$3,$4,'failed',$5)",[wf,businessId,fd.id,'inert-retained-history-'+wf,{intentId:legacy.rootId}]);
  await db.query(`insert into public.product_experiments(id,business_id,workflow_run_id,fingerprint,hypothesis,variables,audience,status,measurement_plan,discovery_version,failure,completed_at) values($1,$2,$3,$4,'Synthetic retained research history',$5,'Adult buyers','failed','{"version":"pod-discovery-2.0","testPlan":null}','pod-discovery-2.0','Inert retained failure',clock_timestamp())`,[legacy.rootId,businessId,wf,sha(legacy.rootId),{intent,policyHash:hash(intent),semanticGoalHash:legacy.semanticHash,budgetAuthorityRootId:legacy.rootId,ownerKickoff:{followUpBasis:null}}]);
  if(legacy.committedMicrounits){for(let left=legacy.committedMicrounits,part=0;left>0;part++){const cost=Math.min(left,1000000);left-=cost;const rid=randomUUID(),receipt='gen-inert-'+rid;
   await db.query('insert into public.product_research_cost_reservations(id,business_id,experiment_id,workflow_run_id,attempt_key,reserved_microusd,request_hash,estimate) values($1,$2,$3,$4,$5,$6,$7,$8)',[rid,businessId,legacy.rootId,wf,['plan:1','search:1','select:1'][part],cost,'3'.repeat(64),{version:'discovery-estimate-2.0'}]);
   if(!legacy.pending){await db.query('insert into private.r05_legacy_attestations(business_id,workflow_run_id,source_key,reported_microusd,provider_request_id,receipt_hash) values($1,$2,$3,$4,$5,$6)',[businessId,wf,'research:'+rid,cost,receipt,'4'.repeat(64)]);
    await db.query('insert into public.product_research_cost_settlements(business_id,reservation_id,reported_microusd,provider_request_id,fingerprint) values($1,$2,$3,$4,$5)',[businessId,rid,cost,receipt,'5'.repeat(64)]);}
  }}
 }
 await db.query("insert into private.r12_owner_funding_bindings(id,business_id,kind,authority_root_id,original_semantic_goal_hash) values($1,$2,$3,$4,$5)",[bindingId,businessId,legacy?'legacy_research_root':'r05_business',legacy?.rootId??businessId,legacy?.semanticHash??null]);
 await db.query('insert into private.r12_owner_grant_roots(id,business_id,binding_id,maximum_scopes,maximum_allocation_microunits,approval_hash) values($1,$2,$3,$4,$5,$6)',[rootId,businessId,bindingId,maximumScopes,maximumAllocation,'1'.repeat(64)]);
 await db.query('insert into private.r12_owner_bootstrap_grants(id,root_id,business_id,owner_id,profile_id,server_key_hash,approval_hash,valid_from,valid_until,business_revision,business_hash) values($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10)',[grantId,rootId,businessId,ownerId,profileId,sha(bootstrapKey),'2'.repeat(64),profile.validFrom,profile.validUntil,businessHash]);
 const input={businessId,goalId:goal.id,goalRevision:2,profileId,profileHash:hash(profile),grantId,marketSetKey:'gb',topicKey:'astronomy',businessLifetimeLimitMicrounits:'6000000',researchLifetimeLimitMicrounits:'6000000',submissionId:randomUUID()};
 const server=async(op,payload,key=bootstrapKey)=>{
  const result=await rpc('r12_owner_research_server',[businessId,op,payload,key]);
  return op==='prepare'||op==='prepare_episode'?ownerPreflightPrepared(rpc,businessId,result):result;
 };
 return {db,ownerId,businessId,businessHash,businessRevision:1,goalId:goal.id,profileId,bindingId,rootId,grantId,profile,pins,input,content,legacy,bootstrapKey,rpc,
 read:(goalId=goal.id,setupId=null)=>rpc('r12_owner_research_read',[businessId,goalId,setupId]),
 server,
 prepare:(changes={})=>server('prepare',{input:{...input,...changes},quote:r12QuoteFixture()}),
 confirmPayload:ownerConfirmPayload};
}
export async function exerciseOwnerInitialSql(db){
 const f=await ownerInitialSqlFixture(db);const read=await f.read();assert.equal(read.profiles.length,1);assert.equal(read.goal.content.objective,f.content.objective);assert.equal(read.funding.binding.kind,'r05_business');
 const prepared=await f.prepare();assert.equal(prepared.confirmed,false);assert.equal(prepared.activated,false);assert.equal(prepared.preview.title,f.content.title);
 assert.equal((await one(db,'select count(*)::int n from private.r12_discovery_scopes')).n,0);
 const confirm=f.confirmPayload(prepared),activated=await f.server('confirm',confirm);assert.equal(activated.activated,true);assert.equal(activated.confirmed,true);assert.equal((await f.server('confirm',confirm)).setupId,activated.setupId);
 const row=await one(db,'select * from private.r12_discovery_scopes where id=$1',[activated.scopeId]);assert.equal(row.origin,'owner_initial');assert.equal(row.prior_round_id,null);assert.equal(row.budget_authority_root_id,null);assert.equal(row.amendment.intent.objective,f.content.objective);assert.equal(row.amendment.fundingApproval.maximumMicrounits,'6000000');
 const counts=await one(db,'select (select count(*)::int from public.product_experiments where business_id=$1) legacy,(select count(*)::int from private.r07_plans where business_id=$1) plans,(select count(*)::int from private.r05_requests where business_id=$1) requests',[f.businessId]);assert.deepEqual(counts,{legacy:0,plans:0,requests:0});
 const workspace=await f.rpc('r12_discovery_owner_read',[f.businessId,activated.scopeId,true]);assert.equal(workspace.version,'r12.discovery-workspace.1');assert.equal(workspace.ownerInitial.fundingKind,'r05_business');assert.equal(workspace.activation.plan.format,'r12.discovery.1');
 const controllerKey='inert-controller-'+prepared.scopeId,admissionKey='inert-admission-'+prepared.scopeId,lease='inert-owner-initial-controller-lease-qualification';
 const planResult=await ownerInitialRuntimeRpc(db,'r07_controller',[f.businessId,f.goalId,'plan',{plan:workspace.activation.plan,expectedVersion:0,reason:'Inert owner Continue',evidenceHash:'9'.repeat(64)},randomUUID(),controllerKey,null,null,admissionKey]);assert.equal(planResult.version,1);
 const claim=await ownerInitialRuntimeRpc(db,'r07_controller',[f.businessId,f.goalId,'claim',{seconds:120},randomUUID(),controllerKey,lease,null,admissionKey]);
 const attemptId=randomUUID();const scheduled=await ownerInitialRuntimeRpc(db,'r07_controller',[f.businessId,f.goalId,'schedule',{stepKey:'plan',attemptId,runtimeCapability:'inert-owner-initial-phase-runtime-capability',reason:'Inert first planner phase',evidenceHash:'8'.repeat(64)},randomUUID(),controllerKey,lease,claim.epoch,admissionKey]);assert.equal(scheduled.attemptId,attemptId);
 const inputs=await ownerInitialRuntimeRpc(db,'r12_discovery_server',[f.businessId,attemptId,'inputs',{},controllerKey]);assert.equal(inputs.version,'r12.discovery-owner-initial-inputs.1');assert.equal(inputs.committedMicrousd,0);assert.equal(inputs.hasUncertainCosts,false);assert.equal(inputs.amendment.intent.objective,f.content.objective);assert.equal('original' in inputs,false);
 const stopped=await f.server('stop',{setupId:prepared.setupId,setupHash:prepared.setupHash,submissionId:randomUUID()},'');assert.equal(stopped.stopped,true);
 return {f,prepared,activated,workspace};
}

export async function exerciseOwnerInitialLegacyFunding(db){
 const f=await ownerInitialSqlFixture(db,{legacy:{committedMicrounits:1900000},bootstrapRoot:OWNER_BOOTSTRAP_KEY});
 const original=await one(db,'select to_jsonb(e) content from public.product_experiments e where id=$1',[f.legacy.rootId]);
 await assert.rejects(f.prepare({researchLifetimeLimitMicrounits:'2000000'}),/funding_limit_insufficient/);
 const prepared=await f.prepare({researchLifetimeLimitMicrounits:'3000000'});assert.equal(prepared.preview.funding.maximumMicrounits,'2000000');assert.equal(prepared.preview.funding.committedMicrounits,'1900000');assert.equal(prepared.preview.finance.changesResearchLimit,true);
 const activated=await f.server('confirm',f.confirmPayload(prepared));assert.equal(activated.activated,true);
 const scope=await one(db,'select * from private.r12_discovery_scopes where id=$1',[activated.scopeId]);assert.equal(scope.budget_authority_root_id,f.legacy.rootId);assert.equal(scope.prior_round_id,f.legacy.rootId);assert.equal(scope.amendment.funding.originalSemanticGoalHash,f.legacy.semanticHash);assert.equal(scope.amendment.intent.objective,f.content.objective);assert.notEqual(scope.amendment.intent.objective,f.legacy.intent.objective);assert.equal(scope.amendment.fundingApproval.maximumMicrounits,'3000000');assert.equal(scope.amendment.fundingApproval.revision,1);assert.ok(scope.amendment.intent.limits.maximumMicrousd<=2000000);
 assert.deepEqual(await one(db,'select to_jsonb(e) content from public.product_experiments e where id=$1',[f.legacy.rootId]),original);
 assert.equal(Number((await one(db,'select private.stage13v2_funded_ceiling($1) n',[f.legacy.rootId])).n),2000000);
 assert.equal((await one(db,'select count(*)::int n from public.product_research_funding_approvals where authority_root_id=$1',[f.legacy.rootId])).n,0);
 const workspace=await f.rpc('r12_discovery_owner_read',[f.businessId,activated.scopeId,false]);assert.equal(workspace.rootFunding.maximumMicrousd,3000000);assert.equal(workspace.rootFunding.committedMicrousd,1900000);assert.equal(workspace.rootFunding.knownActualMicrousd,1900000);assert.equal(workspace.rootFunding.pendingExposureMicrousd,0);assert.equal(workspace.ownerInitial.fundingKind,'legacy_research_root');
 const unknown=await ownerInitialSqlFixture(db,{legacy:{committedMicrounits:1000,pending:true},bootstrapRoot:OWNER_BOOTSTRAP_KEY});await assert.rejects(unknown.prepare(),/unresolved_liability/);
 return {f,prepared,activated};
}

export async function exerciseOwnerInitialPurposeIdentity(db){
 const f=await ownerInitialSqlFixture(db,{bootstrapRoot:OWNER_BOOTSTRAP_KEY});
 const first=await f.prepare({marketSetKey:'us-gb'});await f.server('confirm',f.confirmPayload(first));
 const createGoal=async objective=>{const content={...structuredClone(f.content),originalIntent:objective,objective};const goal=await f.rpc('r04_quest_transition',[f.businessId,'quest.save',{goalId:null,expectedRevision:0,content},randomUUID()]);await f.rpc('r04_quest_transition',[f.businessId,'quest.preference',{goalId:goal.id,expectedRevision:1,preference:'ready'},randomUUID()]);return goal.id;};
 const enroll=async profile=>{const grantId=randomUUID(),key='inert-purpose-profile-capability-'+grantId;
  await db.query('insert into private.r12_owner_profiles values($1,$2,$3,$4,$5,clock_timestamp())',[profile.id,profile,hash(profile),f.pins,hash(f.pins)]);
  await db.query('insert into private.r12_owner_bootstrap_grants(id,root_id,business_id,owner_id,profile_id,server_key_hash,approval_hash,valid_from,valid_until,business_revision,business_hash) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[grantId,f.rootId,f.businessId,f.ownerId,profile.id,sha(key),'6'.repeat(64),profile.validFrom,profile.validUntil,f.businessRevision,f.businessHash]);
  return {grantId,key};};
 const equivalent={...structuredClone(f.profile),id:randomUUID(),title:'Inert equivalent renewed research profile',queryTemplate:'Inspect public factual apparel research about {{topic}} for {{audience}} across {{markets}}; keep source limitations and country boundaries explicit.',marketSets:[{key:'reordered',label:'Equivalent public market set',markets:[{countryCode:'GB',currency:'GBP'},{countryCode:'US',currency:'USD'}]}]};
 equivalent.topics[0]={...equivalent.topics[0],key:'renewed-astronomy',audience:'ADULT  ASTRONOMY ENTHUSIASTS',queryTopic:'ORIGINAL  ASTRONOMY-INSPIRED T-SHIRT PURCHASE CRITERIA'};
 const renewal=await enroll(equivalent);
 const prepare=async(goalId,topicKey='renewed-astronomy',profile=equivalent,grant=renewal)=>f.server('prepare',{input:{...f.input,goalId,profileId:profile.id,profileHash:hash(profile),grantId:grant.grantId,marketSetKey:'reordered',topicKey,submissionId:randomUUID()},quote:r12QuoteFixture()},grant.key);
 const duplicate=await createGoal(f.content.objective.toUpperCase().replaceAll(' ','  '));
 await assert.rejects(prepare(duplicate),/exact_purpose_already_used/);
 assert.equal((await one(db,'select count(*)::int n from private.r12_owner_setups where goal_id=$1',[duplicate])).n,0);
 const differentTopic=await prepare(await createGoal(f.content.objective),'gardening');await f.server('confirm',f.confirmPayload(differentTopic),renewal.key);
 const differentObjective=await prepare(await createGoal('Investigate original astronomy apparel using fabric longevity evidence to reduce product returns.'));await f.server('confirm',f.confirmPayload(differentObjective),renewal.key);
 const audience={...structuredClone(equivalent),id:randomUUID(),topics:[{...equivalent.topics[0],audience:'Adult astronomy educators'}]},audienceGrant=await enroll(audience);
 const differentAudience=await prepare(await createGoal(f.content.objective),'renewed-astronomy',audience,audienceGrant);await f.server('confirm',f.confirmPayload(differentAudience),audienceGrant.key);
 assert.equal((await one(db,'select count(*)::int n from private.r12_owner_activations where grant_root_id=$1',[f.rootId])).n,4);
 assert.notEqual(differentTopic.preview.approvedQuery,first.preview.approvedQuery);
 return {equivalentPurposeRejected:true,distinctTopicObjectiveAndAudienceAccepted:true};
}
