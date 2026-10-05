import assert from 'node:assert/strict';
import {r11Scope} from './r11-research.mjs';
export const researchRoute=(business=r11Scope.businessId)=>'/dashboard/research-qualification?'+new URLSearchParams({business});
export const researchControl=(boundary,values)=>fetch(boundary.origin+'/control',{method:'POST',body:JSON.stringify(values),signal:AbortSignal.timeout(10_000)});
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
function renderedForm(html,button){
 const forms=[...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].filter(match=>match[1].includes(button));
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
 const post=async(button,values={},base=origin,html=null)=>{
  const data=renderedForm(html??await get(base),button);for(const [key,value]of Object.entries(values))data.set(key,value);
  const response=await fetch(base+researchRoute(),{method:'POST',headers:{origin:base,accept:'text/html'},body:data,redirect:'manual',signal:AbortSignal.timeout(30_000)});
  assert.ok([200,303].includes(response.status),`Unexpected actual form POST status ${response.status}`);
  if(response.status===303){const url=new URL(response.headers.get('location'),base);assert.equal(url.origin,base);assert.equal(url.pathname,'/dashboard/research-qualification');return get(base,url.searchParams.get('business'));}
  return response.text();
 };
 const reset=()=>control({r11Research:true,resetResearch:true,r11Expired:false,r11ReadUnavailable:false,r11CatalogUnavailable:false,r11ProviderFailure:null,r11UnknownCost:false,r11InvalidSelection:false,r11CompleteFailure:false,r11StopFailure:false});
 const activate=()=>post('Activate reviewed proof',{readConsent:'on',retentionConsent:'on'});
 await check('R11 actual HTML form preparation validates current public quote without creating authority',async()=>{
  await reset();const before=boundary.effects.length,catalogs=boundary.log.filter(item=>item.kind==='inert-r11-public-catalog').length;
  const initial=await get(),submitted=renderedForm(initial,'Prepare public quote and setup'),html=await post('Prepare public quote and setup',{},origin,initial);assert.match(html,/Setup metadata prepared/);assert.match(html,/research-setup-metadata/);
  const pre=html.match(/<pre\b[^>]*>([\s\S]*?)<\/pre>/);assert.ok(pre);const preparation=JSON.parse(decodeAttribute(pre[1]));
  assert.equal(preparation.businessId,r11Scope.businessId);assert.equal(preparation.policyId,submitted.get('policyId'));assert.equal(preparation.workflowRunId,submitted.get('workflowRunId'));assert.equal(preparation.authorityCreated,false);assert.equal(preparation.paidCalls,0);assert.match(preparation.serverKeyHash,/^[a-f0-9]{64}$/);assert.match(preparation.runtimeCapabilityHash,/^[a-f0-9]{64}$/);
  assert.equal(boundary.effects.length,before);assert.equal(fixture().providerCalls.length,0);assert.equal(boundary.log.filter(item=>item.kind==='inert-r11-public-catalog').length,catalogs+2);
 });
 await check('R11 actual HTML actions require both consents and exact Business grant identity',async()=>{
  await reset();await post('Activate reviewed proof');assert.equal(fixture().policies.length,0);await post('Activate reviewed proof',{readConsent:'on'});assert.equal(fixture().policies.length,0);
  await post('Activate reviewed proof',{readConsent:'on',retentionConsent:'on',grantHash:'f'.repeat(64)});assert.equal(fixture().policies.length,0);
  await post('Activate reviewed proof',{readConsent:'on',retentionConsent:'on',businessId:r11Scope.otherBusinessId});assert.equal(fixture().policies.length,0);
  const before=boundary.effects.filter(item=>item.kind==='in-memory-r11-research-activation').length;
  const html=await activate();assert.match(html,/Ready.*pending proof/);await activate();assert.equal(fixture().policies.length,1);assert.equal(boundary.effects.filter(item=>item.kind==='in-memory-r11-research-activation').length,before+1);assert.equal(fixture().providerCalls.length,0);
  await post('Run public evidence proof',{businessId:r11Scope.otherBusinessId});assert.equal(fixture().providerCalls.length,0);
 });
 await check('R11 actual HTML Run action uses the real bounded runner and saves one validated result without replay',async()=>{
  await reset();await activate();const html=await post('Run public evidence proof');assert.match(html,/Saved validated evidence/);assert.match(html,/Synthetic public gardening report/);assert.match(html,/data-r11-result=/);assert.equal(fixture().providerCalls.length,2);assert.deepEqual(fixture().providerCalls.map(item=>item.phase),['search','select']);assert.equal(fixture().markers.length,2);assert.equal(fixture().settlements.length,2);assert.equal(fixture().collections.length,1);assert.equal(fixture().results.length,1);
  await post('Run public evidence proof');await get();await get();assert.equal(fixture().providerCalls.length,2);assert.equal(fixture().results.length,1);
  await control({r11Expired:true});const retained=await get(noKeyOrigin);assert.match(retained,/data-r11-result=/);assert.match(retained,/dedicated admission or provider configuration is incomplete/);assert.match(retained,/Expired: no new dispatch/);
  const stopped=await post('Stop this proof',{},noKeyOrigin);assert.match(stopped,/Revoked: further dispatch is stopped/);assert.match(stopped,/data-r11-result=/);assert.equal(fixture().providerCalls.length,2);
 });
 await check('R11 actual HTML Run action retains unknown search exposure and never retries or fabricates success',async()=>{
  await reset();await activate();await control({r11ProviderFailure:'search'});const html=await post('Run public evidence proof');assert.match(html,/Held.*dispatched outcome unverified/);assert.match(html,/Unknown charge remains held/);assert.doesNotMatch(html,/data-r11-result=/);assert.equal(fixture().markers.length,1);assert.equal(fixture().providerCalls.length,1);assert.equal(fixture().settlements.length,0);
  await post('Run public evidence proof');await get();assert.equal(fixture().providerCalls.length,1);
  await control({r11StopFailure:true});await post('Stop this proof');assert.equal(fixture().policies[0].revoked,false);
  await control({r11StopFailure:false});await post('Stop this proof',{},noKeyOrigin);assert.equal(fixture().policies[0].revoked,true);assert.equal(fixture().providerCalls.length,1);
 });
 await check('R11 actual HTML action cannot turn settled selector markers or persistence failure into success',async()=>{
  for(const scenario of [{r11InvalidSelection:true},{r11CompleteFailure:true}]){
   await reset();await activate();await control(scenario);const html=await post('Run public evidence proof');assert.match(html,/Held.*dispatched outcome unverified/);assert.doesNotMatch(html,/data-r11-result=/);assert.equal(fixture().providerCalls.length,2);assert.equal(fixture().settlements.length,2);assert.equal(fixture().results.length,0);
   await post('Run public evidence proof');await get();assert.equal(fixture().providerCalls.length,2);
  }
 });
 await reset();
}
