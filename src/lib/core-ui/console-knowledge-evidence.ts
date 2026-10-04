import "server-only";
import type { OwnerUiContext } from "./data";
import { KNOWLEDGE_ID, knowledgeObject } from "./console-knowledge-query";
import { carryWorkspace } from "./workspace-navigation";

export type KnowledgeEvidenceLink = { id: string; href: string | null; context: "same-quest" | "changed-quest" | "unlinked" | "unavailable" };
/** Business-wide proposals may reference a different Quest. Derive exact parents before carrying provenance. */
export async function loadKnowledgeEvidenceLinks(context: OwnerUiContext, businessId: string, ids: string[]): Promise<KnowledgeEvidenceLink[]> {
  const unavailable = (): KnowledgeEvidenceLink[] => ids.map(id => ({ id, href: null, context: "unavailable" }));
  if (!KNOWLEDGE_ID.test(businessId) || !ids.length || ids.length > 12 || ids.some(id => !KNOWLEDGE_ID.test(id)) || new Set(ids).size !== ids.length) return unavailable();
  try {
    // The explicit R08 view bypasses the optional current-Quest proxy predicate, not RLS.
    // Never read raw artifact payloads or substitute another record for a missing requested ID.
    const result = await context.supabase.from("r08_artifacts").select("id,business_id,workflow_run_id,quest_id", { count: "exact" }).eq("business_id", businessId).in("id", ids).limit(12);
    const valid = (row: unknown): row is { id: string; business_id: string; workflow_run_id: string | null; quest_id: string | null } => knowledgeObject(row) && typeof row.id === "string" && ids.includes(row.id) && row.business_id === businessId && (row.workflow_run_id === null || typeof row.workflow_run_id === "string" && KNOWLEDGE_ID.test(row.workflow_run_id)) && (row.quest_id === null || typeof row.quest_id === "string" && KNOWLEDGE_ID.test(row.quest_id) && typeof row.workflow_run_id === "string");
    if (result.error || result.count !== ids.length || !Array.isArray(result.data) || result.data.length !== ids.length || !result.data.every(valid) || new Set(result.data.map(row => row.id)).size !== ids.length) return unavailable();
    const original = new URLSearchParams(context.readSearch), currentQuest = original.get("quest");
    return ids.map(id => {
      const artifact = result.data!.find(row => row.id === id)!;
      const params = new URLSearchParams({ view: "library", type: "records", business: businessId, selected: id });
      if (artifact.quest_id === null) return { id, href: `/dashboard?${params}`, context: "unlinked" };
      params.set("quest", artifact.quest_id); params.set("episode", artifact.workflow_run_id!);
      return { id, href: carryWorkspace(`/dashboard?${params}`, original), context: currentQuest === artifact.quest_id ? "same-quest" : "changed-quest" };
    });
  } catch { return unavailable(); }
}
