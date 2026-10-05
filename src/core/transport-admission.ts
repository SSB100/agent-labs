/** Trusted server code supplies this callback. JSON, credential presence,
 * fixture mode and old exact approvals do not constitute admission. */
export type TransportAdmission = (request: Readonly<{
  provider: string; operation: string; method: string; endpoint: string;
  requestedScopes?: readonly string[];
}>) => Promise<void>;

export async function requireTransportAdmission(admit: TransportAdmission | undefined,
  request: Parameters<TransportAdmission>[0]): Promise<void> {
  if (typeof admit !== "function") throw new Error("operating_policy_admission_required");
  try { await admit(Object.freeze({ ...request, ...(request.requestedScopes ? { requestedScopes: Object.freeze([...request.requestedScopes]) } : {}) })); }
  catch { throw new Error("operating_policy_dispatch_denied"); }
}
