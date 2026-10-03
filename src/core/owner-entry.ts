/** Keep private entry recovery inside the owner-checked dashboard routes. */
export function ownerReturnPath(value: unknown): string {
  if (typeof value !== "string" || value.length > 4096 || /[\\\u0000-\u0020\u007f]/.test(value)) return "/dashboard";
  try {
    const url = new URL(value, "https://owner-entry.invalid");
    const path = decodeURIComponent(url.pathname);
    if (
      !value.startsWith("/dashboard") ||
      url.origin !== "https://owner-entry.invalid" ||
      /[\\\u0000-\u0020\u007f]/.test(path) ||
      /%|\/\//.test(path) ||
      !/^\/dashboard(?:\/|$)/.test(path) ||
      path !== url.pathname
    ) return "/dashboard";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/dashboard";
  }
}

export function ownerLoginPath(code: string, returnPath: unknown): string {
  const query = new URLSearchParams({ error: code });
  const destination = ownerReturnPath(returnPath);
  if (destination !== "/dashboard") query.set("returnTo", destination);
  return `/login?${query}`;
}
