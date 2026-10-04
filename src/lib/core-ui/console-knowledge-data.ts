import "server-only";
import type { OwnerUiContext } from "./data";
import { decodeKnowledgePage, knowledgeObject, KNOWLEDGE_ID, unavailableKnowledgePage, type KnowledgePage, type KnowledgeQuery } from "./console-knowledge-query";

export async function loadKnowledgePage(context: OwnerUiContext, businessId: string, query: KnowledgeQuery): Promise<KnowledgePage> {
  try {
    if (query.section !== "installed") {
      const { data, error } = await context.supabase.rpc("r09_knowledge_read", { p_business_id: businessId, p_dataset: query.section, p_query: { limit: query.limit, offset: query.offset, query: query.search, ...(query.selectedId ? { selectedId: query.selectedId } : {}) } });
      return error ? unavailableKnowledgePage() : decodeKnowledgePage(data, businessId, query);
    }
    const [list, exact] = await Promise.all([
      context.supabase.from("installed_packs").select("id,business_id,root_pack_id,status,activated_at", { count: "exact" }).eq("business_id", businessId).order("activated_at", { ascending: false }).order("id", { ascending: false }).range(query.offset, query.offset + 24),
      query.selectedId ? context.supabase.from("installed_packs").select("id,business_id,root_pack_id,status,activated_at,snapshot").eq("business_id", businessId).eq("id", query.selectedId).maybeSingle() : null,
    ]);
    const valid = (row: unknown): row is Record<string, unknown> => knowledgeObject(row) && typeof row.id === "string" && KNOWLEDGE_ID.test(row.id) && row.business_id === businessId && typeof row.root_pack_id === "string" && KNOWLEDGE_ID.test(row.root_pack_id);
    if (list.error || exact?.error || !Array.isArray(list.data) || !Number.isSafeInteger(list.count) || Number(list.count) < 0 || list.data.length !== Math.min(25, Math.max(0, Number(list.count) - query.offset)) || !list.data.every(valid) || new Set(list.data.map(row => row.id)).size !== list.data.length || exact?.data && (!valid(exact.data) || exact.data.id !== query.selectedId)) return unavailableKnowledgePage();
    const records = [...list.data, ...(exact?.data ? [exact.data] : [])], ids = [...new Set(records.map(row => row.root_pack_id as string))];
    const packs = ids.length ? await context.supabase.from("packs").select("id,name,version,status").in("id", ids).limit(26) : { data: [], error: null };
    if (packs.error || !Array.isArray(packs.data) || packs.data.length !== ids.length || new Set(packs.data.map(row => row.id)).size !== ids.length || packs.data.some(row => !ids.includes(row.id) || typeof row.name !== "string" || typeof row.version !== "string")) return unavailableKnowledgePage();
    const enrich = (row: Record<string, unknown>) => { const pack = packs.data!.find(pack => pack.id === row.root_pack_id); return { ...row, title: pack!.name, version: pack!.version, qualification: pack!.status }; };
    return { available: true, items: list.data.map(enrich), total: list.count, detail: exact?.data ? enrich(exact.data) : null, selection: query.selectedId ? exact?.data ? "selected" : "missing" : "none" };
  } catch { return unavailableKnowledgePage(); }
}
