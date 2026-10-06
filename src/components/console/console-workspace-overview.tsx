import {readDiscoveryR12Workspace} from "@/products/discovery-r12-owner";
import {ConsoleR12Progress} from "./console-r12-discovery";
import { readConnectionQualification } from "@/connections/server";
import { ConsoleCommandBar, ConsoleResearchSheet } from "./console-command";
import { QuestKickoff } from "@/components/guided/quest-kickoff";
import { loadDiscoveryGoalData } from "@/products/discovery-v2-data";
import { loadConsoleResearchQuote } from "@/lib/core-ui/console-data";
import Link from "next/link";
import type { WorkspaceIntent, WorkspaceSearch } from "@/lib/core-ui/workspace-context";
import { carryWorkspace } from "@/lib/core-ui/workspace-navigation";
import { consoleObject, consoleValidId } from "@/lib/core-ui/console-collections";
import { ConsoleShell } from "./console-shell";
import type { AdmissionRead } from "@/core/admission-contract";
import { ConsoleOverview } from "./console-overview";
import { ConsoleMotionBoundary } from "./console-motion";
import { deriveConsoleMotionSnapshot } from "@/lib/core-ui/console-motion";
import { EMPTY_COLLECTION, loadWorkflowCollection, loadCurrentQuestEpisode } from "@/lib/core-ui/data";
import { loadRunCostData } from "@/lib/core-ui/run-outcome-data";
import { consoleCostSummary, consoleConnectionSummary, loadConsoleObservationTime } from "@/lib/core-ui/console-data";
import { loadConsoleBrowserWorkspace } from "@/browser/console-server";
import "./console-workspace.css";

const text = (v: unknown, fallback = "Not recorded") => typeof v === "string" && v ? v : fallback;
const object = (v: unknown): Record<string, unknown> => consoleObject(v) ? v : {};
const array = (v: unknown): Record<string, unknown>[] => Array.isArray(v) ? v.filter(consoleObject) : [];
export function WorkspacePicker({ scope }: { scope: WorkspaceIntent }) {
  const state = scope.state, context = scope.context, businessId = scope.businessId;
  const base = `/dashboard?view=overview&business=${businessId}`;
  return <div className="r08Scope" aria-label="Business and Quest selection">
    <form method="get" action="/dashboard"><input type="hidden" name="view" value="overview"/><label>Business<select name="business" defaultValue={businessId ?? ""}>{context.businesses.map(b => <option value={b.id} key={b.id}>{b.name} · {b.id.slice(-6)}</option>)}</select></label><button type="submit">Choose Business</button></form>
    {state ? <form method="get" action="/dashboard"><input type="hidden" name="view" value="overview"/><input type="hidden" name="business" value={state.businessId}/><label>Quest<select name="quest" defaultValue={state.selected?.id ?? ""}><option value="">Current or most recent Quest</option>{state.selected && !state.quests.some(q => q.id === state.selected!.id) ? <option value={state.selected.id}>{state.selected.title}</option> : null}{state.quests.map(q => <option value={q.id} key={q.id}>{q.title} · {q.id.slice(-6)}</option>)}</select></label><button type="submit">Choose Quest</button></form> : null}
    {state ? <details><summary>Quest history · {state.total}</summary><p>Page {Math.floor(state.offset / state.limit) + 1} · {state.selection} selection</p><nav className="r08Links">{state.offset > 0 ? <Link href={`${base}&questPage=${Math.floor(state.offset / state.limit)}${state.selected ? `&quest=${state.selected.id}` : ""}`}>Previous Quests</Link> : null}{state.offset + state.quests.length < state.total ? <Link href={`${base}&questPage=${Math.floor(state.offset / state.limit) + 2}${state.selected ? `&quest=${state.selected.id}` : ""}`}>Next Quests</Link> : null}<Link href={`/dashboard/quests?business=${state.businessId}${state.selected ? `&quest=${state.selected.id}` : ""}`}>Quest intent and exact lookup</Link></nav></details> : null}
  </div>;
}
export async function ConsoleWorkspaceOverview({ scope, query }: { scope: WorkspaceIntent; query: WorkspaceSearch }) {
  const { context, state, businessId } = scope, quest = state?.selected;
  const href = (view: string, extra = "") => carryWorkspace(`/dashboard?view=${view}${businessId ? `&business=${businessId}` : ""}${extra}`, context.readSearch);
  const returnParams = new URLSearchParams(context.readSearch); returnParams.set("view", "overview"); if (businessId) returnParams.set("business", businessId); returnParams.delete("sheet");
  let returnTo = `/dashboard?${returnParams}`;
  const exactEpisode = typeof query.episode === "string" ? query.episode : typeof query.browserRun === "string" ? query.browserRun : undefined;
  const selectedContext = { ...context, businesses: context.businesses.filter(b => b.id === businessId), scopeBusinessId: businessId ?? undefined };
  const episode = quest && !scope.unavailable ? await loadCurrentQuestEpisode(selectedContext, businessId!, exactEpisode) : { id: null, available: !scope.unavailable };
  const [controller, admission, collection] = quest && !scope.unavailable ? await Promise.all([
    context.supabase.rpc("r07_quest_read", { p_business_id: businessId, p_goal_id: quest.id, p_plan_id: null, p_limit: 20, p_offset: 0 }),
    context.supabase.rpc("r05_admission_read", { p_business_id: businessId, p_policy_id: null, p_limit: 1, p_offset: 0 }),
    episode.id ? loadWorkflowCollection(selectedContext, { limit: 1, workflowRunId: episode.id }) : Promise.resolve({ ...EMPTY_COLLECTION, errors: episode.available ? [] : ["Current episode unavailable"] }),
  ]) : [{ data: null, error: null }, { data: null, error: null }, { ...EMPTY_COLLECTION, errors: scope.unavailable ? ["Exact Quest unavailable"] : [] }];
  const snapshot = object(object(controller.data).selected), head = object(snapshot.head), plan = object(snapshot.plan), attempts = array(snapshot.attempts);
  const validController = !controller.error && (object(controller.data).selected === null || snapshot.businessId === businessId && snapshot.goalId === quest?.id && consoleValidId(snapshot.planId) && array(plan.steps).length <= 32 && attempts.length <= 64);
  const r12 = validController && plan.format === "r12.discovery.1" && businessId && consoleValidId(plan.discoveryScopeId) ? await readDiscoveryR12Workspace(context,businessId,plan.discoveryScopeId) : null;
  const completed = new Set([...attempts.filter(a => a.status === "completed").map(a => a.stepKey), ...array(snapshot.reused).map(a => a.stepKey)]), steps = array(plan.steps);
  const exposure = !admission.error && consoleObject(admission.data) && admission.data.authorityRootId === businessId && Array.isArray(admission.data.exposure) && admission.data.exposure.every((e: unknown) => consoleObject(e) && typeof e.currency === "string" && typeof e.heldMicrounits === "string" && /^\d+$/.test(e.heldMicrounits) && Number.isSafeInteger(Number(e.heldMicrounits)) && typeof e.hasUnknown === "boolean") ? (admission.data as AdmissionRead).exposure : null;
  const scopedCount = quest && !scope.unavailable ? await context.supabase.from("owner_interventions").select("id", { count: "exact", head: true }).eq("business_id", businessId!).eq("status", "open") : { count: 0, error: scope.unavailable };
  const displayContext = { ...selectedContext, needsYouCount: scopedCount.error || !Number.isSafeInteger(scopedCount.count) ? 0 : scopedCount.count!, needsYouUnavailable: !!scopedCount.error || !Number.isSafeInteger(scopedCount.count) };
  const focus = collection.runs.find(r => r.id === episode.id);
  const focusDefinition = collection.definitions.find(d => d.id === focus?.workflow_definition_id);
  const [costs, browserData, accounts] = await Promise.all([
    focus ? loadRunCostData(context, focus, focusDefinition) : null,
    quest && focus ? loadConsoleBrowserWorkspace(context, { businessId: businessId!, workflowRunId: focus.id }) : null,
    businessId && !scope.unavailable ? readConnectionQualification(context, businessId) : null,
  ]);
  returnParams.set("centre", query.centre === "browser" ? "browser" : "overview"); if (focus) returnParams.set("browserRun", focus.id); returnTo = `/dashboard?${returnParams}`;
  const observedAt = await loadConsoleObservationTime();
  if (browserData && context.readSearch) browserData.workspaceSearch = new URLSearchParams([...new URLSearchParams(context.readSearch)].filter(([key]) => ["business", "quest", "episode", "step", "agent", "sourceArtifact"].includes(key))).toString();
  const sheet = query.sheet === "research", catalog = sheet ? await loadDiscoveryGoalData(selectedContext, []) : null;
  const quote = sheet ? await loadConsoleResearchQuote(selectedContext, catalog?.available === true) : null;
  const motion = deriveConsoleMotionSnapshot(collection, { businessIds: businessId ? [businessId] : [], observedAt, unavailable: scope.unavailable || collection.truncated === true });
  return <ConsoleShell active="overview" context={displayContext} navigationBusinessId={businessId ?? undefined} workflowRunId={focus?.id} commandBar={<ConsoleCommandBar ownerId={context.userId} businessId={businessId ?? undefined} returnTo={returnTo} unavailable={scope.unavailable}/> }>
    <section className="r08Workspace r08OverviewWorkspace"><WorkspacePicker scope={scope}/>
      {scope.unavailable ? <p role="alert">The exact Business or Quest is unavailable. No other work has been substituted.</p> : !quest ? <p className="r08Warning">No Quest selected. This Business has no saved Quest; legacy records remain available in Events, Research and Library. No workflow episode exists for this Quest. <Link href={businessId ? `/dashboard/quests?business=${businessId}` : "/dashboard/settings"}>Create or choose a Quest</Link></p> : <details className="r08QuestSummary"><summary><strong>{quest.title}</strong> · {state?.selection} Quest · {validController ? snapshot.planId ? `${text(head.state)} · ${completed.size} of ${steps.length} planned steps completed` : "No execution plan recorded" : "Controller unavailable"}</summary><div className="r08QuestSummaryScroll" role="region" tabIndex={0} aria-label="Exact Quest objective, progress and next action"><h2>Real progress</h2><p>{quest.content.objective}</p><p>Quest {quest.id} · revision {quest.revision} · intent {quest.preference}</p><p>{validController && snapshot.planId ? `${completed.size} of ${steps.length} planned steps have completed or pinned successful outputs` : "Saving intent does not start a worker."}</p><p>Target achievement unverified · no realised-profit claim</p><h2>Next action and exceptions</h2><p>{validController ? text(head.reason, "Review the Quest intent and operating prerequisites") : "Controller status unavailable"}</p><p>Resume requires resolving the saved reason and fresh server admission. Browsing or acknowledgment cannot resume work or settle charges.</p><ol>{validController ? steps.map(s => <li key={text(s.key)}>{text(s.objective)} · {completed.has(s.key) ? "output completed" : "not completed"}<ul>{attempts.filter(a => a.stepKey === s.key).map(a => <li key={text(a.id)}><Link href={href("work", `&selected=${a.id}&episode=${a.id}`)}>Attempt {String(a.attempt)} · {text(a.status)}</Link> · {text(a.reason)}</li>)}</ul></li>) : null}</ol><h2>Cost exposure</h2><p>Business-wide model liability, including other Quests. This is not Quest spend or realised profit.</p>{exposure ? exposure.length ? exposure.map(e => <p key={e.currency}>{e.currency} {(Number(e.heldMicrounits) / 1e6).toFixed(6)} held or spent {e.hasUnknown ? "· unresolved liability" : ""}</p>) : <p>No model exposure recorded in the admission ledger.</p> : <p>Exposure unavailable; no zero-cost conclusion.</p>}<nav className="r08Links"><Link href={`/dashboard/quests?business=${businessId}&quest=${quest.id}`}>Quest intent and Business rules</Link><Link href={`/dashboard/quests/controls?business=${businessId}&quest=${quest.id}`}>Operating controls</Link><Link href={href("decisions")}>Needs owner</Link><Link href={href("research")}>Research results</Link><Link href={href("library")}>Library results</Link><Link href={href("products-catalog")}>Products and Listings</Link>{validController && consoleValidId(snapshot.planId) ? <Link href={href("knowledge", `&type=usage&selected=${snapshot.planId}`)}>Exact Knowledge pins</Link> : null}</nav></div></details>}
      {r12 ? r12.record ? <ConsoleR12Progress record={r12.record} observedAt={observedAt}/> : <p className="r08Next" role="alert">Discovery status unavailable; no progress or cost conclusion can be made.</p> : null}
      {quest && validController && ["needs_owner", "blocked", "waiting"].includes(text(head.state)) ? <p className="r08Next"><strong>{text(head.state).replaceAll("_", " ")}</strong>: {text(head.reason)} · <Link href={href("decisions")}>Inspect exact exception</Link></p> : null}
      {quest && !collection.runs.length && !collection.errors.length ? <p className="r08Next">No workflow episode exists for this Quest.</p> : null}
      <div className="r08OverviewContent"><ConsoleMotionBoundary ownerId={context.userId} scopeKey={`quest:${quest?.id ?? "none"}${focus ? `:episode:${focus.id}` : ""}`} snapshot={motion}><ConsoleOverview currentRunId={focus?.id} context={displayContext} collection={collection} navigationBusinessId={businessId ?? undefined} researchHref={`${returnTo}&sheet=research`} connections={consoleConnectionSummary(accounts, selectedContext.businesses[0]?.name ?? "Business", observedAt)} costs={consoleCostSummary(costs, `Exact selected episode · ${focus?.id.slice(-8) ?? "none"}`, focus?.id)} browserData={browserData ?? undefined} centreMode={query.centre === "browser" ? "browser" : "overview"} workspaceSearch={context.readSearch}/></ConsoleMotionBoundary></div>
    </section>
    {sheet ? <ConsoleResearchSheet returnTo={returnTo}><QuestKickoff ownerId={context.userId} businesses={selectedContext.businesses} businessesUnavailable={scope.unavailable} available={catalog?.available === true} quote={quote}/></ConsoleResearchSheet> : null}
  </ConsoleShell>;
}
