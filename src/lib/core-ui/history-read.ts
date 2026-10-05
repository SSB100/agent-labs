import type { OwnerUiContext } from "./data";
import { historyQuery, type HistoryPage } from "./history-query";
export type HistoryRead<T> = { items: T[]; selected: T | null; page: HistoryPage; observedAt: string; ownerTotal?:number };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export async function readHistory<T>(context: OwnerUiContext, businessId: string | null, dataset: string, key: string, options: { selectedId?: string | null; interventionId?: string | null; candidateId?:string; workflowRunId?:string } = {}): Promise<HistoryRead<T>> {
  const q = historyQuery(context.readSearch, key), params = new URLSearchParams(context.readSearch);
  const selectedId = options.selectedId ?? q.selectedId;
  const payload = { limit: q.pageSize, offset: q.offset, query: q.query, status: q.status, ...(selectedId ? { selectedId } : {}),
    ...(options.candidateId?{candidateId:options.candidateId}:{}), ...(options.workflowRunId?{workflowRunId:options.workflowRunId}:{}), ...(options.interventionId ? { interventionId: options.interventionId } : {}), ...(!dataset.startsWith("account_") && params.get("quest") ? { goalId: params.get("quest") } : {}) };
  const { data, error } = await context.supabase.rpc("r06_read", { p_business_id: businessId, p_dataset: dataset, p_query: payload });
  if (error || !object(data) || typeof data.observedAt!=="string" || !Number.isFinite(Date.parse(data.observedAt)) || !Array.isArray(data.items) || data.items.some(row=>!object(row)||typeof row.id!=="string") || new Set(data.items.map(row=>row.id)).size!==data.items.length || data.items.length > q.pageSize || !Number.isSafeInteger(data.total) || Number(data.total) < 0 ||
    data.limit !== q.pageSize || data.offset !== q.offset || data.items.length !== Math.min(q.pageSize, Math.max(0, Number(data.total) - q.offset)) || !object(data.selection) ||
    !["none", "missing", "found"].includes(String(data.selection.status)) || (data.selection.status === "found" && !object(data.selection.item))) throw new Error("Historical read unavailable");
  const selectionRequested=!!selectedId || !!options.interventionId;
  if((selectionRequested && data.selection.status==="none") || (!selectionRequested && data.selection.status!=="none") ||
    (data.selection.status!=="found" && data.selection.item!==null) || (data.selection.status==="found" &&
      (!object(data.selection.item) || typeof data.selection.item.id!=="string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(data.selection.item.id) || (selectedId && data.selection.item.id!==selectedId))))throw new Error("Historical read unavailable");
  return { ownerTotal:Number.isSafeInteger(data.ownerTotal)&&Number(data.ownerTotal)>=0?Number(data.ownerTotal):undefined, items: data.items as T[], selected: data.selection.status === "found" ? data.selection.item as T : null,
    page: { page: q.page, pageSize: q.pageSize, total: Number(data.total), hasNext: q.offset + data.items.length < Number(data.total), available: true }, observedAt: String(data.observedAt) };
}
export async function readState(context: OwnerUiContext, businessId: string, dataset: string) {
  const { data, error } = await context.supabase.rpc("r06_read", { p_business_id: businessId, p_dataset: dataset, p_query: {} });
  if (error || !object(data)) throw new Error("Current read unavailable");
  return data;
}
export function historyRows<T extends { id: string }>(read: HistoryRead<T>): T[] { return read.selected && !read.items.some(row => row.id === read.selected!.id) ? [read.selected, ...read.items] : read.items; }
/** PostgREST/RLS list helper; caller supplies its exact scoped filter before the stable page. */
export async function readTablePage<T>(context: OwnerUiContext, table: string, columns: string, key: string, options: { filters?: [string, unknown][]; inFilters?: [string,string[]][]; businessId?: string; time?: string; selectedId?: string | null; searchColumn?: string; statusColumn?: string } = {}): Promise<HistoryRead<T>> {
  const q=historyQuery(context.readSearch,key);
  const base=()=>{ let query=context.supabase.from(table).select(columns,{count:"exact"});
    if(options.businessId)query=query.eq("business_id",options.businessId);
    for(const [name,value] of options.filters ?? []) query=query.eq(name,value);
    for(const [name,values] of options.inFilters ?? []) query=query.in(name,values);
    return query; };
  let query=base();
  if(q.query && options.searchColumn)query=query.ilike(options.searchColumn,`%${q.query.replace(/[\\%_]/g,"\\$&")}%`);
  if(q.status!=="all" && options.statusColumn)query=query.eq(options.statusColumn,q.status);
  const selectedId=options.selectedId ?? q.selectedId;
  const [page,selected]=await Promise.all([query.order(options.time ?? "created_at",{ascending:false}).order("id",{ascending:false}).range(q.offset,q.offset+q.pageSize-1),selectedId ? base().eq("id",selectedId).limit(2) : null]);
  if(page.error || !Array.isArray(page.data) || !Number.isSafeInteger(page.count) || page.count!<0 || page.data.length!==Math.min(q.pageSize,Math.max(0,page.count!-q.offset)) ||
    (selected && (selected.error || !Array.isArray(selected.data) || selected.data.length>1 || selected.count!==selected.data.length || (selected.data.length===1 && (!object(selected.data[0]) || (selected.data[0] as unknown as {id?:unknown}).id!==selectedId)))))throw new Error("Historical read unavailable");
  return {items:page.data as T[],selected:selected?.data?.[0] as T ?? null,page:{page:q.page,pageSize:q.pageSize,total:page.count,hasNext:q.offset+page.data.length<page.count!,available:true},observedAt:new Date().toISOString()};
}
export async function safeTablePage<T>(context: OwnerUiContext, table: string, columns: string, key: string, options: Parameters<typeof readTablePage<T>>[4] = {}): Promise<HistoryRead<T>> {
  try{return await readTablePage<T>(context,table,columns,key,options);}catch{const q=historyQuery(context.readSearch,key);return {items:[],selected:null,page:{page:q.page,pageSize:q.pageSize,total:null,hasNext:null,available:false},observedAt:new Date().toISOString()};}
}
