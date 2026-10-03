import "server-only";
import type { OwnerUiContext } from "./data";
import type { R04Read } from "@/core/quest-contract";
import { consoleValidId, consoleObject } from "./console-collections";

export type WorkspaceSearch = Record<string, string | string[] | undefined>;
export const workspaceContextKeys = ["quest", "episode", "step", "agent", "sourceArtifact"] as const;
export type WorkspaceIntent = { state: R04Read | null; businessId: string | null; unavailable: boolean; context: OwnerUiContext };
export function workspaceValue(search: WorkspaceSearch, key: string): string | undefined {
  const value = search[key];
  if (Array.isArray(value)) { if (value.length !== 1) throw new Error("Ambiguous workspace context"); return value[0]; }
  return value;
}
/** Context is provenance, never permission. Every explicit identity is verified independently. */
export async function resolveWorkspace(context: OwnerUiContext, search: WorkspaceSearch, current = false): Promise<WorkspaceIntent> {
  const businessId = workspaceValue(search, "business") ?? (current ? context.businesses[0]?.id : undefined);
  const questId = workspaceValue(search, "quest");
  const sourceArtifact = workspaceValue(search, "artifact") ?? workspaceValue(search, "sourceArtifact");
  const browserEpisode = current ? workspaceValue(search, "browserRun") : undefined;
  const episode = workspaceValue(search, "episode") ?? browserEpisode, step = workspaceValue(search, "step"), agent = workspaceValue(search, "agent");
  if ([businessId, questId, episode, step, agent, sourceArtifact].some(id => id !== undefined && !consoleValidId(id)) || questId && !businessId || (step || agent) && !episode || episode && !questId && !current || browserEpisode && workspaceValue(search, "episode") && browserEpisode !== workspaceValue(search, "episode")) throw new Error("Invalid workspace context");
  if (!businessId || (!questId && !current)) return { state: null, businessId: businessId ?? null, unavailable: !!context.businessesUnavailable, context };
  if (context.businessesUnavailable) return { state: null, businessId, unavailable: true, context };
  const offsetText = workspaceValue(search, "questPage") ?? "1";
  if (!/^[1-9]\d{0,3}$/.test(offsetText)) throw new Error("Invalid Quest page");
  const { data, error } = await context.supabase.rpc("r04_quest_read", { p_business_id: businessId, p_goal_id: questId ?? null, p_limit: 20, p_offset: (Number(offsetText) - 1) * 20 });
  if (error || !consoleObject(data) || data.businessId !== businessId || !Array.isArray(data.quests) || !Number.isSafeInteger(data.total) || !["explicit", "current", "last", "none"].includes(String(data.selection)) || data.selected && (!consoleObject(data.selected) || data.selected.businessId !== businessId || !consoleValidId(data.selected.id) || questId && data.selected.id !== questId)) return { state: null, businessId, unavailable: true, context: { ...context, businessesUnavailable: true } };
  const chosen = consoleObject(data.selected) ? data.selected : null;
  const expectedOffset = (Number(offsetText) - 1) * 20;
  if (data.limit !== 20 || data.offset !== expectedOffset || Number(data.total) < 0 || data.quests.length !== Math.min(20, Math.max(0, Number(data.total) - expectedOffset)) || data.quests.some(q => !consoleObject(q) || q.businessId !== businessId || !consoleValidId(q.id)) || new Set(data.quests.map(q => q.id)).size !== data.quests.length ||
    (questId ? data.selection !== "explicit" || !data.selected : data.selection === "explicit") || (data.selection === "none") !== (data.selected === null) || !consoleObject(data.business) || data.selected && (!chosen || !consoleObject(chosen.content) || typeof chosen.content.objective !== "string" || typeof chosen.title !== "string")) {
    return { state: null, businessId, unavailable: true, context: { ...context, businessesUnavailable: true } };
  }
  const state = data as R04Read;
  if (episode && !state.selected) throw new Error("Episode has no selected Quest");
  const params = new URLSearchParams(context.readSearch);
  if (episode) params.set("episode", episode);
  params.set("business", businessId);
  if (state.selected) params.set("quest", state.selected.id);
  else params.delete("quest");
  const scoped = state.selected ? withQuestScope({ ...context, readSearch: `?${params}`, scopeBusinessId: businessId }, state.selected.id) : { ...context, readSearch: `?${params}`, scopeBusinessId: businessId };
  if (state.selected) scoped.workspaceQuest = { id: state.selected.id, title: state.selected.title, selection: state.selection };
  if (episode) {
    const run = await scoped.supabase.from("workflow_runs").select("id,business_id").eq("id", episode).eq("business_id", businessId).maybeSingle();
    if (run.error || !run.data) throw new Error("Episode outside Quest");
    if (step) {
      const row = await scoped.supabase.from("workflow_stage_runs").select("id").eq("id", step).eq("workflow_run_id", episode).maybeSingle();
      if (row.error || !row.data) throw new Error("Step outside episode");
    }
    if (agent) {
      const row = await scoped.supabase.from("worker_runs").select("id,task_contract_id,worker_definition_id").eq("id", agent).eq("workflow_run_id", episode).eq("business_id", businessId).maybeSingle();
      if (row.error || !row.data) throw new Error("Agent outside episode");
      if (step) {
        const task = await scoped.supabase.from("task_contracts").select("id").eq("id", row.data.task_contract_id).eq("workflow_run_id", episode).eq("business_id", businessId).eq("workflow_stage_run_id", step).eq("worker_definition_id", row.data.worker_definition_id).maybeSingle();
        if (task.error || !task.data) throw new Error("Agent outside Step");
      }
    }
  }
  if (sourceArtifact && state.selected) {
    let lookup = scoped.supabase.from("artifacts").select("id").eq("id", sourceArtifact).eq("business_id", businessId);
    if (episode) lookup = lookup.eq("workflow_run_id", episode);
    const artifact = await lookup.maybeSingle();
    if (artifact.error || !artifact.data) throw new Error("Artifact outside Quest or episode");
    params.set("sourceArtifact", sourceArtifact); scoped.readSearch = `?${params}`;
  }
  return { state, businessId, unavailable: false, context: scoped };
}
const questViews: Record<string, string> = {
  workflow_runs: "r08_workflow_runs", product_experiments: "r08_product_experiments", artifacts: "r08_artifacts",
  creative_runs: "r08_creative_runs", creative_assets: "r08_creative_assets", owner_interventions: "r08_owner_interventions", events: "r08_events",
};
/** The filter is attached before list/count/exact queries, never after a recent sample. */
export function withQuestScope(context: OwnerUiContext, questId: string): OwnerUiContext {
  if (!consoleValidId(questId)) throw new Error("Invalid Quest scope");
  const client = context.supabase;
  const scoped = new Proxy(client, { get(target, key, receiver) {
    if (key !== "from") return Reflect.get(target, key, receiver);
    return (table: string) => {
      const builder = client.from(questViews[table] ?? table);
      if (!questViews[table]) return builder;
      return new Proxy(builder, { get(query, method, receiver) {
        if (method === "select") return (columns = "*", options?: Parameters<typeof builder.select>[1]) => {
          const selected = builder.select(columns === "*" ? "*" : `${columns},quest_id`, options).eq("quest_id", questId);
          const wrap = <T extends object>(target: T): T => new Proxy(target, { get(inner, key, proxy) {
            if (key === "then") return (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(inner as unknown as PromiseLike<{ data: unknown; error: unknown; count?: number | null }>).then(result => {
              if (result.error || result.data === null) return result;
              const rows = Array.isArray(result.data) ? result.data : [result.data];
              if (rows.some(row => !consoleObject(row) || row.quest_id !== questId)) return { data: null, error: { message: "Quest read could not be verified" }, count: null };
              const clean = rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "quest_id")));
              return { ...result, data: Array.isArray(result.data) ? clean : clean[0] };
            }).then(resolve, reject);
            const value = Reflect.get(inner, key, proxy);
            return typeof value === "function" ? (...args: unknown[]) => { const next = Reflect.apply(value, inner, args); return next && typeof next === "object" ? wrap(next) : next; } : value;
          } });
          return wrap(selected);
        };
        return Reflect.get(query, method, receiver);
      } });
    };
  } });
  return { ...context, supabase: scoped };
}
