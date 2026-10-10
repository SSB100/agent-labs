import Link from "next/link";
import { notFound } from "next/navigation";
import { ConsoleShell } from "@/components/console/console-shell";
import { OwnerResearchEntry } from "@/components/quests/owner-research-entry";
import { OwnerResearchWorkspace } from "@/components/quests/owner-research-workspace";
import { OwnerAdaptiveResearchWorkspace } from "@/components/quests/owner-adaptive-research-workspace";
import { OwnerResearchBootstrapReference } from "@/components/quests/owner-research-bootstrap-reference";
import { requireOwnerUiContext } from "@/lib/core-ui/data";
import { loadConsoleObservationTime } from "@/lib/core-ui/console-data";
import { ownerResearchSetupHref } from "@/lib/core-ui/owner-research-form";
import { R04_RPC, type R04Read } from "@/core/quest-contract";
import { readOwnerResearchCatalog } from "@/products/discovery-r12-goal-preparation-server";
import { readAdaptiveOwnerResearch } from "@/products/discovery-r12-adaptive-owner-server";
import "@/components/quests/owner-research.css";

export const dynamic = "force-dynamic";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export default async function OwnerResearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await requireOwnerUiContext(), query = await searchParams;
  const businessId = query.business, goalId = query.quest, setupId = query.setup, adaptiveSetupId = query.adaptiveSetup;
  if ([businessId, goalId, setupId, adaptiveSetupId].some(value => value !== undefined && (typeof value !== "string" || !UUID.test(value))) || (!businessId && (goalId || setupId || adaptiveSetupId)) || ((setupId || adaptiveSetupId) && !goalId) || (setupId && adaptiveSetupId) || (query.offset !== undefined && (typeof query.offset !== "string" || !/^\d{1,6}$/.test(query.offset)))) notFound();
  if (typeof businessId !== "string") return <ConsoleShell active="research" context={context}><div className="ownerResearchPage"><OwnerResearchEntry businesses={context.businesses} businessesUnavailable={context.businessesUnavailable}/></div></ConsoleShell>;
  const { data: business, error: businessError } = await context.supabase.from("businesses").select("id,name").eq("id", businessId).eq("owner_user_id", context.userId).maybeSingle();
  if (!businessError && !business) notFound();
  const base = `/dashboard/quests/research?business=${businessId}`;
  let selection: R04Read | null = null, selectionUnavailable = false;
  if (!businessError && !goalId) {
    const result = await context.supabase.rpc(R04_RPC.read, { p_business_id: businessId, p_goal_id: null, p_limit: 20, p_offset: typeof query.offset === "string" ? Number(query.offset) : 0 });
    selectionUnavailable = !!result.error || !result.data;
    if (!selectionUnavailable) selection = result.data as R04Read;
  }
  const [loaded, adaptiveLoaded] = !businessError && typeof goalId === "string" ? await Promise.all([
    readOwnerResearchCatalog(context, businessId, goalId, typeof setupId === "string" ? setupId : null).catch(() => ({ available: false, catalog: null })),
    readAdaptiveOwnerResearch(context,businessId,goalId,typeof adaptiveSetupId === "string" ? adaptiveSetupId : null).catch(() => ({available:false,catalog:null})),
  ]) : [null,null];
  const catalog = loaded?.catalog;
  const exactGoal = catalog?.goal && catalog.goal.id === goalId && catalog.goal.businessId === businessId ? catalog.goal : null;
  const receipt = typeof setupId === "string" ? catalog?.setups.find(setup => setup.setupId === setupId && setup.businessId === businessId && setup.goalId === goalId) ?? null : null;
  const unavailable = businessError || selectionUnavailable || (goalId && (!loaded?.available || !exactGoal || catalog?.business.id !== businessId)) || (setupId && !receipt);
  const adaptiveCatalog = adaptiveLoaded?.catalog?.businessId === businessId && adaptiveLoaded.catalog.goalId === goalId ? adaptiveLoaded.catalog : null;
  const adaptiveReceipt = typeof adaptiveSetupId === "string" ? adaptiveCatalog?.setups.find(setup => setup.setupId === adaptiveSetupId && setup.businessId === businessId && setup.goalId === goalId) ?? null : null;
  const observedAt = await loadConsoleObservationTime();
  return <ConsoleShell active="research" context={context} navigationBusinessId={businessId}>
    <section className="ownerResearchPage" aria-labelledby="owner-research-title">
      <header><p className="coreEyebrow">A bounded episode for your actual objective</p><h1 id="owner-research-title">Research a saved Quest</h1><p>{business?.name ?? "Business unavailable"}</p></header>
      <nav aria-label="Research navigation"><Link href={`/dashboard?view=research&business=${businessId}`}>Back to research</Link><Link href={`/dashboard/quests?business=${businessId}${goalId ? `&quest=${goalId}` : ""}`}>Create or edit a Quest</Link>{goalId ? <Link href={base}>Choose another Quest</Link> : null}</nav>
      {!businessError && business?.id === businessId ? <OwnerResearchBootstrapReference key={`${context.userId}:${businessId}`} businessId={businessId} ownerId={context.userId}/> : null}
      {unavailable ? <p role="alert">This exact Business, Quest or setup could not be verified. No substitute was selected. Reload this URL after the data service is available.</p> : !goalId && selection ? <>
        <h2>Choose your saved objective</h2><p>Saving a Quest records intent only. Select it explicitly here, then review a supported profile and complete financial packet.</p>
        <p>{selection.total} saved Quests · showing {selection.offset + (selection.quests.length ? 1 : 0)}–{selection.offset + selection.quests.length}</p>
        <ul className="ownerResearchList">{selection.quests.map(goal => <li key={goal.id}><Link href={ownerResearchSetupHref(businessId, goal.id)}>{goal.title}</Link><span>Version {goal.revision} · {goal.preference}</span></li>)}</ul>
        {!selection.quests.length ? <p>No Quests on this page. <Link href={`/dashboard/quests?business=${businessId}#quest-entry`}>Create a Quest with your real objective, target, budget and deadline</Link>.</p> : null}
        <nav aria-label="Saved Quest pages">{selection.offset > 0 ? <Link href={`${base}&offset=${Math.max(0, selection.offset - selection.limit)}`}>Previous Quests</Link> : null}{selection.offset + selection.limit < selection.total ? <Link href={`${base}&offset=${selection.offset + selection.limit}`}>Next Quests</Link> : null}</nav>
      </> : catalog && exactGoal ? <OwnerResearchWorkspace key={`${context.userId}:${businessId}:${goalId}:${setupId ?? "new"}:${JSON.stringify(catalog)}`} ownerId={context.userId} catalog={catalog} selectedReceipt={receipt} observedAt={observedAt}/> : null}
      {goalId && !businessError ? adaptiveSetupId && !adaptiveReceipt ? <p role="alert">This exact adaptive setup could not be verified. No other setup was selected. Reload its saved URL after the data service is available.</p> : <OwnerAdaptiveResearchWorkspace key={`${context.userId}:${businessId}:${goalId}:${adaptiveSetupId ?? "new"}:${JSON.stringify(adaptiveCatalog)}`} businessId={businessId} ownerId={context.userId} catalog={adaptiveCatalog} selectedReceipt={adaptiveReceipt} observedAt={observedAt}/> : null}
    </section>
  </ConsoleShell>;
}
