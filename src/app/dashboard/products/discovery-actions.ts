"use server";
import {randomUUID} from "node:crypto";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {start} from "workflow/api";
import {requireOwnerUiContext} from "@/lib/core-ui/data";
import {buildDiscoveryIntentFromGoal,discoveryGoalBudgetScope,parseDiscoveryAllowance} from "@/products/discovery-v2-goal";
import {fetchDiscoveryV2ModelQuote,quoteDiscoveryV2,discoveryV2Model} from "@/products/discovery-v2-budget";
import {loadDiscoveryGoalData,loadDiscoveryChainBalance} from "@/products/discovery-v2-data";
import type {ProductExperimentRecord} from "@/products/types";
import {validateDiscoveryIntentV2} from "@/products/discovery-v2";
import {installedPackRuntimeWorkflow} from "@/workflows/installed-pack-runtime";
const text=(form:FormData,key:string)=>typeof form.get(key)==='string'?String(form.get(key)).trim():'';
function fail(message:string):never{redirect(`/dashboard/products?error=${encodeURIComponent(message.slice(0,350))}`);}
export async function startGeographicDiscovery(form:FormData){
  const context=await requireOwnerUiContext(),businessId=text(form,'businessId');
  if(!context.businesses.some(b=>b.id===businessId))fail('Business not found.');
  if(text(form,'confirmResearch')!=='on')fail('Confirm the bounded research allowance before starting.');
  let intent,quote;
  try{
    const count=Number(text(form,'maximumCollections')||'1');if(count!==1&&count!==2)throw new Error('Only one or two fixed source collections are supported.');
    intent=buildDiscoveryIntentFromGoal({id:randomUUID(),businessId,goal:text(form,'goal'),audienceHint:text(form,'audienceHint'),maximumMicrousd:parseDiscoveryAllowance(text(form,'maximumUsd')),maximumCollections:count});
    const [director,reviewer]=await Promise.all([fetchDiscoveryV2ModelQuote(discoveryV2Model('plan:1')),fetchDiscoveryV2ModelQuote(discoveryV2Model('review:1'))]);
    quote=quoteDiscoveryV2(discoveryGoalBudgetScope(intent),{director,reviewer});
  }catch(error){fail(error instanceof Error?error.message:'The complete research quote could not be verified.');}
  const runtimeCapability=`${randomUUID()}${randomUUID()}`,nonce=randomUUID();
  const launchResult=await context.supabase.rpc('begin_installed_pack_run',{p_business_id:businessId,p_installation_id:null,p_workflow_key:`product.discovery-v2.${intent.limits.maximumNewCollections===1?'one':'two'}`,
    p_input:{intent,quote,ownerKickoff:{confirmed:true,focus:intent.objective,followUpBasis:null},priorArtifactIds:[]},p_idempotency_key:`discovery:${intent.id}`,p_launch_nonce:nonce,p_runtime_capability:runtimeCapability});
  if(launchResult.error)fail(launchResult.error.message);
  const launch=launchResult.data as {workflowRunId:string;shouldStart:boolean};
  if(launch.shouldStart){
    try{await start(installedPackRuntimeWorkflow,[{businessId,coreWorkflowRunId:launch.workflowRunId,runtimeCapability}]);}
    catch{fail('The workflow launch could not be confirmed. Its durable reservation remains in history. Inspect that workflow before another attempt; no automatic retry was made.');}
  }
  revalidatePath('/dashboard/products');revalidatePath('/dashboard/workflows');
  redirect(`/dashboard/workflows/${launch.workflowRunId}`);
}

export async function refreshGeographicDiscovery(form:FormData){
  const context=await requireOwnerUiContext(),rootId=text(form,'rootId'),reason=text(form,'question');
  if(text(form,'confirmResearch')!=='on')fail('Confirm the focused research continuation before starting.');
  const rootResult=await context.supabase.from('product_experiments').select('*').eq('id',rootId).eq('discovery_version','pod-discovery-2.0').is('parent_discovery_id',null).maybeSingle();
  const root=rootResult.data as ProductExperimentRecord|null;
  if(rootResult.error||!root||!context.businesses.some(b=>b.id===root.business_id)||!['completed','failed'].includes(root.status))fail('A completed or failed owned research goal is required.');
  const saved=await loadDiscoveryGoalData(context,[root]);
  const record=saved.records[0];
  if(!record?.intent||saved.errors.length)fail('The preserved goal and evidence could not be verified.');
  const acceptedReason=root.status==='failed'&&reason==='retry_after_known_failed_call'||root.status==='completed'&&record.review?.outcome==='NEEDS_MORE_EVIDENCE'&&record.review.missingQuestions.includes(reason);
  if(!acceptedReason)fail('Choose an exact unanswered question from this goal. A new reason cannot reset its authority.');
  let intent,quote,priorArtifactIds:string[];
  try{
    const balance=await loadDiscoveryChainBalance(context,root);
    if(balance.hasUncertainCosts)throw new Error('A prior charge is still unknown. No further call is permitted.');
    intent=structuredClone(record.intent);intent.id=randomUUID();intent.expiresAt=new Date(Date.now()+86400000).toISOString();
    intent.limits.maximumNewCollections=1;intent.limits.maximumMicrousd=balance.maximumMicrousd;
    validateDiscoveryIntentV2(intent);
    const [director,reviewer]=await Promise.all([fetchDiscoveryV2ModelQuote(discoveryV2Model('plan:1')),fetchDiscoveryV2ModelQuote(discoveryV2Model('review:1'))]);
    quote=quoteDiscoveryV2(discoveryGoalBudgetScope(intent),{director,reviewer});
    if(quote.maximumEstimateMicrousd>balance.remainingMicrousd)throw new Error('The complete focused follow-up estimate exceeds the original remaining allowance. This goal cannot start more calls.');
    const refs=record.dossier?.packRefs.map(p=>p.artifactId)??[];
    priorArtifactIds=[...new Set([...record.sourcePacks.map(p=>p.id),...refs])];
    if(priorArtifactIds.length>4)throw new Error('This follow-up exceeds the bounded prior-evidence dossier; a reviewed evidence selection is needed before more research.');
  }catch(error){fail(error instanceof Error?error.message:'The focused continuation could not be verified.');}
  const runtimeCapability=`${randomUUID()}${randomUUID()}`,nonce=randomUUID();
  const focus=reason==='retry_after_known_failed_call'?'Continue the preserved goal after the known failed call, retaining every validated source.':`Answer this missing question: ${reason}`;
  const reserved=await context.supabase.rpc('begin_installed_pack_run',{p_business_id:root.business_id,p_installation_id:null,p_workflow_key:'product.discovery-v2.one',p_input:{intent,quote,ownerKickoff:{confirmed:true,focus,followUpBasis:{rootId:root.id,reason}},priorArtifactIds},p_idempotency_key:`discovery:${intent.id}`,p_launch_nonce:nonce,p_runtime_capability:runtimeCapability});
  if(reserved.error)fail(reserved.error.message);
  const launch=reserved.data as{workflowRunId:string;shouldStart:boolean};
  if(launch.shouldStart){try{await start(installedPackRuntimeWorkflow,[{businessId:root.business_id,coreWorkflowRunId:launch.workflowRunId,runtimeCapability}]);}catch{fail('Continuation launch is unconfirmed. Its durable history is preserved; inspect the workflow before another attempt.');}}
  revalidatePath('/dashboard/products');redirect(`/dashboard/workflows/${launch.workflowRunId}`);
}
