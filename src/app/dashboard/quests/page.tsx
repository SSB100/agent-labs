import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, PageHeader } from "@/components/stage7/app-shell";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
import { R04_RPC, type R04Read } from "@/core/quest-contract";
import { QuestWorkspace } from "@/components/quests/quest-workspace";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function QuestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await requireOwnerUiContext();
  const query = await searchParams;
  const businessId = query.business, goalId = query.quest;
  if (typeof businessId !== "string" || !UUID.test(businessId) || (goalId !== undefined && (typeof goalId !== "string" || !UUID.test(goalId)))) notFound();
  const { data: business, error: businessError } = await context.supabase.from("businesses").select("id,name").eq("id", businessId).eq("owner_user_id", context.userId).maybeSingle();
  if (!businessError && !business) notFound();
  const offset = typeof query.offset === "string" && /^\d{1,6}$/.test(query.offset) ? Number(query.offset) : 0;
  const { data, error } = businessError ? { data: null, error: businessError } : await context.supabase.rpc(R04_RPC.read, { p_business_id: businessId, p_goal_id: goalId ?? null, p_limit: 20, p_offset: offset });
  return <AppShell active="settings" toolDestination="settings" navigationBusinessId={businessId} context={context}>
    <PageHeader eyebrow="Persistent Business & Quest intent" title={business?.name ?? "Business unavailable"} description="Save operating rules and measurable objectives. Creating a Quest does not start work or authorize spending." />
    <Link href={`/dashboard/settings?business=${businessId}&panel=businesses`}>Back to Business settings</Link>
    {error || !data ? <p role="alert" className="coreNotice coreNotice-danger">This exact Business or Quest is unavailable. No substitute was selected. Reload after its data service is available.</p> : <QuestWorkspace key={`${businessId}:${goalId ?? "current"}:${JSON.stringify(data)}`} ownerId={context.userId} state={data as R04Read} />}
  </AppShell>;
}
