/** One bounded server page. Query state is independent for each retained collection. */
export const HISTORY_PAGE_SIZE = 25;
export const HISTORY_MAX_PAGE = 10000;
export type HistoryQuery = { page: number; pageSize: number; offset: number; query: string; status: string; selectedId: string | null };
export type HistoryPage = { page: number; pageSize: number; total: number | null; hasNext: boolean | null; available: boolean };
export function historyQuery(search: string | undefined, key: string): HistoryQuery {
  const params = new URLSearchParams(search ?? "");
  const value = params.get(`${key}Page`) ?? "1";
  const page = /^\d{1,5}$/.test(value) ? Math.max(1, Math.min(HISTORY_MAX_PAGE, Number(value))) : 1;
  const query = (params.get(`${key}Query`) ?? "").trim().slice(0, 120);
  const status = (params.get(`${key}Status`) ?? "all").slice(0, 40);
  return { page, pageSize: HISTORY_PAGE_SIZE, offset: (page - 1) * HISTORY_PAGE_SIZE, query, status, selectedId: params.get(`${key}Id`) };
}
export function historyPage(q: HistoryQuery, result: { count?: number | null; error?: unknown; data?: unknown }): HistoryPage {
  const count = Number.isSafeInteger(result.count) && Number(result.count) >= 0 ? Number(result.count) : null;
  const size = Array.isArray(result.data) ? result.data.length : null;
  const available = !result.error && size !== null && size <= q.pageSize && count !== null && size === Math.min(q.pageSize, Math.max(0, count - q.offset));
  return { page: q.page, pageSize: q.pageSize, total: available ? count : null, hasNext: available ? q.offset + size! < count! : null, available };
}
export function historyPattern(value: string) { return `%${value.replace(/[\\%_]/g, "\\$&")}%`; }
