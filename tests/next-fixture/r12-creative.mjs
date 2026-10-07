/** Disposable creative transport/operator support. Owner actions and SQL stay real. */
import assert from 'node:assert/strict';
import {focusedCreativeInstallationFixture} from '../helpers/r12-focused-creative-install-fixture.mjs';
import {r12CatalogFixture} from '../helpers/r12-provider-fixture.mjs';
import {qualifyFocusedCreativeQuote} from '../../.core-tests/creative/focused-quote.js';
import {creativeHash} from '../../.core-tests/creative/contracts.js';
import {reviewRecipeClient} from '../helpers/r12-review-fixture.mjs';

export function r12CreativeCatalogs(now=Date.now()){
 const catalogs=r12CatalogFixture(now);
 // Deliberately synthetic public prices keep this fixture within its existing
 // 10-cent learning-plan ceiling. Production catalog values are never changed.
 const lower=value=>{if(Array.isArray(value)){value.forEach(lower);return;}if(!value||typeof value!=='object')return;for(const key of ['prompt','completion','input_cache_read','input_cache_write','input_cache_write_1h','internal_reasoning'])if(Object.hasOwn(value,key)&&Number(value[key])>0)value[key]='0.00000001';Object.values(value).forEach(lower);};
 Object.values(catalogs).forEach(snapshot=>lower(snapshot.payload));
 for(const model of catalogs.models.payload.data)model.architecture={input_modalities:['text','image'],output_modalities:['text']};
 const image={url:'https://openrouter.ai/api/v1/images/models/black-forest-labs/flux.2-klein-4b/endpoints',fetchedAt:new Date(now-1000).toISOString(),payload:{id:'black-forest-labs/flux.2-klein-4b',endpoints:[{provider_tag:'black-forest-labs',provider_slug:'black-forest-labs',provider_name:'Black Forest Labs',supported_parameters:{aspect_ratio:{type:'enum',values:['1:1']},n:{type:'range',min:1,max:1},output_format:{type:'enum',values:['png']}},pricing:[{billable:'output_image',unit:'megapixel',cost_usd:.014}]}]}};
 return{catalogs,image};
}
export function r12CreativeQuote(now=Date.now()){const{catalogs,image}=r12CreativeCatalogs(now);return qualifyFocusedCreativeQuote(catalogs,image,true,now);}
export function r12CreativeCatalog(state,input){
 assert.equal(input.method,'GET');assert.equal(input.body,undefined);
 const{catalogs,image}=r12CreativeCatalogs(),snapshot=[...Object.values(catalogs),image].find(item=>item.url===input.url);assert.ok(snapshot,'Exact inert public creative catalog URL required');
 state.r12.creative.catalogReads++;return snapshot.payload;
}
export async function seedR12Creative(r){
 assert.ok((await r.db.query("select to_regprocedure('public.adopt_r12_focused_test(uuid,jsonb,jsonb)') id")).rows[0].id,'Focused adoption migration must be present in the captured SQL fixture');
 assert.equal((await r.db.query("select count(*)::int n from public.installed_packs where business_id=$1 and root_pack_key='workflow.etsy-creative-pipeline'",[r.businessId])).rows[0].n,0,'No fixture installation may precede accepted TEST adoption');
 r.creative={installationId:null,catalogReads:0,launches:[],staged:null,activated:null};
}
export async function controlR12Creative(r,input){
 const{runOperatorRecipe}=await import('../../scripts/r12-focused-creative-bootstrap.mjs');
 if(input.r12CreativeInstall){
  assert.equal(r.creative.installationId,null);
  const adopted=(await r.db.query('select id from private.r12_focused_adoptions where business_id=$1 and candidate_id=$2',[r.businessId,input.r12CreativeInstall.candidateId])).rows;assert.equal(adopted.length,1);
  const installed=await focusedCreativeInstallationFixture(r.db,{businessId:r.businessId,ownerId:r.ownerId,adoptionId:adopted[0].id});
  r.creative.installationId=installed.installationId;r.creative.installationReceipt=installed;
 }
 if(input.r12CreativeStage){
  assert.ok(!r.creative.staged);const preparation=input.r12CreativeStage;assert.equal(preparation.businessId,r.businessId);assert.equal(preparation.dispatchAuthorized,false);
  const phaseKeys=['brief:1','screen:1','generate:1','review:1'];
  r.creative.preparation=preparation;
  r.creative.staged=await runOperatorRecipe(reviewRecipeClient(r.db),'stage',{preparation,quote:r12CreativeQuote(),sourceDomains:['printful.com'],dataClassesByPhase:Object.fromEntries(phaseKeys.map(key=>[key,key==='review:1'?['business_context','private_image']:['business_context']])),executionReviewHash:creativeHash({fixture:'r12-next-creative-execution'}),eligibilityReviewHash:creativeHash({fixture:'r12-next-creative-eligibility'}),interpretationHash:creativeHash({fixture:'r12-next-creative-interpretation'})});
 }
 if(input.r12CreativeActivate){
  assert.ok(r.creative.staged&&!r.creative.activated);const{policyId,policyHash}=input.r12CreativeActivate;
  r.creative.activated=await runOperatorRecipe(reviewRecipeClient(r.db),'activate',{preparation:r.creative.preparation,stageHash:r.creative.staged.stageHash,policyId,policyHash,quote:r12CreativeQuote()});
 }
}
export async function launchR12Creative(r,input){
 const value=input.input;assert.ok(value&&typeof value==='object');assert.deepEqual(Object.keys(value).sort(),['businessId','coreWorkflowRunId','creativeRunId','runtimeCapability']);assert.equal(value.businessId,r.businessId);
 assert.ok(!r.creative.launches.includes(value.creativeRunId),'The durable launch boundary must run once');
 await r.db.exec('set role anon');let data;
 try{data=(await r.db.query("select public.creative_runtime_transition($1,$2,$3,'load',$4) result",[value.creativeRunId,value.businessId,value.runtimeCapability,{runtimeRunId:'inert-next-creative-'+value.coreWorkflowRunId}])).rows[0].result;}finally{await r.db.exec('reset role');}
 assert.equal(data.status,'running');r.creative.launches.push(value.creativeRunId);
 return{runId:'inert-next-creative-'+value.coreWorkflowRunId};
}
