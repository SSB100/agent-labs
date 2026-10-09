import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {renderedResearchForm,researchHtmlText} from './r11-http.mjs';
import {r12OwnerRpc} from './r12-sql.mjs';

/** Actual Next HTTP/action/SQL verification. Does not substitute for hydration,
 * keyboard, viewport, navigation-history or real browser interaction checks. */
export async function runOwnerInitialHttp({origin,boundary,output,fixture}) {
  const manifest=JSON.parse(await readFile(path.join(fixture,'.next/server/server-reference-manifest.json'),'utf8'));
  const results=[];
  const report=()=>writeFile(path.join(output,'http-acceptance.json'),JSON.stringify({results,browser:'unrun HTTP-only',network:'loopback only; synthetic providers and isolated SQL',purpose:'technical transport verification'},null,2));
  const check=async(name,work)=>{console.log('START:',name);try{await work();results.push({name,status:'passed'});console.log('PASS:',name);}catch(error){results.push({name,status:'failed',error:String(error.stack??error)});await report();throw error;}await report();};
  const control=async kind=>{const response=await fetch(boundary.origin+'/control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({r12Scenario:`owner-initial-${kind}`,r12DelayReceipt:false}),signal:AbortSignal.timeout(90000)});assert.equal(response.status,200,await response.text());};
  const current=()=>boundary.state().r12;
  const route=(goalId=current().goalId,setupId)=>`/dashboard/quests/research?business=${current().businessId}${goalId?`&quest=${goalId}`:''}${setupId?`&setup=${setupId}`:''}`;
  const read=async href=>{const response=await fetch(origin+href,{signal:AbortSignal.timeout(30000)});assert.equal(response.status,200);return response.text();};
  const catalog=async(goalId=current().goalId,setupId=null)=>{const result=await r12OwnerRpc(boundary.state(),'r12_owner_research_read',{p_business_id:current().businessId,p_goal_id:goalId,p_setup_id:setupId});assert.equal(result.error,null);return result.data;};
  async function action(name,args,href=route()) {
    const entries=Object.entries(manifest.node).filter(([,action])=>action.exportedName===name);assert.equal(entries.length,1,`Exact generated action ${name}`);
    const response=await fetch(origin+href,{method:'POST',headers:{origin,'next-action':entries[0][0],accept:'text/x-component','content-type':'text/plain;charset=UTF-8'},body:JSON.stringify(args),signal:AbortSignal.timeout(60000)});
    assert.equal(response.status,200);const body=await response.text();
    const values=body.split('\n').flatMap(line=>{const index=line.indexOf(':');if(index<0)return[];try{return[JSON.parse(line.slice(index+1))];}catch{return[];}});
    const result=values.find(value=>value&&typeof value==='object'&&typeof value.ok==='boolean');assert.ok(result,`Action ${name} must return its own success/failure receipt`);return result;
  }
  let goalId,receipt;
  await control('native');
  await check('real Next GET selects no default Goal, preserves auth gating and performs zero mutation',async()=>{
    const html=researchHtmlText(await read(route(null)));assert.match(html,/Choose your saved objective/);assert.doesNotMatch(html,/Review this exact research packet/);assert.deepEqual(current().calls,[]);
    const missing=researchHtmlText(await read(route(randomUUID())));assert.match(missing,/No substitute was selected/);assert.doesNotMatch(missing,/Reviewed research profile/);
    const missingSetup=researchHtmlText(await read(route(current().goalId,randomUUID())));assert.match(missingSetup,/No substitute was selected/);
    const foreign=await fetch(`${origin}/dashboard/quests/research?business=${randomUUID()}&quest=${current().goalId}`,{redirect:'manual',signal:AbortSignal.timeout(30000)});assert.equal(foreign.status,404);await foreign.body?.cancel();
    const signedOut=await fetch(origin+route(),{headers:{cookie:'r03-session=off'},redirect:'manual',signal:AbortSignal.timeout(30000)});assert.ok([303,307].includes(signedOut.status));assert.match(signedOut.headers.get('location'),/login/);await signedOut.body?.cancel();
  });
  await check('actual R04 server actions save and ready the genuine technical objective',async()=>{
    const content={...current().goalContent,title:'HTTP-created technical astronomy Quest',objective:'Investigate the next original adult astronomy T-shirt question. Synthetic technical intent only; no demand claim.',originalIntent:'Investigate the next original adult astronomy T-shirt question. Synthetic technical intent only; no demand claim.'};
    const created=await action('saveQuestIntent',[current().businessId,'quest.save',{goalId:null,expectedRevision:0,content},randomUUID()],`/dashboard/quests?business=${current().businessId}`);assert.equal(created.ok,true,created.message);goalId=created.result.id;
    const ready=await action('saveQuestIntent',[current().businessId,'quest.preference',{goalId,expectedRevision:1,preference:'ready'},randomUUID()],`/dashboard/quests?business=${current().businessId}&quest=${goalId}`);assert.equal(ready.ok,true,ready.message);
    const html=researchHtmlText(await read(route(goalId)));assert.match(html,/HTTP-created technical astronomy Quest/);assert.match(html,/Proposed Business lifetime limit/);assert.doesNotMatch(html,/Proposed original cumulative research limit/);
  });
  await check('new authenticated preparation returns one exact packet and idempotent retry without dispatch',async()=>{
    const input={...current().initialInput,goalId,goalRevision:2,submissionId:randomUUID()};
    const prepared=await action('prepareOwnerResearchAction',[input],route(goalId));assert.equal(prepared.ok,true,prepared.message);receipt=prepared.receipt;
    const repeated=await action('prepareOwnerResearchAction',[input],route(goalId));assert.equal(repeated.ok,true,repeated.message);assert.equal(repeated.receipt.setupId,receipt.setupId);
    const saved=await catalog(goalId);assert.equal(saved.setups.length,1);assert.equal(receipt.activated,false);assert.equal(receipt.confirmed,false);assert.deepEqual(current().calls,[]);
    const html=researchHtmlText(await read(route(goalId,receipt.setupId)));for(const phrase of ['Review this exact research packet','USD 6.000000','Five-phase quote','one cumulative cap','Exa','existing OpenRouter credit','dispatch clock starts at confirmation'])assert.ok(html.includes(phrase),phrase);
    assert.doesNotMatch(receipt.preview.approvedQuery,/Synthetic technical intent|HTTP-created/);
  });
  await check('confirmation activates only exact finite authority and repeated action cannot dispatch',async()=>{
    const input={businessId:current().businessId,setupId:receipt.setupId,setupHash:receipt.setupHash,submissionId:randomUUID()};
    for(let i=0;i<2;i++){const result=await action('confirmOwnerResearchAction',[input],route(goalId,receipt.setupId));assert.equal(result.ok,true,result.message);assert.equal(result.receipt.activated,true);assert.equal(result.receipt.confirmed,true);receipt=result.receipt;}
    assert.deepEqual(current().calls,[]);const html=researchHtmlText(await read(route(goalId,receipt.setupId)));assert.match(html,/authority was activated at confirmation; check the research workspace for current eligibility/);assert.match(html,/Open research workspace for Continue/);
  });
  await check('native rendered Continue form runs five real engine phases and renders honest saved NME result',async()=>{
    const href=`/dashboard?view=research&type=r12&business=${current().businessId}&selected=${receipt.scopeId}&quest=${goalId}`;
    const html=await read(href),form=renderedResearchForm(html,'Continue approved research',receipt.scopeId);
    const response=await fetch(origin+href,{method:'POST',headers:{origin,accept:'text/html'},body:form,redirect:'manual',signal:AbortSignal.timeout(120000)});assert.ok([200,303].includes(response.status));await response.body?.cancel();
    assert.deepEqual(current().calls,['plan','search1','select1','strategy','review']);assert.deepEqual(current().receipts,current().calls);
    const result=researchHtmlText(await read(href));assert.match(result,/Needs more evidence/);assert.match(result,/Market evaluation/);assert.doesNotMatch(result,/complete saved result is unavailable|complete saved result could not be verified/);
    const stop=renderedResearchForm(await read(href),'Stop research',receipt.scopeId);assert.equal(stop.get('ownerInitial'),'1');
    const stopped=await fetch(origin+href,{method:'POST',headers:{origin,accept:'text/html'},body:stop,redirect:'manual',signal:AbortSignal.timeout(30000)});assert.ok([200,303].includes(stopped.status));await stopped.body?.cancel();assert.equal(current().calls.length,5);
    const view=await r12OwnerRpc(boundary.state(),'r12_discovery_owner_read',{p_business_id:current().businessId,p_scope_id:receipt.scopeId,p_activation:false});assert.equal(view.data.policyRevoked,true);assert.match(researchHtmlText(await read(href)),/Needs more evidence/);
  });
  await control('legacy');
  await check('legacy fresh quote explains insufficient cap and explicit extension preserves all earlier costs',async()=>{
    goalId=current().goalId;
    const input={...current().initialInput,researchLifetimeLimitMicrounits:'2000000',submissionId:randomUUID()};
    const blocked=await action('prepareOwnerResearchAction',[input]);assert.equal(blocked.ok,false);assert.match(blocked.message,/USD 0\.406736/);assert.match(blocked.message,/USD 2\.306736/);assert.equal((await catalog()).setups.length,0);
    const prepared=await action('prepareOwnerResearchAction',[{...input,researchLifetimeLimitMicrounits:'2500000',submissionId:randomUUID()}]);assert.equal(prepared.ok,true,prepared.message);receipt=prepared.receipt;
    const html=researchHtmlText(await read(route(goalId,receipt.setupId)));for(const phrase of ['USD 1.900000','USD 2.000000','USD 2.500000','Every prior cost remains'])assert.ok(html.includes(phrase),phrase);
    const confirmed=await action('confirmOwnerResearchAction',[{businessId:current().businessId,setupId:receipt.setupId,setupHash:receipt.setupHash,submissionId:randomUUID()}],route(goalId,receipt.setupId));assert.equal(confirmed.ok,true,confirmed.message);
    const saved=await catalog(goalId,receipt.setupId);assert.equal(saved.funding.maximumMicrounits,'2000000','Exact packet retains its immutable pre-confirm snapshot');const effective=await catalog(goalId);assert.equal(effective.funding.maximumMicrounits,'2500000');assert.equal(effective.funding.committedMicrounits,'1900000');assert.deepEqual(current().calls,[]);
    const stopped=await action('stopOwnerResearchAction',[{businessId:current().businessId,setupId:receipt.setupId,setupHash:receipt.setupHash,submissionId:randomUUID()}],route(goalId,receipt.setupId));assert.equal(stopped.ok,true,stopped.message);assert.equal(stopped.receipt.stopped,true);assert.deepEqual(current().calls,[]);
    assert.match(researchHtmlText(await read(route(goalId,receipt.setupId))),/Saved setup status: stopped/);
  });
  assert.deepEqual(boundary.denied,[]);await report();
}
