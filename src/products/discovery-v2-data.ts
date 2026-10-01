import type { OwnerUiContext } from "../lib/core-ui/data";
import type { JsonObject } from "../core/contracts";
import type { ProductExperimentRecord } from "./types";
import type { DiscoveryIntentV2, DiscoveryDossierV2, StrategistAssessmentV2, ReviewerDecisionV2 } from "./discovery-v2";
export type DiscoveryGoalRecord={root:ProductExperimentRecord;intent:DiscoveryIntentV2|null;dossier:DiscoveryDossierV2|null;strategy:StrategistAssessmentV2|null;review:ReviewerDecisionV2|null;sourcePacks:{id:string;content:JsonObject}[]};
export type DiscoveryGoalData={available:boolean;records:DiscoveryGoalRecord[];errors:string[]};
function object(v:unknown):v is Record<string,unknown>{return !!v&&typeof v==='object'&&!Array.isArray(v);}
export async function loadDiscoveryGoalData(context:OwnerUiContext,experiments:ProductExperimentRecord[]):Promise<DiscoveryGoalData>{
  const catalog=await context.supabase.from("packs").select("id,status").eq("pack_key","workflow.product-discovery-v2").eq("version","1.0.0").maybeSingle();
  const roots=experiments.filter(e=>e.discovery_version==='pod-discovery-2.0'&&e.candidate_id===null&&!e.parent_discovery_id);
  const empty={available:!catalog.error&&['experimental','qualified'].includes(catalog.data?.status??''),records:[],errors:catalog.error?["The geographic discovery workflow could not be checked."]:[]};
  if(!roots.length)return empty;
  const results=await context.supabase.from("artifacts").select("id,business_id,workflow_run_id,artifact_type,content,metadata").in("business_id",context.businesses.map(b=>b.id)).in("workflow_run_id",roots.map(e=>e.workflow_run_id)).in("artifact_type",["worker.output","product.discovery-dossier.v2"]);
  if(results.error)return{...empty,records:roots.map(root=>({root,intent:null,dossier:null,strategy:null,review:null,sourcePacks:[]})),errors:[...empty.errors,"Saved discovery artifacts could not be loaded; their absence is not a negative result."]};
  const artifacts=results.data??[];
  const priorIds=[...new Set(artifacts.flatMap(a=>a.artifact_type==='product.discovery-dossier.v2'&&object(a.content)&&Array.isArray(a.content.packRefs)?a.content.packRefs.flatMap((ref:unknown)=>object(ref)&&typeof ref.artifactId==='string'?[ref.artifactId]:[]):[]))].filter(id=>!artifacts.some(a=>a.id===id));
  const prior=priorIds.length?await context.supabase.from("artifacts").select("id,business_id,workflow_run_id,artifact_type,content,metadata").in("business_id",context.businesses.map(b=>b.id)).in("id",priorIds).eq("artifact_type","worker.output"):{data:[],error:null};
  if(prior.error)empty.errors.push("Some preserved prior Evidence Packs could not be loaded; inspect the linked workflow history.");
  const allSources=[...artifacts,...prior.data??[]];
  return{...empty,records:roots.map(root=>{const own=artifacts.filter(a=>a.business_id===root.business_id&&a.workflow_run_id===root.workflow_run_id);
    const phase=(key:string)=>own.find(a=>a.artifact_type==='worker.output'&&object(a.metadata)&&a.metadata.stageKey===key)?.content;
    const strategy=phase('strategy'),review=phase('review');
    const variables=root.variables as Record<string,unknown>;
    const dossier=(own.find(a=>a.artifact_type==='product.discovery-dossier.v2')?.content??null) as DiscoveryDossierV2|null;
    const refIds=new Set(dossier?.packRefs?.map(ref=>ref.artifactId)??[]);
    return{root,intent:object(variables.intent)&&variables.intent.version==='pod-discovery-2.0'?variables.intent as unknown as DiscoveryIntentV2:null,
      dossier,
      strategy:object(strategy)&&strategy.version==='pod-discovery-2.0'?strategy as unknown as StrategistAssessmentV2:null,
      review:object(review)&&review.version==='pod-discovery-2.0'?review as unknown as ReviewerDecisionV2:null,
      sourcePacks:allSources.filter(a=>a.business_id===root.business_id&&(a.workflow_run_id===root.workflow_run_id||refIds.has(a.id))&&a.artifact_type==='worker.output'&&object(a.content)&&object(a.content.evidencePack)).map(a=>({id:a.id,content:a.content as JsonObject}))};})};
}
export type DiscoveryChainBalance={maximumMicrousd:number;knownMicrousd:number;pendingExposureMicrousd:number;remainingMicrousd:number;hasUncertainCosts:boolean};
/** Owner-scoped display/preflight only. Atomic enforcement remains inside the existing runtime RPCs. */
export async function loadDiscoveryChainBalance(context:OwnerUiContext,root:ProductExperimentRecord):Promise<DiscoveryChainBalance>{
  const authorityId=(root.variables as Record<string,unknown>).budgetAuthorityRootId;
  if(typeof authorityId!=='string')throw new Error('The immutable shared research authority could not be loaded.');
  const authority=await context.supabase.from('product_experiments').select('id,variables').eq('id',authorityId).eq('business_id',root.business_id).maybeSingle();
  const maximum=authority.data?.variables?.intent?.limits?.maximumMicrousd;
  if(authority.error||!Number.isSafeInteger(maximum)||maximum<1||maximum>2_000_000)throw new Error('The original research allowance is unavailable.');
  const funding=await context.supabase.from('product_research_funding_approvals').select('maximum_microusd',{count:'exact'}).eq('business_id',root.business_id).eq('authority_root_id',authorityId).limit(1001);
  if(funding.error||!funding.data||funding.data.length>1000||funding.count!==funding.data.length||funding.data.some(a=>!Number.isSafeInteger(a.maximum_microusd)||a.maximum_microusd<=maximum||a.maximum_microusd>2_000_000))throw new Error('The complete approved funding history is unavailable.');
  const fundedMaximum=Math.max(maximum,...funding.data.map(a=>a.maximum_microusd));
  const chain=await context.supabase.from('product_experiments').select('id',{count:'exact'}).eq('business_id',root.business_id).eq('discovery_version','pod-discovery-2.0').is('parent_discovery_id',null).eq('variables->>budgetAuthorityRootId',authorityId).limit(1001);
  if(chain.error||!chain.data?.length||chain.data.length>1000||chain.count!==chain.data.length)throw new Error('The complete research allowance history is unavailable.');
  const reservations=await context.supabase.from('product_research_cost_reservations').select('id,reserved_microusd',{count:'exact'}).eq('business_id',root.business_id).in('experiment_id',chain.data.map(r=>r.id)).limit(10001);
  if(reservations.error||!reservations.data||reservations.data.length>10000||reservations.count!==reservations.data.length)throw new Error('The complete reservation history is unavailable.');
  const settlements=reservations.data.length?await context.supabase.from('product_research_cost_settlements').select('reservation_id,reported_microusd,provider_request_id',{count:'exact'}).eq('business_id',root.business_id).in('reservation_id',reservations.data.map(r=>r.id)).limit(30001):{data:[],error:null,count:0};
  if(settlements.error||!settlements.data||settlements.data.length>30000||settlements.count!==settlements.data.length)throw new Error('The complete settled cost history is unavailable.');
  let knownMicrousd=0,pendingExposureMicrousd=0,hasUncertainCosts=false;
  for(const reservation of reservations.data){const known=settlements.data.filter(s=>s.reservation_id===reservation.id&&Number.isSafeInteger(s.reported_microusd)&&s.reported_microusd>=0&&typeof s.provider_request_id==='string');
    if(known.length)knownMicrousd+=Math.max(...known.map(s=>s.reported_microusd));
    else{pendingExposureMicrousd+=reservation.reserved_microusd;hasUncertainCosts=true;}}
  return{maximumMicrousd:fundedMaximum,knownMicrousd,pendingExposureMicrousd,remainingMicrousd:Math.max(0,fundedMaximum-knownMicrousd-pendingExposureMicrousd),hasUncertainCosts};
}
