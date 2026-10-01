/** Workflow errors can cross realms; never depend on instanceof Error for their message. */
export function creativeFailureMessage(error: unknown, fallback = "Creative pipeline failed."): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string" && error.message.trim()) {
    return error.message.slice(0, 500);
  }
  return fallback;
}
