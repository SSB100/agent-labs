/** URL provenance only. Server readers independently verify every supplied identity. */
export const WORKSPACE_KEYS = ["quest", "episode", "step", "agent", "sourceArtifact"] as const;
export function carryWorkspace(href: string, source: URLSearchParams | string | undefined): string {
  const url = new URL(href, "https://owner.invalid"), params = source instanceof URLSearchParams ? source : new URLSearchParams(source);
  const targetRun = url.searchParams.get("selected") ?? url.searchParams.get("run");
  if (url.searchParams.get("view") === "work" && params.has("quest") && targetRun && !url.searchParams.has("episode")) url.searchParams.set("episode", targetRun);
  const changed = (key: string) => url.searchParams.has(key) && url.searchParams.get(key) !== params.get(key);
  const businessChanged = changed("business"), questChanged = businessChanged || changed("quest"), episodeChanged = questChanged || changed("episode");
  if (!url.searchParams.has("business") && params.get("business")) url.searchParams.set("business", params.get("business")!);
  for (const key of WORKSPACE_KEYS) {
    if (key === "quest" && businessChanged || key === "episode" && questChanged || ["step", "agent", "sourceArtifact"].includes(key) && episodeChanged) continue;
    const value = params.get(key); if (value && !url.searchParams.has(key)) url.searchParams.set(key, value);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
export function copyWorkspace(target: URLSearchParams, source: Record<string, string | string[] | undefined>): void {
  for (const key of WORKSPACE_KEYS) { const value = source[key]; if (typeof value === "string") target.set(key, value); }
}
