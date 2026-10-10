import{validatePublicResearchRepairPolicy}from './discovery-r12-public-repair';
import 'server-only';
import {createHmac,randomUUID} from 'node:crypto';
import {start,resumeHook,getHookByToken} from 'workflow/api';
import {HookNotFoundError} from 'workflow/internal/errors';
import type {OwnerUiContext} from '../lib/core-ui/data';
import {verifyOwnerBusiness} from '../lib/core-ui/owner-business';
import {boundedRpc,requestDeadline} from '../core/request-deadline';
import {publicUuid,publicHash,publicResearchHash as hash} from './discovery-r12-public-utils';
import {validatePublicResearchOwnerTestReceipt,validatePublicResearchOwnerTestInput,validatePublicResearchProfile,qualifyPublicResearchWindowQuote,validatePublicResearchBrowserQuote} from './discovery-r12-public-preparation';
import {validatePublicResearchPolicy,validatePublicResearchCommand} from './discovery-r12-public-contracts';
import {fetchAdaptiveResearchQuote} from './discovery-r12-adaptive-quote';
import {createRuntimeClient} from '../lib/supabase/runtime';
import {deriveDirectServerKey} from './discovery-r12-public-server-key';
import {directResearchRuntimeWorkflow,directResearchResumeToken} from '../workflows/direct-research-runtime';
const object=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
function check(x:unknown):asserts x{if(!x)throw Error('r12_direct_owner_unconfirmed');}
async function owner(context:OwnerUiContext,businessId:string,goalId:string){check(publicUuid(businessId)&&publicUuid(goalId)&&await verifyOwnerBusiness(context,businessId));const claims=await context.supabase.auth.getClaims();check(!claims.error&&claims.data?.claims?.sub===context.userId);}
function bootstrap(context:OwnerUiContext,businessId:string,grantId:string){const key=process.env.R05_ADMISSION_SERVER_KEY?.trim();check(process.env.VERCEL_ENV==='production'&&key&&key.length>=32&&key.length<=200&&publicUuid(grantId));return createHmac('sha256',key).update(JSON.stringify({version:'r12.owner-bootstrap.1',businessId,ownerId:context.userId,grantId})).digest('base64url');}
async function server(context:OwnerUiContext,businessId:string,grantId:string,operation:string,payload:Record<string,unknown>){const r=await boundedRpc(context.supabase.rpc('r12_owner_direct_server',{p_business_id:businessId,p_operation:operation,p_payload:payload,p_server_key:bootstrap(context,businessId,grantId)}),requestDeadline(15000),10000);check(!r.error&&r.data!==null);return r.data as unknown;}
export async function readDirectResearchCatalog(context:OwnerUiContext,businessId:string,goalId:string,envelopeId?:string){await owner(context,businessId,goalId);check(!envelopeId||publicUuid(envelopeId));const r=await boundedRpc(context.supabase.rpc('r12_owner_direct_read',{p_business_id:businessId,p_goal_id:goalId,p_test_envelope_id:envelopeId??null}),requestDeadline(15000),10000);check(!r.error&&object(r.data)&&r.data.version==='r12.owner-direct-catalog.1'&&r.data.businessId===businessId&&r.data.goalId===goalId&&Array.isArray(r.data.grants));return r.data as Record<string,unknown>;}
export async function prepareDirectResearchTest(context:OwnerUiContext,raw:unknown){
 const input=validatePublicResearchOwnerTestInput(raw);const catalog=await readDirectResearchCatalog(context,input.businessId,input.goalId);check(catalog.eligible===true&&(catalog.grants as unknown[]).some(g=>object(g)&&g.grantId===input.grantId));
 const q=await server(context,input.businessId,input.grantId,'initial_quote_context',{grantId:input.grantId});check(object(q)&&q.version==='r12.direct-initial-quote-context.1'&&q.businessId===input.businessId&&q.goalId===input.goalId&&q.grantId===input.grantId);const{contextHash,...body}=q;check(contextHash===hash(body));validatePublicResearchBrowserQuote(q.setupQuote);validatePublicResearchBrowserQuote(q.verificationQuote);
 const r=await server(context,input.businessId,input.grantId,'prepare_test',{input,setupQuote:q.setupQuote,verificationQuote:q.verificationQuote});return validatePublicResearchOwnerTestReceipt(r,{businessId:input.businessId,goalId:input.goalId});
}
async function saved(context:OwnerUiContext,businessId:string,goalId:string,envelopeId:string){const c=await readDirectResearchCatalog(context,businessId,goalId,envelopeId);return{catalog:c,receipt:validatePublicResearchOwnerTestReceipt(c.current,{businessId,goalId,testEnvelopeId:envelopeId})};}
export async function confirmDirectResearchTest(context:OwnerUiContext,businessId:string,goalId:string,envelopeId:string,envelopeHash:string){const{receipt:r}=await saved(context,businessId,goalId,envelopeId);check(r.testEnvelopeHash===envelopeHash);return validatePublicResearchOwnerTestReceipt(await server(context,businessId,r.preview.grantId,'confirm_test',{testEnvelopeId:envelopeId,testEnvelopeHash:envelopeHash,submissionId:randomUUID()}),{businessId,goalId,testEnvelopeId:envelopeId,testEnvelopeHash:envelopeHash});}
export async function stopDirectResearchTest(context:OwnerUiContext,businessId:string,goalId:string,envelopeId:string){const{receipt:r}=await saved(context,businessId,goalId,envelopeId);return server(context,businessId,r.preview.grantId,'stop_test',{testEnvelopeId:envelopeId,testEnvelopeHash:r.testEnvelopeHash,submissionId:randomUUID()});}
export async function prepareDirectResearchCycle(context:OwnerUiContext,businessId:string,goalId:string,envelopeId:string,initialCommand:unknown){
 const{receipt:r}=await saved(context,businessId,goalId,envelopeId);check(r.confirmed&&!r.stopped);const command=validatePublicResearchCommand(initialCommand);check(command.kind!=='finish');const pins={testEnvelopeId:envelopeId,testEnvelopeHash:r.testEnvelopeHash};
 const [q,source,inference]=await Promise.all([server(context,businessId,r.preview.grantId,'research_quote_context',pins),server(context,businessId,r.preview.grantId,'research_source_context',pins),fetchAdaptiveResearchQuote({version:'r12.adaptive-quote.2'})]);
 check(object(q)&&object(source)&&source.version==='r12.direct-research-source-context.1'&&source.businessId===businessId&&source.goalId===goalId&&source.testEnvelopeId===envelopeId&&source.testEnvelopeHash===r.testEnvelopeHash);const{contextHash,...body}=source;check(contextHash===hash(body));
 check(inference.version==='r12.adaptive-quote.2');
 const quote=qualifyPublicResearchWindowQuote(inference,q.browserQuote as Parameters<typeof qualifyPublicResearchWindowQuote>[1],r.preview.maximumMicrounits,Date.now(),r.preview.maximumAttemptsInWindow);
 return server(context,businessId,r.preview.grantId,'prepare_research_v2',{...pins,initialCommand:command,quote,sourceAccess:source.sourceAccess,submissionId:randomUUID()});
}
/** Confirm the exact saved preview before starting one durable runtime. A lost
 * hosting response is reconciled through its immutable SQL attachment, never a
 * second paid path. The saved versioned policy controls repair accounting. */
export async function confirmAndStartDirectResearch(context:OwnerUiContext,businessId:string,goalId:string,envelopeId:string,setupId:string,setupHash:string){
 const{receipt:r,catalog}=await saved(context,businessId,goalId,envelopeId);check(publicUuid(setupId)&&publicHash(setupHash)&&object(catalog.research)&&catalog.research.setupId===setupId&&catalog.research.setupHash===setupHash);
 const result=await server(context,businessId,r.preview.grantId,'confirm_research',{setupId,setupHash,submissionId:randomUUID()});check(object(result)&&object(result.preview)&&result.confirmed===true&&result.setupId===setupId&&result.setupHash===setupHash&&hash(result.preview)===setupHash);
 const p=result.preview,policy=object(p.policy)&&p.policy.version==='r12.direct-etsy-attempt-policy.2'?validatePublicResearchRepairPolicy(p.policy):validatePublicResearchPolicy(p.policy),profile=validatePublicResearchProfile(p.profile);check(policy.businessId===businessId&&policy.goalId===goalId&&p.testEnvelopeHash===r.testEnvelopeHash&&publicUuid(result.scopeId)&&publicHash(result.scopeHash)&&publicHash(result.planHash));
 const existing=await directRuntimeRead(context,r,result.scopeId as string);if(object(existing.runtime)&&typeof existing.runtime.runtimeRunId==='string')return{scopeId:result.scopeId,runtimeRunId:existing.runtime.runtimeRunId};
 try{const hook=await getHookByToken(directResearchResumeToken(result.scopeId as string));check(hook.isWebhook===false&&typeof hook.runId==='string');return{scopeId:result.scopeId,runtimeRunId:hook.runId};}catch(error){if(!HookNotFoundError.is(error))throw Error('r12_direct_runtime_unconfirmed');}
 const runtime=await start(directResearchRuntimeWorkflow,[{businessId,goalId,ownerId:context.userId,grantId:r.preview.grantId,testEnvelopeId:envelopeId,envelopeHash:r.testEnvelopeHash,routeHash:r.preview.setupOperation.routeHash,scopeId:result.scopeId,scopeHash:result.scopeHash,planHash:result.planHash,profileHash:profile.profileHash,policyHash:policy.policyHash}]);
 return{scopeId:result.scopeId,runtimeRunId:runtime.runId};
}

/** Save a pending access disclosure only. This cannot create a provider session
 * or approve persistence; the owner must approve the exact separately shown
 * scope before the existing owner-only handoff can start. */
export async function prepareDirectEtsyAccess(context:OwnerUiContext,businessId:string,goalId:string,envelopeId:string,expectedShopName:string){
 const{receipt:r,catalog}=await saved(context,businessId,goalId,envelopeId);check(r.confirmed&&!r.stopped&&typeof expectedShopName==='string'&&expectedShopName.trim()===expectedShopName&&expectedShopName.length>0&&expectedShopName.length<=120);
 if(object(catalog.ownerAccess)){check(catalog.ownerAccess.testEnvelopeId===envelopeId&&publicUuid(catalog.ownerAccess.operationId));const{readEtsySteelOwnerSetup}=await import('../accounts/etsy-steel-handoff-owner-server');const existing=await readEtsySteelOwnerSetup(context,businessId,catalog.ownerAccess.operationId as string);check(existing.scope.expectedShopName===expectedShopName);return{operationId:existing.operationId,scopeHash:existing.scopeHash};}
 const q=await server(context,businessId,r.preview.grantId,'initial_quote_context',{grantId:r.preview.grantId});check(object(q)&&object(q.routeAuthority));const duration=q.routeAuthority.maximumSessionMs;check(typeof duration==='number'&&Number.isSafeInteger(duration)&&duration>=15000&&duration<=900000&&q.routeAuthority.routeHash===r.preview.setupOperation.routeHash);
 const now=Date.now(),expires=Date.parse(r.expiresAt);check(expires>now+15000);
 const{buildEtsySteelHandoffDisclosure,validateEtsySteelHandoffScope}=await import('../accounts/etsy-steel-handoff-contracts');
 const body={version:'etsy.steel-owner-handoff-scope.1' as const,operationId:randomUUID(),ownerId:context.userId,businessId,goalId,authorityRootId:r.preview.authorityRootId,testEnvelopeId:envelopeId,testEnvelopeHash:r.testEnvelopeHash,providerProjectId:r.preview.setupQuote.providerProjectId,verificationOperationId:randomUUID(),verificationMaximumMicrounits:r.preview.verificationOperation.maximumMicrounits,verificationQuoteHash:r.preview.verificationOperation.quoteHash,accountId:randomUUID(),accountRevision:randomUUID(),expectedShopName,expectedShopId:null,purpose:'etsy_insights_read_only' as const,approvalId:randomUUID(),approvalRevision:randomUUID(),approvedAt:new Date(now).toISOString(),approvalExpiresAt:new Date(Math.min(expires,now+1800000)).toISOString(),profileAccessExpiresAt:r.expiresAt,maximumSessionMs:duration,maximumBrowserMicrounits:r.preview.setupOperation.maximumMicrounits,currency:'USD' as const,quoteHash:r.preview.setupOperation.quoteHash};
 const disclosure=buildEtsySteelHandoffDisclosure(body),scope=validateEtsySteelHandoffScope({...body,disclosureHash:hash(disclosure)});
 const{deriveDirectServerKey}=await import('./discovery-r12-public-server-key');const key=deriveDirectServerKey(bootstrap(context,businessId,r.preview.grantId),{businessId,goalId,testEnvelopeId:envelopeId,envelopeHash:r.testEnvelopeHash,routeHash:r.preview.setupOperation.routeHash,purpose:'handoff'});
 const result=await boundedRpc(createRuntimeClient().rpc('r12_etsy_steel_server',{p_business_id:businessId,p_operation:'prepare',p_payload:{scope,disclosure},p_server_key:key}),requestDeadline(15000),10000);check(!result.error&&object(result.data)&&result.data.operationId===scope.operationId&&result.data.scopeHash===hash(scope)&&result.data.status==='pending_approval');
 return{operationId:scope.operationId,scopeHash:hash(scope)};
}

async function directRuntimeRead(context:OwnerUiContext,r:ReturnType<typeof validatePublicResearchOwnerTestReceipt>,scopeId:string){
 const key=deriveDirectServerKey(bootstrap(context,r.businessId,r.preview.grantId),{businessId:r.businessId,goalId:r.goalId,testEnvelopeId:r.testEnvelopeId,envelopeHash:r.testEnvelopeHash,routeHash:r.preview.setupOperation.routeHash,purpose:'controller'});
 const response=await boundedRpc(createRuntimeClient().rpc('r12_direct_controller_server',{p_business_id:r.businessId,p_scope_id:scopeId,p_operation:'read',p_payload:{},p_server_key:key}),requestDeadline(15000),10000);check(!response.error&&object(response.data));return response.data as Record<string,unknown>;
}
export async function resumeDirectResearch(context:OwnerUiContext,businessId:string,goalId:string,envelopeId:string){
 const{receipt:r,catalog}=await saved(context,businessId,goalId,envelopeId);check(object(catalog.research)&&publicUuid(catalog.research.scopeId));const scopeId=catalog.research.scopeId as string,current=await directRuntimeRead(context,r,scopeId);check(current.runtime===null||object(current.runtime)&&typeof current.runtime.runtimeRunId==='string');
 const hook=await getHookByToken(directResearchResumeToken(scopeId));check(hook.isWebhook===false&&typeof hook.runId==='string'&&(!object(current.runtime)||hook.runId===current.runtime.runtimeRunId));
 await resumeHook(hook,{operation:'reconcile'});return{runtimeRunId:hook.runId};
}
