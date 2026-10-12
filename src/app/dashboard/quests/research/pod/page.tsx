import Link from "next/link";
import {notFound} from "next/navigation";
import {ConsoleShell} from "@/components/console/console-shell";
import {PodResearchWorkspace,type PodRunStatus} from "@/components/quests/pod-research-workspace";
import {requireOwnerUiContext} from "@/lib/core-ui/data";
import {readPodResearch,readPodResearchResult} from "@/products/discovery-r12-pod-owner-server";
import {podId,podObject} from "@/products/discovery-r12-pod-owner-contract";
import "@/components/quests/owner-research.css";
export const dynamic="force-dynamic";
export const maxDuration=300;
export default async function PodResearchPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const context=await requireOwnerUiContext(),query=await searchParams,businessId=query.business,setupId=query.setup;
 if(businessId!==undefined&&!podId(businessId)||setupId!==undefined&&!podId(setupId)||setupId&&!businessId)notFound();
 if(!businessId)return <ConsoleShell active="research" context={context}><section className="ownerResearchPage"><h1>Research print-on-demand opportunities</h1><form method="get"><label>Business<select name="business" required defaultValue=""><option value="" disabled>Choose a Business</option>{context.businesses.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label><button className="coreButton">Set a research goal</button></form></section></ConsoleShell>;
 const catalog=await readPodResearch(context,businessId,typeof setupId==="string"?setupId:null).catch(()=>null);
 const receipt=catalog?.setups.find(s=>s.setupId===setupId)??null;
 let status:PodRunStatus|null=null,result:Awaited<ReturnType<typeof readPodResearchResult>>=null,readError=false;
 if(receipt?.activated){
  const [workspace,completed]=await Promise.all([context.supabase.rpc("r12_discovery_owner_read",{p_business_id:businessId,p_scope_id:receipt.scopeId,p_activation:false}),readPodResearchResult(context,businessId,receipt.scopeId).then(result=>({result,failed:false})).catch(()=>({result:null,failed:true}))]);
  if(!workspace.error&&podObject(workspace.data)&&workspace.data.businessId===businessId&&workspace.data.scopeId===receipt.scopeId&&Array.isArray(workspace.data.phases)&&podObject(workspace.data.cost))status=workspace.data as unknown as PodRunStatus;else readError=true;
  result=completed.result;readError=readError||completed.failed;
 }
 return <ConsoleShell active="research" context={context} navigationBusinessId={businessId}><div className="ownerResearchPage"><nav><Link href={`/dashboard/quests/research/pod?business=${businessId}`}>All POD research</Link><Link href={`/dashboard/quests/research?business=${businessId}`}>Other saved research</Link></nav>
  {!catalog||setupId&&!receipt?<p role="alert">This research record could not be verified. Reload before taking action.</p>:<>{readError?<p role="alert">Saved progress or the completed result could not be verified. No completion is assumed.</p>:null}<PodResearchWorkspace key={receipt?.setupId??businessId} catalog={catalog} selected={receipt} status={status} result={result}/></>}
 </div></ConsoleShell>;
}
