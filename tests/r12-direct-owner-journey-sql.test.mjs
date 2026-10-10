import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {directControllerDatabase} from './helpers/r12-direct-controller-database.mjs';
import {one} from './helpers/r12-owner-initial-sql-fixture.mjs';
import {ownerJourneyAuthority,ownerJourneyComposition,ownerRenderedForm,INERT_DIRECT_RUNTIME_ROOT} from './helpers/r12-direct-owner-journey-fixture.mjs';
import {deriveDirectServerKey} from '../.core-tests/products/discovery-r12-public-server-key.js';

test('ordinary rendered owner forms use actual authenticated SQL authority, one approved handoff and real no-query verification',{
 skip:!process.env.R12_SQL_TEST_HOST,timeout:180000,
},async t=>{
 const db=await directControllerDatabase(),fetch=globalThis.fetch,env={VERCEL_ENV:process.env.VERCEL_ENV,R05_ADMISSION_SERVER_KEY:process.env.R05_ADMISSION_SERVER_KEY,ACCOUNTS_VAULT_KEY:process.env.ACCOUNTS_VAULT_KEY};let external=0;
 globalThis.fetch=async()=>{external++;throw Error('No external transport');};
 try{
  for(const file of ['20261010120610_r12_direct_source_renderer_v2.sql','20261010120620_r12_direct_owner_server_context.sql','20261010120630_r12_direct_late_receipt_head_fence.sql','20261010120640_r12_direct_owner_access_navigation.sql','20261010120650_r12_direct_owner_test_exposure.sql','20261010120700_r12_direct_phase_repair.sql'])await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
  const a=await ownerJourneyAuthority(db);Object.assign(process.env,{VERCEL_ENV:'production',R05_ADMISSION_SERVER_KEY:INERT_DIRECT_RUNTIME_ROOT,ACCOUNTS_VAULT_KEY:'a'.repeat(64)});
  const j=ownerJourneyComposition(db,a);t.diagnostic('Actual owner source hashes: '+JSON.stringify(j.sourceHashes));const base=`/dashboard/products/etsy-research?business=${a.f.businessId}&goal=${a.f.goalId}`;
  const page=async url=>{try{const r=await j.get(url);assert.equal(r.status,200);return r.text();}catch(error){error.message=new URL(url,'http://inert.local').pathname+': '+error.message;throw error;}};
  const submit=async(html,button,extra={})=>{const f=ownerRenderedForm(html,button),r=await j.post(f.action,{...f.fields,...extra});assert.equal(r.status,303);return r.headers.get('Location');};
  const counts=()=>one(db,'select (select count(*)::int from private.r12_direct_test_envelopes) envelopes,(select count(*)::int from private.r12_direct_test_confirmations) confirmations,(select count(*)::int from private.r12_etsy_steel_setups) setups');
  assert.equal((await counts()).envelopes,0);
  let html=await page(base);assert.match(html,/Prepare exact test review/);assert.equal(j.providerCalls.length,0);
  let location=await submit(html,'Prepare exact test review',{grantId:a.f.grantId,maximumUsd:'10',maximumAttempts:'10'});
  if(new URL(location,'http://inert.local').searchParams.get('result')!=='prepared')throw Error(JSON.stringify({calls:j.rpcCalls,errors:j.errors}));
  assert.equal(new URL(location,'http://inert.local').searchParams.get('result'),'prepared',JSON.stringify(j.errors));
  const envelopeId=new URL(location,'http://inert.local').searchParams.get('envelope'),researchUrl=base+'&envelope='+envelopeId;
  html=await page(location);assert.match(html,/Combined ceiling: \$10\.000000 USD/);assert.match(html,/Previous Business exposure/);assert.match(html,/cumulative limits/);
  assert.equal((await counts()).confirmations,0);assert.equal(j.providerCalls.length,0);
  const missing=await submit(html,'Confirm test envelope');assert.equal(new URL(missing,'http://inert.local').searchParams.get('result'),'confirmation-required');assert.equal((await counts()).confirmations,0);
  location=await submit(html,'Confirm test envelope',{confirmBudget:'on'});assert.equal(new URL(location,'http://inert.local').searchParams.get('result'),'confirmed',JSON.stringify(j.errors));
  html=await page(location);location=await submit(html,'Review recorded sign-in and persistent access',{expectedShopName:'SyntheticShop'});
  assert.equal(new URL(location,'http://inert.local').pathname,'/dashboard/accounts/etsy-research',JSON.stringify(j.errors));
  const accountUrl=location,operationId=new URL(location,'http://inert.local').searchParams.get('operation');
  const duplicateAccess=await j.product.prepareDirectEtsyAccess(j.context(),a.f.businessId,a.f.goalId,envelopeId,'SyntheticShop');assert.equal(duplicateAccess.operationId,operationId);assert.equal((await counts()).setups,1);
  html=await page(accountUrl);assert.match(html,/Steel hosts the browser and records/);assert.match(html,/reusable browser authentication profile/);assert.match(html,/This application access expiry does not establish when Steel deletes the profile/);assert.match(html,/Verification submits no research query/);assert.equal(j.providerCalls.length,0);
  const approvalForm=ownerRenderedForm(html,'Approve reviewed access');
  const denied=await j.post(approvalForm.action,{...approvalForm.fields,scopeHash:'f'.repeat(64),persistentAccessConsent:'on'});assert.equal(new URL(denied.headers.get('Location'),'http://inert.local').searchParams.get('result'),'unavailable');
  assert.equal((await j.owner.readEtsySteelOwnerSetup(j.context(),a.f.businessId,operationId)).status,'pending_approval');
  location=await submit(html,'Approve reviewed access',{persistentAccessConsent:'on'});assert.equal(new URL(location,'http://inert.local').searchParams.get('result'),'approved');
  html=await page(accountUrl);assert.equal(j.providerCalls.length,0);location=await submit(html,'Start approved private sign-in');
  assert.equal(new URL(location,'http://inert.local').pathname,'/dashboard/accounts/etsy-research/sign-in',JSON.stringify({errors:j.errors,provider:j.providerCalls,browser:j.browsers.map(x=>x.events),receipts:(await j.owner.readEtsySteelOwnerSetup(j.context(),a.f.businessId,operationId)).receipts}));
  const signInUrl=location;html=await page(signInUrl);assert.match(html,/<iframe/);assert.match(html,/referrerPolicy="no-referrer"/i);assert.match(html,/observers/);
  assert.equal(j.providerCalls.filter(x=>x.operation==='browser.etsy.owner_handoff.create').length,1);
  assert.ok(j.browsers[0].events.indexOf('disconnect')>j.browsers[0].events.indexOf('goto'));
  assert.equal((await page(accountUrl)).includes('api.steel.dev'),false,'Private viewer cannot enter the ordinary owner catalog');
  location=await submit(html,'I have finished signing in',{action:'return'});
  assert.equal(new URL(location,'http://inert.local').searchParams.get('result'),'account-verified',JSON.stringify(j.errors));
  const view=await j.owner.readEtsySteelOwnerVerification(j.context(),a.f.businessId,operationId);assert.equal(view.status,'verified');assert.equal(view.observedShopName,'SyntheticShop');
  html=await page(accountUrl);assert.match(html,/Account verification: verified/);assert.equal(html.includes(j.profileId),false);assert.equal(html.includes('api.steel.dev'),false);
  assert.equal(j.providerCalls.filter(x=>x.operation==='browser.etsy.insights.create').length,1);assert.equal([...j.sessions.values()].every(s=>s.released),true);
  assert.equal(j.browsers.every(b=>!b.events.includes('fill')&&!b.events.includes('submit')),true,'Login bootstrap and identity verification submit no query');
  assert.equal((await page(signInUrl)).includes('<iframe'),false,'Consumed owner viewer cannot reopen');
  const exposure=(await j.product.readDirectResearchCatalog(j.context(),a.f.businessId,a.f.goalId,envelopeId)).testExposure;assert.equal(exposure.knownActualMicrounits,'0');assert.equal(exposure.boundedPendingMicrounits,'2000');assert.equal(exposure.allBillingFinal,false);
  html=await page(researchUrl);assert.match(html,/Confirmed actual: \$0\.000000 USD/);assert.match(html,/Still reserved for pending charges: \$0\.002000 USD/);assert.match(html,/Pending reservations are not actual charges or available budget/);location=await submit(html,'Prepare research and data-sharing review',{query:'astronomy gifts',namedGap:'Which astronomy gift wording is visible?',expectedInformationGain:'Compare the literal search display for this exact wording.',opposingCheck:'Check whether aggregate results leave commercial demand unknown.'});
  assert.equal(new URL(location,'http://inert.local').searchParams.get('result'),'research-prepared',JSON.stringify(j.errors));
  const reviewed=await j.product.readDirectResearchCatalog(j.context(),a.f.businessId,a.f.goalId,envelopeId);assert.equal(reviewed.research.preview.policy.version,'r12.direct-etsy-attempt-policy.2');
  html=await page(location);for(const text of ['astronomy gifts','Which astronomy gift wording is visible?','Compare the literal search display','aggregate results leave commercial demand unknown','OpenRouter','80/100'])assert.ok(html.includes(text),text);
  assert.equal(j.workflowStarts.length,0);const startForm=ownerRenderedForm(html,'Confirm and start research');
  const noConsent=await j.post(startForm.action,startForm.fields);assert.equal(new URL(noConsent.headers.get('Location'),'http://inert.local').searchParams.get('result'),'research-confirmation-required');assert.equal(j.workflowStarts.length,0);
  location=await submit(html,'Confirm and start research',{confirmResearch:'on'});assert.equal(new URL(location,'http://inert.local').searchParams.get('result'),'started',JSON.stringify(j.errors));assert.equal(j.workflowStarts.length,1);
  // Explicit inert hosting delivery to the same public SQL attachment used by the
  // separately qualified real driver. No model/source result is synthesized here.
  const preAttach=await j.post(startForm.action,{...startForm.fields,confirmResearch:'on'});assert.equal(new URL(preAttach.headers.get('Location'),'http://inert.local').searchParams.get('result'),'started');assert.equal(j.workflowStarts.length,1,'Existing hook prevents duplicate start before SQL attachment');
  await j.product.resumeDirectResearch(j.context(),a.f.businessId,a.f.goalId,envelopeId);assert.equal(j.resumes.length,1,'Owner can wake registered hook after pre-attachment SQL failure');
  j.faults.hookLookupUnavailable=true;await assert.rejects(j.product.resumeDirectResearch(j.context(),a.f.businessId,a.f.goalId,envelopeId));assert.equal(j.resumes.length,1);j.faults.hookLookupUnavailable=false;
  const started=j.workflowStarts[0],i=started.input,key=deriveDirectServerKey(a.f.bootstrapKey,{businessId:i.businessId,goalId:i.goalId,testEnvelopeId:i.testEnvelopeId,envelopeHash:i.envelopeHash,routeHash:i.routeHash,purpose:'controller'});
  const attached=await j.runtime.rpc('r12_direct_controller_server',{p_business_id:i.businessId,p_scope_id:i.scopeId,p_operation:'attach_runtime',p_payload:{runtimeRunId:started.runId},p_server_key:key});assert.equal(attached.error,null);
  const again=await j.post(startForm.action,{...startForm.fields,confirmResearch:'on'});assert.equal(new URL(again.headers.get('Location'),'http://inert.local').searchParams.get('result'),'started');assert.equal(j.workflowStarts.length,1,'Duplicate owner invocation does not start a second workflow after durable attachment');
  j.uiState.nextAction='source_paused';assert.match(await page(researchUrl),/Source access is paused and requires reconciliation\. No replacement browser session is authorized\./);
  j.uiState.nextAction='receipt_only';assert.match(await page(researchUrl),/Waiting for the existing request/);j.uiState.nextAction=null;
  const visible=await page(researchUrl);location=await submit(visible,'Stop this test');assert.equal(new URL(location,'http://inert.local').searchParams.get('result'),'stopped');
  const stopped=await j.product.readDirectResearchCatalog(j.context(),a.f.businessId,a.f.goalId,envelopeId);assert.equal(stopped.current.stopped,true);assert.match(await page(researchUrl),/This test is stopped\. Existing receipts may still settle; no new paid work is authorized\./);
  const callsBefore=j.providerCalls.length;await j.product.resumeDirectResearch(j.context(),a.f.businessId,a.f.goalId,envelopeId);assert.equal(j.resumes.length,2);assert.ok(j.resumes.every(r=>r.token==='agent-labs:direct-etsy-reconcile:'+i.scopeId&&r.payload.operation==='reconcile'));assert.equal(j.providerCalls.length,callsBefore);
  const stoppedView=await j.owner.readEtsySteelOwnerVerification(j.context(),a.f.businessId,operationId);assert.notEqual(stoppedView.status,'verified');assert.equal(stoppedView.observedShopName,null);
  j.setUser(randomUUID());await assert.rejects(j.product.resumeDirectResearch(j.context(),a.f.businessId,a.f.goalId,envelopeId));await assert.rejects(j.owner.readEtsySteelOwnerVerification(j.context(),a.f.businessId,operationId));assert.equal(j.resumes.length,2);
  for(const c of j.rpcCalls){if(['r12_owner_direct_read','r12_owner_direct_server','r12_etsy_steel_owner','r12_owner_etsy_steel_verification_read'].includes(c.name))assert.equal(c.role,'authenticated');else assert.equal(c.role,'anon');}
  assert.equal(external,0);assert.equal(j.providerCalls.filter(x=>x.path==='/v1/sessions').length,2);
 }finally{globalThis.fetch=fetch;for(const[k,v]of Object.entries(env))if(v===undefined)delete process.env[k];else process.env[k]=v;await db.close();}
});
