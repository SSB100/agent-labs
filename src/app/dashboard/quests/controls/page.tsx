import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, PageHeader } from "@/components/stage7/app-shell";
import { OperatingControls } from "@/components/quests/operating-controls";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
import { ADMISSION_RPC, type AdmissionRead } from "@/core/admission-contract";
import { R04_RPC, type R04Read } from "@/core/quest-contract";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export default async function OperatingControlsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const context=await requireOwnerUiContext(), query=await searchParams;
  const businessId=query.business, goalId=query.quest, policyId=query.policy;
  if (typeof businessId!=="string" || !UUID.test(businessId) || [goalId,policyId].some(id=>id!==undefined && (typeof id!=="string" || !UUID.test(id)))) notFound();
  const {data:business,error:businessError}=await context.supabase.from("businesses").select("id,name").eq("id",businessId).eq("owner_user_id",context.userId).maybeSingle();
  if (!businessError && !business) notFound();
  const offset=typeof query.offset==="string" && /^\d{1,5}$/.test(query.offset)?Number(query.offset):0;
  const [intent,admission]=businessError ? [{data:null,error:businessError},{data:null,error:businessError}] : await Promise.all([
    context.supabase.rpc(R04_RPC.read,{p_business_id:businessId,p_goal_id:goalId??null,p_limit:20,p_offset:0}),
    context.supabase.rpc(ADMISSION_RPC.read,{p_business_id:businessId,p_policy_id:policyId??null,p_limit:20,p_offset:policyId?0:offset}),
  ]);
  const back=`/dashboard/quests?business=${businessId}${goalId?`&quest=${goalId}`:""}`;
  return <AppShell active="settings" toolDestination="settings" navigationBusinessId={businessId} context={context}>
    <PageHeader eyebrow="Operating controls" title={business?.name??"Business unavailable"} description="Review exact financial authority and stop new operations within this Business." />
    <Link href={back}>Back to Quest intent</Link>
    {intent.error || admission.error || !intent.data || !admission.data ? <p role="alert" className="coreNotice coreNotice-danger">Operating controls are unavailable for this exact selection. No substitute was selected. Reload when the data service is available.</p> : <OperatingControls key={JSON.stringify([intent.data,admission.data])} ownerId={context.userId} intent={intent.data as R04Read} state={admission.data as AdmissionRead} exactPolicy={Boolean(policyId)} />}
  </AppShell>;
}
