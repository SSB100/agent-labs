/** Trusted server code supplies this callback. JSON, credential presence,
 * fixture mode and old exact approvals do not constitute admission. */
export type TransportAdmissionRequest = Readonly<{
  provider: string; operation: string; method: string; endpoint: string;
  requestedScopes?: readonly string[];
}>;
export type TransportAdmission<Request extends TransportAdmissionRequest = TransportAdmissionRequest> =
  (request: Readonly<Request>) => Promise<void>;

export async function requireTransportAdmission<Request extends TransportAdmissionRequest>(admit: TransportAdmission<Request> | undefined,
  request: Request): Promise<void> {
  if (typeof admit !== "function") throw new Error("operating_policy_admission_required");
  try { await admit(Object.freeze({ ...request, ...(request.requestedScopes ? { requestedScopes: Object.freeze([...request.requestedScopes]) } : {}) })); }
  catch { throw new Error("operating_policy_dispatch_denied"); }
}
