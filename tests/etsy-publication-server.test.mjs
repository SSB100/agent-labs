import { ownerBusiness, historyRead, historyResponse } from './helpers/history-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {publicationFixture} from './etsy-publication-fixtures.mjs';
const require=createRequire(import.meta.url),ts=require('typescript');
const C=require('../.core-tests/etsy/contracts.js'),V=require('../.core-tests/etsy/vault.js');
function harness({rpc=async(_name,args)=>({data:{drafts:[],runs:args.p_query?.interventionId?[{...publicationFixture().state,title:'Synthetic historical publication'}]:[]}}),engine=async()=>({status:'verified'})}={}){
 const calls=[],context={businesses:[],supabase:{rpc:async(name,args)=>{calls.push({name,args});const response=await rpc(name,args);if(name==='r06_read'&&response?.data&&!('items' in response.data)){const rows=args.p_dataset==='publication_runs'?response.data.runs:response.data.drafts;return historyResponse(args,rows,{selected:args.p_query?.interventionId?rows?.[0]:null});}return response;}}};
 const deps={'../lib/core-ui/owner-business':ownerBusiness,'../lib/core-ui/history-read':historyRead,'server-only':{},'../core/existing-effect-read':require('../.core-tests/core/existing-effect-read.js'),'../lib/existing-effect-read-runtime':{requireExistingEffectReadEligibility:async()=>{throw new Error('existing_effect_read_not_authorized');}},'node:crypto':require('node:crypto'),'../etsy/server':{etsyConfigured:()=>false,etsyConfig:()=>({serverKey:'synthetic-server-authority',vaultKey:'1'.repeat(64),keystring:'fixture',sharedSecret:'fixture'}),ownerBusiness:(ctx,id)=>C.requireEtsy(ctx.businesses.some(b=>b.id===id),'owner_required'),resolveEtsyConnection:async()=>{throw new Error('unexpected connection lookup');}},'../etsy/contracts':C,'../etsy/vault':V,'../listing/intake':require('../.core-tests/listing/intake.js'),'./adapter':{EtsyPublicationAdapter:class{}},'./engine':{executeEtsyPublication:engine},'./contracts':require('../.core-tests/etsy-publication/contracts.js'),'./policy':require('../.core-tests/etsy-publication/policy.js')};
 const code=ts.transpileModule(readFileSync('src/etsy-publication/server.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,m={exports:{}};
 runInNewContext(`(function(require,module,exports){${code}\n})`)(name=>{assert.ok(name in deps,`Unexpected dependency ${name}`);return deps[name];},m,m.exports);return{...m.exports,context,calls};
}
function sourceFixture(){
 const f=publicationFixture(),p=f.p,key='1'.repeat(64),review={version:'synthetic-transport-test',productPackageHash:C.hash(p),outputArtifactId:p.id,publicationAllowed:false},receipt={id:f.draft.receiptId,response_summary:{imageMappings:f.draft.imageMappings}};
 const source={package:p,draft:f.draft,draftReceipt:receipt,draftReceiptHash:C.hash(receipt),review,reviewHash:C.hash(review),packageHash:C.hash(p),packageEnvelope:V.seal(p,`product-package:${p.businessId}:${p.id}`,key),reviewEnvelope:V.seal(review,`listing-review:${p.businessId}:${p.id}`,key),connectionId:f.connection.connectionId,connectionRevision:f.connection.revision,shopId:f.connection.shopId};
 source.artifactContent={etsyDraftEnvelope:source.packageEnvelope,listingReviewEnvelope:source.reviewEnvelope};return{f,source,key};
}
test('publication workspace is owner scoped and unavailable records are not fabricated',async()=>{
 const h=harness({rpc:async()=>({error:{message:'private database detail'}})}),f=publicationFixture();h.context.businesses=[{id:f.p.businessId}];const view=await h.loadPublicationWorkspace(h.context,f.p.businessId);assert.equal(view.unavailable,true);assert.equal(view.feeReadiness.available,false);assert.ok(h.calls.every(c=>c.name==='r06_read'&&!('p_server_key' in c.args)));await assert.rejects(h.loadPublicationWorkspace(h.context,'foreign'),/owner_required/);assert.equal(h.calls.length,2);
});
test('current fee absence blocks even fully consented, structurally exact approval before any RPC or provider call',async()=>{
 const h=harness(),f=publicationFixture();h.context.businesses=[{id:f.p.businessId}];const bindings=Object.fromEntries(['packageHash','reviewHash','preflightHash','disclosureHash','feeQuoteHash'].map(k=>[k,'a'.repeat(64)]));await assert.rejects(h.beginEtsyPublication(h.context,f.p.businessId,f.draft.runId,bindings,{publication:true,publicData:true,fee:true,renewal:true}),/publication_fee_evidence_required|publication_policy_refresh_required/);assert.equal(h.calls.length,0);
});
test('server rejects missing exact review bindings rather than generating an unseen approval',async()=>{
 const h=harness(),f=publicationFixture();h.context.businesses=[{id:f.p.businessId}];await assert.rejects(h.beginEtsyPublication(h.context,f.p.businessId,f.draft.runId,{packageHash:'a'.repeat(64),reviewHash:'',preflightHash:'',disclosureHash:'',feeQuoteHash:''},{publication:true,publicData:true,fee:true,renewal:true}),/publication_review_required/);assert.equal(h.calls.length,0);
});
test('historical reconciliation authenticates exact product and review seals without inventing current competence',()=>{
 const h=harness(),{source,key}=sourceFixture();const value=h.authenticatePublicationSource(source,source.package.businessId,'reconcile',key);assert.equal(value.packageHash,source.packageHash);assert.throws(()=>h.authenticatePublicationSource(source,source.package.businessId,'publish',key),/live_listing_review_required/);
});
test('reconciliation rejects foreign business, edited package, review, receipt or envelope binding',()=>{
 const h=harness(),{source,key}=sourceFixture();
 for(const change of [s=>s.package.title='Altered',s=>s.review.productPackageHash='b'.repeat(64),s=>s.draftReceipt.response_summary.imageMappings=[],s=>s.artifactContent.etsyDraftEnvelope='owner-invented']){const value=structuredClone(source);change(value);assert.throws(()=>h.authenticatePublicationSource(value,value.package.businessId,'reconcile',key));}
 assert.throws(()=>h.authenticatePublicationSource(source,'18000000-1111-4111-8111-999999999999','reconcile',key));
});
test('read-only reconcile cannot dispatch an unattempted ready publication and releases its lease',async()=>{
 const f=publicationFixture();let engines=0;const h=harness({rpc:async(_,{p_operation})=>({data:p_operation==='acquire'?{state:f.state,revision:0}:{}}),engine:async()=>{engines++;return{status:'verified'};}});h.context.businesses=[{id:f.p.businessId}];await assert.rejects(h.runEtsyPublication(h.context,f.p.businessId,f.state.id,true),/publication_not_dispatched/);assert.deepEqual(h.calls.map(c=>c.args.p_operation),['acquire','release']);assert.equal(engines,0);assert.ok(h.calls.every(c=>c.args.p_business_id===f.p.businessId&&c.args.p_payload.runId===f.state.id));
});
test('RPC failures are redacted rather than leaking SQL/provider bodies',async()=>{
 const h=harness({rpc:async()=>({error:{message:'secret provider response'}})}),f=publicationFixture();h.context.businesses=[{id:f.p.businessId}];await assert.rejects(h.publicationRpc(h.context,f.p.businessId,'cancel',{runId:f.state.id}),error=>error.code==='publication_state_unavailable'&&!error.message.includes('secret'));assert.equal(h.calls[0].args.p_server_key,'');
});

test('malformed acquired scope is released once and never reaches the engine',async()=>{
 const f=publicationFixture();let engines=0;const h=harness({rpc:async(_,{p_operation})=>({data:p_operation==='acquire'?{state:{...f.state,businessId:'foreign'},revision:0}:{}}),engine:async()=>{engines++;return{status:'verified'};}});h.context.businesses=[{id:f.p.businessId}];await assert.rejects(h.runEtsyPublication(h.context,f.p.businessId,f.state.id,true),/publication_scope_mismatch/);assert.deepEqual(h.calls.map(c=>c.args.p_operation),['acquire','release']);assert.equal(engines,0);
});
test('absent or malformed activation checkpoint cannot make read-only reconciliation dispatch',async()=>{
 for(const activation of [undefined,'sent',[]]){const f=publicationFixture();let engines=0;const h=harness({rpc:async(_,{p_operation})=>({data:p_operation==='acquire'?{state:{...f.state,activation},revision:0}:{}}),engine:async()=>{engines++;return{status:'verified'};}});h.context.businesses=[{id:f.p.businessId}];await assert.rejects(h.runEtsyPublication(h.context,f.p.businessId,f.state.id,true),/publication_not_dispatched/);assert.deepEqual(h.calls.map(c=>c.args.p_operation),['acquire','release']);assert.equal(engines,0);}
});

test('repository merges authoritative concurrent stop and provider observations after CAS writes',async()=>{
 const f=publicationFixture();let revision=0;const h=harness({rpc:async(_,{p_operation})=>({data:p_operation==='acquire'?{state:structuredClone(f.state),revision}:p_operation==='save'?{state:{...f.state,status:'needs_owner',stopRequested:true,providerState:'active'},revision:++revision}:{}})});h.context.businesses=[{id:f.p.businessId}];const repo=h.publicationRepository(h.context,f.p.businessId,f.state.id),state=await repo.acquire();await repo.save(state);assert.equal(state.stopRequested,true);assert.equal(state.providerState,'active');assert.equal(state.status,'needs_owner');await repo.release();assert.equal(h.calls[1].args.p_payload.revision,0);
});

test('publication Needs You reads remain owner scoped without workflow links and surface partial failure',async()=>{
 const h=harness(),f=publicationFixture(),queries=[];h.context.businesses=[{id:f.p.businessId}];let result={data:[{id:'intervention',business_id:f.p.businessId,workflow_run_id:null,intervention_type:'etsy.publication.reconcile',status:'open'}],count:1,error:null};
 h.context.supabase.from=table=>{queries.push(['from',table]);const query={select(...args){queries.push(['select',...args]);return this;},in(...args){queries.push(['in',...args]);return this;},eq(...args){queries.push(['eq',...args]);return this;},order(...args){queries.push(['order',...args]);return this;},async limit(...args){queries.push(['limit',...args]);return result;}};return query;};
 const value=await h.loadPublicationInterventions(h.context);assert.equal(value.records.length,1);assert.equal(value.records[0].workflow_run_id,null);assert.equal(value.unavailable,false);assert.ok(queries.some(q=>q[0]==='in'&&q[1]==='business_id'&&q[2][0]===f.p.businessId));assert.ok(queries.some(q=>q[0]==='eq'&&q[1]==='status'&&q[2]==='open'));
 result={data:[],count:0,error:{message:'private detail'}};assert.equal((await h.loadPublicationInterventions(h.context)).unavailable,true);
 result={data:[{business_id:'foreign',intervention_type:'etsy.publication.reconcile',status:'open'}],count:1,error:null};assert.equal((await h.loadPublicationInterventions(h.context)).records.length,0);
 for(const count of [2,null,undefined,-1,0.5,'0']){result={data:[],count,error:null};assert.equal((await h.loadPublicationInterventions(h.context)).unavailable,true);}
});

test('publication history forwards only a valid hidden intervention target for authoritative owner resolution',async()=>{
 const h=harness(),f=publicationFixture();h.context.businesses=[{id:f.p.businessId}];const target=f.draft.receiptId;const view=await h.loadPublicationWorkspace(h.context,f.p.businessId,target);assert.equal(view.unavailable,false);assert.equal(h.calls[0].args.p_query.interventionId,target);assert.ok(h.calls.every(c=>c.name==='r06_read'&&!('p_server_key' in c.args)));const invalid=await h.loadPublicationWorkspace(h.context,f.p.businessId,'arbitrary-path');assert.equal(invalid.unavailable,true);assert.equal(h.calls.length,2);
});
