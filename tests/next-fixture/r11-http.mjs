import assert from 'node:assert/strict';
import {r11Scope,r11ContinuationScope,R11_RESET,R11_RAW_SENTINEL,R11_INERT_SERVER_KEY} from './r11-research.mjs';
export const researchRoute=(business=r11Scope.businessId)=>'/dashboard/research-qualification?'+new URLSearchParams({business});
export async function researchControl(boundary,values){
 const response=await fetch(boundary.origin+'/control',{method:'POST',body:JSON.stringify(values),signal:AbortSignal.timeout(10_000)});
 assert.equal(response.status,200,`Inert research control failed (${response.status}): ${JSON.stringify(Object.keys(values))}`);
 assert.deepEqual(await response.json(),{ok:true});
}
export async function runResearchQualificationHttp({origin,noKeyOrigin,boundary,check}){
 await researchControl(boundary,{r11Research:true,resetResearch:true});
 await check('R11 real Next GET reads only saved exact-Business metadata and never prepares or dispatches',async()=>{
  const before=boundary.effects.length,catalogBefore=boundary.log.filter(item=>item.kind==='inert-r11-public-catalog').length;
  const response=await fetch(origin+researchRoute(),{signal:AbortSignal.timeout(30_000)}),html=await response.text();
  assert.equal(response.status,200);assert.match(html,/Public research proof/i);assert.doesNotMatch(html,/Application error|inert-next-r11-authority|inert-r11-provider-placeholder/);
  assert.match(html,/One public gardening evidence proof/);assert.match(html,/No store writes, publishing, product selection, automatic retry or fallback/);assert.match(html,/\$0\.125 USD/);assert.match(html,/\$0\.375 USD/);
  const reviewed=boundary.state().r11Research.grants[0].grant;assert.ok(html.includes(reviewed.goalContent.parsed.deadline.date));assert.ok(html.includes(reviewed.goalContent.parsed.deadline.time));
  assert.equal(boundary.effects.length,before);assert.equal(boundary.log.filter(item=>item.kind==='inert-r11-public-catalog').length,catalogBefore,'GET must not refresh quote or prepare authority');
 });
 await check('R11 separate key-free Next process retains readable grants with execution controls disabled',async()=>{
  const before=boundary.effects.length,response=await fetch(noKeyOrigin+researchRoute(),{signal:AbortSignal.timeout(30_000)}),html=await response.text();
  assert.equal(response.status,200);assert.match(html,/dedicated admission or provider configuration is incomplete/);assert.match(html,/data-r11-grant=/);assert.match(html,/<button[^>]*disabled[^>]*>Prepare public quote and setup<\/button>/);assert.equal(boundary.effects.length,before);
 });
 await check('R11 real Next private entry requires an owner and retains the exact research destination',async()=>{
  const response=await fetch(origin+researchRoute(),{redirect:'manual',headers:{cookie:'r03-session=off'},signal:AbortSignal.timeout(30_000)});
  assert.equal(response.status,307);const location=new URL(response.headers.get('location'),origin);assert.equal(location.pathname,'/login');assert.equal(location.searchParams.get('returnTo'),researchRoute());
 });
 await check('R11 real Next rejects foreign and malformed exact Business selection without paid effects',async()=>{
  const before=boundary.effects.length;
  for(const business of [r11Scope.foreignBusinessId,'not-a-business']){
   const response=await fetch(origin+researchRoute(business),{signal:AbortSignal.timeout(30_000)}),html=await response.text();
   assert.ok([200,404].includes(response.status));assert.doesNotMatch(html,/name="(?:grantId|policyId)"|>Run public evidence proof<\/button>/);
  }
  assert.equal(boundary.effects.length,before);
 });
 await check('R11 real Next unavailable owner read remains distinct from empty saved history',async()=>{
  const response=await fetch(origin+researchRoute(),{headers:{cookie:'r03-mode=unavailable'},signal:AbortSignal.timeout(30_000)}),html=await response.text();
  assert.equal(response.status,200);assert.match(html,/unavailable/i);assert.doesNotMatch(html,/>Run public evidence proof<\/button>/);
 });
}

const decodeAttribute=value=>value.replace(/&quot;/g,'"').replace(/&#x27;|&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
/** Match rendered text, never serialized Flight/script strings or React separators. */
export const researchHtmlText=html=>decodeAttribute(html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<!--[\s\S]*?-->/g,'').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
/** Authority and catalogue freshness are independent, explicit versioned windows. */
export function assertResearchPreparationWindow(preparation,mode){
 assert.ok(['initial','continuation'].includes(mode));assert.equal(preparation.mode,mode);
 assert.equal(preparation.version,mode==='continuation'?'r11.owner-proof-preparation.3':'r11.owner-proof-preparation.2');
 assert.equal(preparation.quote.version,'r11.public-research-quote.2');
 const preparedAt=Date.parse(preparation.preparedAt),expiresAt=Date.parse(preparation.expiresAt),quotedAt=Date.parse(preparation.quote.verifiedAt),quoteUntil=Date.parse(preparation.quote.validUntil);
 assert.ok([preparedAt,expiresAt,quotedAt,quoteUntil].every(Number.isFinite),'Preparation timestamps must be finite');
 assert.equal(preparation.quote.quoteValidUntil,preparation.quote.validUntil);
 assert.equal(quoteUntil-quotedAt,5*60_000,'Public catalogue quotes retain their exact five-minute lifetime');
 assert.ok(quotedAt<=preparedAt&&preparedAt<quoteUntil,'Preparation uses a still-fresh trusted catalogue quote');
 if(mode==='continuation'){
  assert.equal(expiresAt-preparedAt,30*60_000,'Continuation authority ends exactly thirty minutes after trusted preparation');
  assert.ok(quoteUntil<expiresAt,'The catalogue quote must not inherit the longer authority window');
 }else assert.equal(preparation.expiresAt,preparation.quote.validUntil,'Initial authority retains the original quote deadline');
}
export function assertResearchPhaseQuoteWindows(research,policyId){
 const policy=research.policies.find(item=>item.policyId===policyId)?.policy;assert.ok(policy);
 assert.equal(policy.version,'r11.public-research.2');assert.equal(Date.parse(policy.validUntil)-Date.parse(policy.validFrom),30*60_000);assert.equal(policy.quoteValidUntil,policy.validUntil);
 const markers=research.markers.filter(item=>item.policyId===policyId);assert.deepEqual(markers.map(item=>item.phase),['search','select']);
 for(const marker of markers){
  const freshFor=Date.parse(marker.quoteValidUntil)-Date.parse(marker.markedAt);
  assert.ok(freshFor>0&&freshFor<=5*60_000,'Each phase marker binds its own still-fresh at-most-five-minute quote');
  assert.ok(Date.parse(marker.quoteValidUntil)<Date.parse(policy.validUntil),'Phase quote freshness is narrower than authority');
 }
}
export function researchPreparedMetadata(html,mode='initial'){
 const panels=[...html.matchAll(/<details\b[^>]*\bid="research-setup-metadata"[^>]*>([\s\S]*?)<\/details>/g)];
 assert.equal(panels.length,1,'Expected the exact prepared setup metadata panel');
 const pre=[...panels[0][1].matchAll(/<pre\b[^>]*>([\s\S]*?)<\/pre>/g)];
 assert.equal(pre.length,1,'Expected one prepared setup JSON value');
 const preparation=JSON.parse(decodeAttribute(pre[0][1]));
 assertResearchPreparationWindow(preparation,mode);return preparation;
}
export function researchRedirectUrl(location,base){
 assert.ok(location,'Actual action redirect must retain its full destination');
 const url=new URL(location,base);assert.equal(url.origin,base);assert.equal(url.pathname,'/dashboard/research-qualification');return url;
}
function renderedForm(html,button,identity=null){
 const forms=[...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].filter(match=>match[1].includes(button)&&(!identity||match[1].includes(`value="${identity}"`)));
 assert.equal(forms.length,1,`Expected one rendered ${button} form`);
 const data=new FormData();
 for(const match of forms[0][1].matchAll(/<input\b[^>]*>/g)){
  const attrs=Object.fromEntries([...match[0].matchAll(/([\w$:-]+)="([^"]*)"/g)].map(attr=>[attr[1],decodeAttribute(attr[2])]));
  if(attrs.name&&attrs.type==='hidden')data.append(attrs.name,attrs.value??'');
 }
 assert.ok([...data.keys()].some(key=>key.startsWith('$ACTION_')),'Must use actual rendered Next action identity');
 return data;
}
export async function runResearchQualificationActionHttp({origin,noKeyOrigin,boundary,check}){
 const control=values=>researchControl(boundary,values),fixture=()=>boundary.state().r11Research;
 const get=async(base=origin,business=r11Scope.businessId)=>{const response=await fetch(base+researchRoute(business),{signal:AbortSignal.timeout(30_000)});assert.equal(response.status,200);return response.text();};
 const post=async(button,values={},base=origin,html=null,identity=null)=>{
  const data=renderedForm(html??await get(base),button,identity);for(const [key,value]of Object.entries(values))data.set(key,value);
  const response=await fetch(base+researchRoute(),{method:'POST',headers:{origin:base,accept:'text/html'},body:data,redirect:'manual',signal:AbortSignal.timeout(30_000)});
  assert.ok([200,303].includes(response.status),`Unexpected actual form POST status ${response.status}`);
  if(response.status===303){const url=researchRedirectUrl(response.headers.get('location'),base),redirected=await fetch(url,{signal:AbortSignal.timeout(30_000)});assert.equal(redirected.status,200);return redirected.text();}
  return response.text();
 };
 const reset=(extra={})=>control({...R11_RESET,...extra});
 const activate=()=>post('Activate reviewed proof',{readConsent:'on',retentionConsent:'on'});
 const reconciledHistorical=async()=>{
  await reset({r11Historical:true});const html=await post('Reconcile saved Stop',{},noKeyOrigin);
  assert.match(researchHtmlText(html),/original stop cause remains undetermined/);
  assert.equal(fixture().policies[0].terminalReconciliationRequired,false);assert.equal(fixture().policies[0].workflowStatus,'cancelled');
  assert.equal(fixture().settlements[0].actualMicrounits,'10068');assert.equal(fixture().outcomes.length,2);return html;
 };
 await check('R11 actual HTML form preparation validates current public quote without creating authority',async()=>{
  await reset();const before=boundary.effects.length,catalogs=boundary.log.filter(item=>item.kind==='inert-r11-public-catalog').length;
  const initial=await get(),submitted=renderedForm(initial,'Prepare public quote and setup'),html=await post('Prepare public quote and setup',{},origin,initial);assert.match(html,/Setup metadata prepared/);assert.match(html,/research-setup-metadata/);
  const preparation=researchPreparedMetadata(html);
  assert.equal(preparation.version,'r11.owner-proof-preparation.2');assert.equal(preparation.mode,'initial');assert.equal(preparation.quote.version,'r11.public-research-quote.2');assert.deepEqual(preparation.quote.acceptedResponseModelIds,['openai/gpt-5.6-luna','openai/gpt-5.6-luna-20260709']);assert.equal(preparation.businessId,r11Scope.businessId);assert.equal(preparation.policyId,submitted.get('policyId'));assert.equal(preparation.workflowRunId,submitted.get('workflowRunId'));assert.equal(preparation.authorityCreated,false);assert.equal(preparation.paidCalls,0);assert.match(preparation.serverKeyHash,/^[a-f0-9]{64}$/);assert.match(preparation.runtimeCapabilityHash,/^[a-f0-9]{64}$/);
  assert.equal(boundary.effects.length,before);assert.equal(fixture().providerCalls.length,0);assert.equal(boundary.log.filter(item=>item.kind==='inert-r11-public-catalog').length,catalogs+4);
 });
 await check('R11 actual HTML actions require both consents and exact Business grant identity',async()=>{
  await reset();await post('Activate reviewed proof');assert.equal(fixture().policies.length,0);await post('Activate reviewed proof',{readConsent:'on'});assert.equal(fixture().policies.length,0);
  await post('Activate reviewed proof',{readConsent:'on',retentionConsent:'on',grantHash:'f'.repeat(64)});assert.equal(fixture().policies.length,0);
  await post('Activate reviewed proof',{readConsent:'on',retentionConsent:'on',businessId:r11Scope.otherBusinessId});assert.equal(fixture().policies.length,0);
  const before=boundary.effects.filter(item=>item.kind==='in-memory-r11-research-activation').length;
  const html=await activate();assert.match(html,/Ready.*pending proof/);await activate();assert.equal(fixture().policies.length,1);assert.equal(boundary.effects.filter(item=>item.kind==='in-memory-r11-research-activation').length,before+1);assert.equal(fixture().providerCalls.length,0);
  await post('Run public evidence proof',{businessId:r11Scope.otherBusinessId});assert.equal(fixture().providerCalls.length,0);
 });
 await check('R11 actual HTML Run retains the public response through a transient receipt 404 and saves one validated result without paid replay',async()=>{
  await reset();await activate();await control({r11GenerationResponses:['not_found','success']});const readsBefore=boundary.log.length;
  const html=await post('Run public evidence proof');assert.match(html,/Saved validated evidence/);assert.match(html,/Synthetic public gardening report/);assert.match(html,/data-r11-result=/);assert.equal(fixture().providerCalls.length,2);assert.deepEqual(fixture().providerCalls.map(item=>item.phase),['search','select']);assert.equal(fixture().markers.length,2);assert.equal(fixture().settlements.length,4);assert.equal(fixture().collections.length,1);assert.equal(fixture().results.length,1);
  const generationReads=()=>boundary.log.slice(readsBefore).filter(item=>item.kind==='inert-r11-generation-read'),[search,select]=fixture().providerCalls;
  assert.deepEqual(generationReads().map(item=>item.generationId),[search.receiptId,search.receiptId,select.receiptId]);
  assert.deepEqual(fixture().settlements.map(item=>item.actualMicrounits),['10068','10068','1000','1000']);assert.match(html,/\$0\.136068 USD/);assert.equal(fixture().outcomes.length,0);
  await post('Run public evidence proof');await get();await get();assert.equal(fixture().providerCalls.length,2);assert.equal(fixture().results.length,1);assert.equal(generationReads().length,3);
  await control({r11Expired:true});const retained=await get(noKeyOrigin);assert.match(retained,/data-r11-result=/);assert.match(retained,/dedicated admission or provider configuration is incomplete/);assert.match(retained,/Expired: no new dispatch/);
  const stopped=await post('Stop this proof',{},noKeyOrigin);assert.match(stopped,/Revoked: further dispatch is stopped/);assert.match(stopped,/data-r11-result=/);assert.equal(fixture().providerCalls.length,2);
 });
 await check('R11 overlapping actual HTML Run actions cannot journal a false failure against the one admitted request',async()=>{
  await reset();await activate();const html=await get();await control({r11HoldLoads:true});
  // Both real owner actions read ready, then their real runtime load replies wait
  // at this transport barrier. Releasing the pair deterministically races guard.
  const requests=[post('Run public evidence proof',{},origin,html),post('Run public evidence proof',{},origin,html)];
  const observed=Promise.allSettled(requests);
  try{
   const deadline=Date.now()+10_000;while(boundary.heldResearchLoads()<2&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
   assert.equal(boundary.heldResearchLoads(),2,'Both actual actions must reach the inert load barrier');await control({r11HoldLoads:false});
   const responses=await observed;for(const response of responses)assert.equal(response.status,'fulfilled');
   const final=await get();assert.match(final,/data-r11-result=/);assert.equal(fixture().providerCalls.length,2);assert.equal(fixture().results.length,1);assert.equal(fixture().outcomes.length,0);assert.equal(fixture().policies[0].revoked,false);assert.equal(fixture().policies[0].workflowStatus,'completed');
  }finally{try{await control({r11HoldLoads:false});}finally{boundary.releaseResearchLoads();await observed;}}
 });
 await check('R11 actual HTML Run action records a bounded failure separately from unknown settlement and never retries',async()=>{
  await reset();await activate();await control({r11ProviderFailure:'search'});const html=await post('Run public evidence proof');assert.match(html,/Stopped.*saved revocation/);assert.match(html,/Unknown charge remains held/);assert.match(html,/Saved proof failure/);assert.match(html,/provider response did not meet/);assert.doesNotMatch(html,/data-r11-result=/);assert.equal(fixture().markers.length,1);assert.equal(fixture().providerCalls.length,1);assert.equal(fixture().settlements.length,0);assert.equal(fixture().outcomes.length,1);assert.equal(fixture().outcomes[0].kind,'failure');assert.equal(fixture().policies[0].workflowStatus,'needs_owner');
  const failure=structuredClone(fixture().outcomes[0]);await post('Run public evidence proof');await get();assert.equal(fixture().providerCalls.length,1);assert.deepEqual(fixture().outcomes,[failure]);
  const stop=await post('Stop this proof',{},noKeyOrigin);assert.match(stop,/Saved owner Stop/);assert.match(stop,/Saved proof failure/);assert.equal(fixture().outcomes.length,2);assert.deepEqual(fixture().outcomes[0],failure);assert.equal(fixture().settlements.length,0);
 });
 await check('R11 canonical provider identity reaches saved validated evidence; safe failure metadata never contains raw provider text',async()=>{
  for(const scenario of [
   {control:{r11UnknownCost:true},reason:'cost_unverified_or_over_cap',calls:1,settlements:1,display:/charge could not be verified/},
   {control:{r11InvalidSources:true},reason:'source_contract_invalid',calls:1,display:/returned sources did not pass/},
   {control:{r11InvalidModel:true},reason:'response_model_unqualified',calls:1,settlements:1,display:/returned model identity was not qualified/},
   {control:{r11InvalidProvider:true},reason:'response_provider_unqualified',calls:1,settlements:1,display:/recorded provider-identity check did not pass/},
   {control:{r11GenerationResponses:['unauthorized']},reason:'response_provider_unqualified',calls:1,settlements:1,display:/Generation receipt failure:.*api_failure/,receipt:{code:'api_failure',httpStatus:401}},
   {control:{r11GenerationResponses:['invalid_json']},reason:'response_provider_unqualified',calls:1,settlements:1,display:/Generation receipt failure:.*json_invalid/,receipt:{code:'json_invalid',httpStatus:200}},
   {control:{r11GenerationResponses:['wrong_generation']},reason:'response_provider_unqualified',calls:1,settlements:1,display:/Generation receipt failure:.*generation_mismatch/,receipt:{code:'generation_mismatch',httpStatus:200}},
   {control:{r11CollectFailure:true},reason:'collection_persistence_failed',calls:1,display:/source collection could not be confirmed/},
   {control:{r11InvalidSelection:true},reason:'selector_output_invalid',calls:2,display:/evidence-selection output did not pass/},
   {control:{r11CompleteFailure:true},reason:'result_persistence_failed',calls:2,display:/final evidence result could not be confirmed/},
  ]){
   await reset();await activate();await control(scenario.control);const readsBefore=boundary.log.length,html=await post('Run public evidence proof');assert.match(html,/Saved proof failure/);assert.match(html,scenario.display);assert.doesNotMatch(html,new RegExp(R11_RAW_SENTINEL+'|data-r11-result='));assert.equal(fixture().providerCalls.length,scenario.calls);assert.equal(fixture().settlements.length,scenario.settlements??scenario.calls*2);assert.equal(fixture().settlements[0].actualMicrounits,scenario.control.r11UnknownCost?null:'10068');assert.equal(fixture().results.length,0);assert.equal(fixture().outcomes[0].reason,scenario.reason);assert.equal(fixture().policies[0].workflowStatus,'needs_owner');assert.equal(fixture().policies[0].revoked,true);assert.ok(!JSON.stringify(fixture().outcomes).includes(R11_RAW_SENTINEL));
   if(scenario.receipt){const observation=fixture().outcomes[0].observation;assert.equal(observation.inferenceRouteFailureCode,scenario.receipt.code);assert.equal(observation.inferenceRouteHttpStatus,scenario.receipt.httpStatus);assert.equal(observation.inferenceRouteAttempts,1);assert.match(researchHtmlText(html),new RegExp(`Generation receipt HTTP status: ${scenario.receipt.httpStatus}.*Generation receipt attempts: 1`));assert.equal(fixture().collections.length,0);}
   if(scenario.control.r11InvalidSources){assert.equal(fixture().outcomes[0].observation.rejectedDomainCount,1);assert.equal(fixture().outcomes[0].observation.malformedAnnotationCount,1);assert.match(html,/approved canonical model/);assert.match(html,/Rejected source domains:.*1.*malformed annotations:.*1/);}
   await post('Run public evidence proof');await get();assert.equal(fixture().providerCalls.length,scenario.calls);
   if(scenario.receipt)assert.deepEqual(boundary.log.slice(readsBefore).filter(item=>item.kind==='inert-r11-generation-read').map(item=>item.generationId),[fixture().providerCalls[0].receiptId]);
  }
 });
 await check('R11 failed diagnostic persistence stays visibly unconfirmed, keeps known charge, and key-free Stop can still be recorded',async()=>{
  await reset();await activate();await control({r11InvalidSources:true,r11FailJournalFailure:true});let html=await post('Run public evidence proof');assert.match(html,/Held.*dispatched outcome unverified/);assert.match(html,/failure diagnostic could not be saved/);assert.match(html,/No typed validation outcome is saved/);assert.doesNotMatch(html,/Saved proof failure|data-r11-result=/);assert.equal(fixture().outcomes.length,0);assert.equal(fixture().policies[0].revoked,false);assert.equal(fixture().settlements[0].actualMicrounits,'10068');assert.equal(fixture().providerCalls.length,1);
  await post('Run public evidence proof');assert.equal(fixture().providerCalls.length,1);
  await control({r11StopFailure:true});html=await post('Stop this proof',{},noKeyOrigin);assert.doesNotMatch(html,/Saved owner Stop/);assert.equal(fixture().policies[0].revoked,false);
  await control({r11StopFailure:false});html=await post('Stop this proof',{},noKeyOrigin);assert.match(html,/Saved owner Stop/);assert.equal(fixture().outcomes.length,1);assert.equal(fixture().outcomes[0].kind,'owner_stopped');assert.equal(fixture().policies[0].workflowStatus,'cancelled');assert.match(html,/No typed validation outcome is saved/);assert.equal(fixture().providerCalls.length,1);assert.equal(fixture().settlements[0].actualMicrounits,'10068');
 });
 await check('R11 historical charge and unrun selector survive explicit key-free Stop reconciliation without invented failure cause',async()=>{
  await reset({r11Historical:true});const originalSettlements=structuredClone(fixture().settlements),before=fixture().providerCalls.length,catalogs=boundary.log.filter(item=>item.kind==='inert-r11-public-catalog').length;
  let html=await get(noKeyOrigin);assert.match(html,/reported \$0\.010068 USD/);assert.match(researchHtmlText(html),/Evidence selection: no dispatch recorded/);assert.match(html,/Reconcile saved Stop/);assert.match(html,/No typed validation outcome is saved/);assert.doesNotMatch(html,/Prepare public quote and setup|Saved proof failure|data-r11-result=/);assert.equal(fixture().outcomes.length,0);assert.equal(fixture().collections.length,0);assert.equal(fixture().markers.filter(item=>item.phase==='select').length,0);
  html=await post('Reconcile saved Stop',{},noKeyOrigin);assert.match(html,/original stop cause remains undetermined/);assert.match(html,/Saved owner Stop/);assert.match(html,/Saved proof failure/);assert.doesNotMatch(html,/Reconcile saved Stop<|data-r11-result=/);assert.equal(fixture().policies[0].workflowStatus,'cancelled');assert.equal(fixture().policies[0].terminalReconciliationRequired,false);assert.equal(fixture().outcomes[0].reason,'legacy_failure_undetermined');assert.equal(fixture().outcomes[0].observation,null);assert.deepEqual(fixture().settlements,originalSettlements);assert.equal(fixture().providerCalls.length,before);assert.equal(boundary.log.filter(item=>item.kind==='inert-r11-public-catalog').length,catalogs);
  await get();await get(noKeyOrigin);assert.equal(fixture().providerCalls.length,before);assert.equal(fixture().outcomes.length,2);
 });
 await check('R11 actual read-only owner action resolves the exact historical receipt without new authority, charge or inference',async()=>{
  await reconciledHistorical();const initial=await get(),requestId=fixture().markers[0].requestId;
  const original=structuredClone(fixture()),effects=boundary.effects.length,reads=()=>boundary.log.filter(item=>item.kind==='inert-r11-generation-read').length;
  const before=reads(),form=renderedForm(initial,'Verify saved inference route',requestId);
  assert.deepEqual([...form.keys()].filter(key=>!key.startsWith('$ACTION_')).sort(),['businessId','policyId','requestId']);
  for(const values of [{businessId:r11Scope.otherBusinessId},{policyId:r11Scope.otherBusinessId},{requestId:r11Scope.otherBusinessId},{generationId:'gen-caller-forged'}]){
   const rejected=await post('Verify saved inference route',values,origin,initial,requestId);
   assert.doesNotMatch(rejected,/data-r11-route-evidence/);assert.equal(reads(),before);
  }
  for(let i=1;i<=2;i++){
   const html=await post('Verify saved inference route',{},origin,initial,requestId),text=researchHtmlText(html);
   assert.match(html,/data-r11-route-evidence/);assert.match(text,/Documented inference provider: Azure/);assert.match(text,/openai\/gpt-5\.6-luna-20260709/);
   assert.match(text,/does not independently establish the regional endpoint or enumerate every inner call/);
   assert.match(text,/original stop cause remains undetermined/);assert.match(text,/reported \$0\.010068 USD/);
   assert.doesNotMatch(html,new RegExp(R11_RAW_SENTINEL+'|inert-r11-generation-placeholder|data-r11-result='));
   assert.equal(reads(),before+i);assert.deepEqual(fixture(),original);assert.equal(boundary.effects.length,effects);
   assert.equal(boundary.log.filter(item=>item.kind==='inert-r11-generation-read').at(-1).generationId,original.providerCalls.find(item=>item.requestId===requestId).receiptId);
   assert.match(text,/does not qualify prior output or authorize another run/);
  }
  await control({r11GenerationResponses:['unauthorized']});
  const failed=await post('Verify saved inference route',{},origin,initial,requestId);
  assert.match(researchHtmlText(failed),/Receipt metadata check: api_failure; HTTP 401; reads attempted 1/);assert.match(failed,/role="alert"/);assert.doesNotMatch(failed,new RegExp(R11_RAW_SENTINEL+'|data-r11-route-evidence'));
  assert.equal(reads(),before+3);assert.deepEqual(fixture(),original);assert.equal(boundary.effects.length,effects);
  await control({r11GenerationResponses:['not_found','success']});
  const recovered=await post('Verify saved inference route',{},origin,initial,requestId);assert.match(recovered,/data-r11-route-evidence/);assert.doesNotMatch(recovered,/Receipt metadata check: api_failure/);
  assert.equal(reads(),before+5);assert.deepEqual(fixture(),original);assert.equal(boundary.effects.length,effects);
  assert.deepEqual(boundary.log.filter(item=>item.kind==='inert-r11-generation-read').slice(-3).map(item=>item.generationId),Array(3).fill(original.providerCalls[0].receiptId));
  await get();assert.equal(reads(),before+5,'A saved page GET must not issue generation lookups');
 });
 await check('R11 fresh continuation preparation binds the same Goal and remaining cap; forged predecessor cannot prepare',async()=>{
  await reconciledHistorical();const before=fixture().providerCalls.length,saved=structuredClone(fixture()),effects=boundary.effects.length,initial=await get();assert.match(initial,/Prepare continuation quote and setup/);assert.match(initial,/Remaining allowance:.*\$0\.239932 USD/);assert.match(initial,/Unchanged Business lifetime cap:.*\$0\.848063 USD/);
  const invalid=await post('Prepare continuation quote and setup',{predecessorPolicyId:r11Scope.otherBusinessId},origin,initial);assert.match(invalid,/Continuation setup could not be verified/);assert.doesNotMatch(invalid,/id="research-setup-metadata"/);
  const html=await post('Prepare continuation quote and setup',{maximumMicrousd:'250000',remainingMicrounits:'999999999',lifetimeCapMicrounits:'999999999',preparedAt:'2099-01-01T00:00:00Z',expiresAt:'2099-12-31T00:00:00Z',quoteValidUntil:'2099-12-31T00:00:00Z'},origin,initial);assert.match(researchHtmlText(html),/Setup metadata prepared/);const prepared=researchPreparedMetadata(html,'continuation');
  assert.equal(prepared.mode,'continuation');assert.equal(prepared.predecessorPolicyId,r11Scope.policyId);assert.equal(prepared.continuation.goalId,r11Scope.goalId);assert.equal(prepared.continuation.lifetimeCapMicrounits,'848063');assert.equal(prepared.continuation.exposureMicrounits,'608131');assert.equal(prepared.continuation.remainingMicrounits,'239932');assert.equal(prepared.quote.maximumMicrousd,239932);assert.equal(prepared.authorityCreated,false);assert.equal(prepared.paidCalls,0);assert.notEqual(prepared.policyId,r11Scope.policyId);assert.notEqual(prepared.workflowRunId,r11Scope.workflowRunId);assert.notEqual(prepared.serverKeyHash,fixture().grants[0].grant.serverKeyHash);assert.ok(!html.includes(R11_INERT_SERVER_KEY));assert.equal(fixture().providerCalls.length,before);assert.equal(fixture().policies.length,1);assert.deepEqual(fixture(),saved);assert.equal(boundary.effects.length,effects);
 });
 await check('R11 separately reviewed continuation needs both exact consents, preserves old charges, and dispatches only its two fresh phases',async()=>{
  await reconciledHistorical();await control({r11InstallContinuation:true});const identity=r11ContinuationScope.grantId,policyId=r11ContinuationScope.policyId,activateFresh=(values={})=>post('Activate reviewed proof',values,origin,null,identity);
  const initial=await get();assert.match(researchHtmlText(initial),/New one-time research cap: \$0\.239932 USD/);assert.match(initial,/authorize.*this one fresh continuation attempt/);assert.match(initial,/same Business and Goal/);
  const prior=structuredClone(fixture().policies[0]),settlement=structuredClone(fixture().settlements[0]);await activateFresh();await activateFresh({readConsent:'on'});assert.equal(fixture().policies.length,1);await activateFresh({readConsent:'on',retentionConsent:'on',grantHash:'f'.repeat(64)});assert.equal(fixture().policies.length,1);
  let html=await activateFresh({readConsent:'on',retentionConsent:'on'});assert.match(html,/Ready.*pending proof/);assert.equal(fixture().policies.length,2);assert.equal(fixture().policies[1].goalId,r11Scope.goalId);assert.equal(fixture().policies[1].attemptVersion,2);assert.equal(fixture().policies[1].policy.maximumMicrousd,239932);assert.equal(fixture().lifetimeCapMicrounits,'848063');assert.deepEqual(fixture().policies[0],prior);assert.deepEqual(fixture().settlements[0],settlement);
  await activateFresh({readConsent:'on',retentionConsent:'on'});assert.equal(fixture().policies.length,2);assert.equal(fixture().providerCalls.length,1);
  const catalogs=boundary.log.filter(item=>item.kind==='inert-r11-public-catalog').length;
  html=await post('Run public evidence proof',{},origin,null,policyId);assert.match(html,/data-r11-result=/);assert.equal(fixture().providerCalls.length,3);assert.deepEqual(fixture().providerCalls.filter(item=>item.policyId===policyId).map(item=>item.phase),['search','select']);assert.equal(fixture().results.length,1);assert.equal(fixture().results[0].policyId,policyId);assertResearchPhaseQuoteWindows(fixture(),policyId);assert.equal(boundary.log.filter(item=>item.kind==='inert-r11-public-catalog').length,catalogs+8,'Both phases fetch independent four-part fresh public quotes');assert.deepEqual(fixture().settlements[0],settlement);assert.deepEqual(fixture().policies[0],prior);
  await post('Run public evidence proof',{},origin,null,policyId);await post('Run public evidence proof',{},origin,null,r11Scope.policyId);await get();await get(noKeyOrigin);assert.equal(fixture().providerCalls.length,3);assert.equal(fixture().results.length,1);
 });
 await check('R11 continuation activation rejects a tampered reviewed cap or predecessor without authority or paid effects',async()=>{
  for(const r11ContinuationTamper of ['budget','predecessor']){
   await reconciledHistorical();await control({r11InstallContinuation:true,r11ContinuationTamper});
   await post('Activate reviewed proof',{readConsent:'on',retentionConsent:'on'},origin,null,r11ContinuationScope.grantId);assert.equal(fixture().policies.length,1);assert.equal(fixture().continuationGrants[0].used,false);assert.equal(fixture().providerCalls.length,1);assert.equal(fixture().settlements[0].actualMicrounits,'10068');
  }
 });
 await reset();
}
