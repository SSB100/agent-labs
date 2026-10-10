import { randomUUID } from "node:crypto";
import { awaitRequestDeadline, requestDeadline } from "../core/request-deadline";
import { sealAccountSecret, unsealAccountSecret, type AccountSecretContext } from "./vault";
import {
  EtsySteelHandoffError, etsySteelHash, handoffAssert, handoffExact, handoffHash, handoffUuid, handoffInstant,
  validateEtsySteelHandoffScope,
  type EtsySteelHandoffScope, type EtsySteelHandoffDependencies, type EtsySteelHandoffOperation,
  type EtsySteelHandoffAdmissionRequest, type EtsySteelHandoffPermit, type EtsySteelHandoffRecord,
  type EtsySteelHandoffReceipt, type EtsySteelOwnerSession, type EtsySteelOwner, type EtsySteelProfileCandidate,
} from "./etsy-steel-handoff-contracts";

const STAGE_MS = 15_000, CLEANUP_MS = 5_000;
type PrivateSession = { version: "etsy.steel-owner-private.1"; scopeHash: string; sessionId: string; profileId: string; viewerUrl: string };
type Reservation = { reservationId: string; reservationHash: string };
const secretContext = (s: EtsySteelHandoffScope): AccountSecretContext => ({ businessId: s.businessId,
  provider: "etsy_steel_handoff", connectionId: s.operationId, revision: s.approvalRevision });
function immutable<T>(value: T): Readonly<T> {
  const copied = structuredClone(value);
  function freeze(v: unknown) { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } }
  freeze(copied); return copied;
}
function validateDependencies(d: EtsySteelHandoffDependencies) {
  handoffAssert(d && typeof d.vaultKey === "string" && /^[a-f0-9]{64}$/.test(d.vaultKey) && d.signal instanceof AbortSignal &&
    [d.admit,d.createSession,d.storeHandoff,d.loadHandoff,d.consumeHandoff,d.releaseSession,d.readProfile,d.saveProfileCandidate,
      d.recordOutcome,d.registerCleanup].every(f => typeof f === "function"), "handoff_dependencies_required");
}
function viewerUrl(value: string, id: string) {
  let u: URL; try { u = new URL(value); } catch { throw new EtsySteelHandoffError("handoff_viewer_invalid"); }
  handoffAssert(u.protocol === "https:" && u.hostname === "api.steel.dev" && !u.port && !u.username && !u.password &&
    !u.search && !u.hash && u.pathname === `/v1/sessions/${id}/player`, "handoff_viewer_invalid");
  return u.href;
}
function privateSession(value: unknown, scopeHash: string): PrivateSession {
  handoffExact(value, "version,scopeHash,sessionId,profileId,viewerUrl", "handoff_private_record_invalid");
  handoffAssert(value.version === "etsy.steel-owner-private.1" && value.scopeHash === scopeHash &&
    handoffUuid(value.sessionId) && handoffUuid(value.profileId) && typeof value.viewerUrl === "string", "handoff_private_record_invalid");
  viewerUrl(value.viewerUrl, value.sessionId); return structuredClone(value) as PrivateSession;
}
export function validateEtsySteelHandoffRecord(value: unknown, owner: EtsySteelOwner, handoffId: string): EtsySteelHandoffRecord {
  handoffExact(value, "version,id,scope,scopeHash,reservationId,reservationHash,envelope,disconnectProof,createdAt,expiresAt,recordHash", "handoff_record_invalid");
  const r = value as EtsySteelHandoffRecord, scope = validateEtsySteelHandoffScope(r.scope);
  handoffAssert(r.version === "etsy.steel-owner-handoff-record.1" && handoffUuid(r.id) && r.id === handoffId &&
    scope.ownerId === owner.ownerId && scope.businessId === owner.businessId && r.scopeHash === etsySteelHash(scope) &&
    handoffUuid(r.reservationId) && handoffHash(r.reservationHash) && typeof r.envelope === "string" &&
    r.envelope.startsWith("account-v1.") && r.envelope.length <= 90_000 &&
    handoffInstant(r.createdAt) && handoffInstant(r.expiresAt) && Date.parse(r.expiresAt) > Date.parse(r.createdAt) &&
    Date.parse(r.expiresAt) <= Date.parse(scope.approvalExpiresAt) &&
    Date.parse(r.expiresAt) - Date.parse(r.createdAt) <= scope.maximumSessionMs, "handoff_record_invalid");
  handoffExact(r.disconnectProof,"version,sessionId,cdpDisconnected,observersDrained,inFlightCommandsSettled,appCaptureStopped,routeHandlersDrained,eventListenersRemoved","handoff_disconnect_unconfirmed");
  handoffAssert(r.disconnectProof.version==='etsy.steel-owner-disconnect.1'&&r.disconnectProof.sessionId===scope.operationId&&
    r.disconnectProof.cdpDisconnected===true&&r.disconnectProof.observersDrained===true&&r.disconnectProof.inFlightCommandsSettled===true&&r.disconnectProof.appCaptureStopped===true&&r.disconnectProof.routeHandlersDrained===true&&r.disconnectProof.eventListenersRemoved===true,'handoff_disconnect_unconfirmed');
  const { recordHash, ...body } = r;
  handoffAssert(recordHash === etsySteelHash(body), "handoff_record_changed"); return structuredClone(r);
}
function receipt(scope: EtsySteelHandoffScope, values: Partial<Omit<EtsySteelHandoffReceipt, "version" | "operationId" | "scopeHash" | "receiptHash">>): EtsySteelHandoffReceipt {
  const body: Omit<EtsySteelHandoffReceipt, "receiptHash"> = {
    version: "etsy.steel-owner-handoff-receipt.1", operationId: scope.operationId, scopeHash: etsySteelHash(scope),
    handoffId: values.handoffId ?? null, status: values.status ?? "failed", reason: values.reason ?? "handoff_failed",
    releaseState: values.releaseState ?? "not_created", liabilityState: values.liabilityState ?? "not_dispatched",
    reservationId: values.reservationId ?? null, reservationHash: values.reservationHash ?? null,
    profileBindingId: values.profileBindingId ?? null, profileBindingRevision: values.profileBindingRevision ?? null,
    accountIdentityVerified: false, insightsAccessVerified: false,
  };
  return { ...body, receiptHash: etsySteelHash(body) };
}
function code(error: unknown) { return error instanceof EtsySteelHandoffError ? error.code : "handoff_operation_unconfirmed"; }
/** This local stage fence never extends the original session/approval deadline. */
function stage(scope: EtsySteelHandoffScope, d: EtsySteelHandoffDependencies, expiresAt = scope.approvalExpiresAt) {
  const now = d.now ?? Date.now, mono = d.monotonic ?? (() => performance.now());
  const end = mono() + Math.min(STAGE_MS, Date.parse(expiresAt) - now());
  const controller = new AbortController();
  const stop = () => controller.abort(); d.signal.addEventListener("abort", stop, { once: true });
  const timer = setTimeout(stop, Math.max(0, Math.min(STAGE_MS, Date.parse(expiresAt) - now())));
  function active() {
    handoffAssert(!d.signal.aborted, "handoff_stopped");
    handoffAssert(!controller.signal.aborted && mono() < end && now() >= Date.parse(scope.approvedAt) &&
      now() < Date.parse(expiresAt), "handoff_expired");
  }
  async function work<T>(fn: () => Promise<T>): Promise<T> {
    active(); let abort!: () => void;
    const cancelled = new Promise<never>((_, reject) => { abort = () => reject(new EtsySteelHandoffError(d.signal.aborted ? "handoff_stopped" : "handoff_expired")); controller.signal.addEventListener("abort", abort, { once: true }); });
    try { const v = await Promise.race([Promise.resolve().then(() => { active(); return fn(); }), cancelled]); active(); return v; }
    finally { controller.signal.removeEventListener("abort", abort); }
  }
  return { now, active, work, signal: controller.signal, close() { clearTimeout(timer); d.signal.removeEventListener("abort", stop); controller.abort(); } };
}
async function permit(scope: EtsySteelHandoffScope, d: EtsySteelHandoffDependencies, s: ReturnType<typeof stage>, operation: EtsySteelHandoffOperation,
  reservation: Reservation | null, recordId: string | null = null, session: PrivateSession | null = null) {
  const request: EtsySteelHandoffAdmissionRequest = {
    version: "etsy.steel-owner-handoff-admission.1", operation, requestId: randomUUID(), scopeHash: etsySteelHash(scope),
    operationId: scope.operationId, ownerId: scope.ownerId, businessId: scope.businessId, authorityRootId: scope.authorityRootId,
    testEnvelopeId: scope.testEnvelopeId, testEnvelopeHash: scope.testEnvelopeHash, providerProjectId: scope.providerProjectId,
    accountId: scope.accountId, accountRevision: scope.accountRevision, approvalId: scope.approvalId, approvalRevision: scope.approvalRevision,
    disclosureHash: scope.disclosureHash, quoteHash: scope.quoteHash, maximumBrowserMicrounits: scope.maximumBrowserMicrounits,
    handoffId: recordId, sessionId: session?.sessionId ?? null, profileId: session?.profileId ?? null,
    reservationId: reservation?.reservationId ?? null, reservationHash: reservation?.reservationHash ?? null,
  };
  let p: EtsySteelHandoffPermit;
  try { p = structuredClone(await s.work(() => d.admit(immutable(request)))); }
  catch (e) { if (e instanceof EtsySteelHandoffError) throw e; throw new EtsySteelHandoffError("handoff_admission_denied"); }
  handoffExact(p, "version,requestHash,approval,reservationId,reservationHash,reservedBrowserMicrounits,expiresAt", "handoff_permit_invalid");
  handoffAssert(p.version === "etsy.steel-owner-handoff-permit.1" && p.requestHash === etsySteelHash(request) &&
    p.approval === "explicit_owner_persistent_access_and_budget" && handoffUuid(p.reservationId) && handoffHash(p.reservationHash) &&
    p.reservedBrowserMicrounits === scope.maximumBrowserMicrounits && handoffInstant(p.expiresAt) && Date.parse(p.expiresAt) > s.now() &&
    Date.parse(p.expiresAt) <= Math.min(Date.parse(scope.approvalExpiresAt), s.now() + 30_000) &&
    (!reservation || reservation.reservationId === p.reservationId && reservation.reservationHash === p.reservationHash), "handoff_permit_invalid");
  return p;
}
function assertPermitFresh(p: EtsySteelHandoffPermit, s: ReturnType<typeof stage>) {
  s.active(); handoffAssert(Date.parse(p.expiresAt) > s.now(), "handoff_permit_expired");
}
function registeredCleanup(d: EtsySteelHandoffDependencies) {
  let done!: () => void;
  const completion = new Promise<void>(resolve => { done = resolve; });
  try { d.registerCleanup(completion); } catch { done(); throw new EtsySteelHandoffError("handoff_cleanup_registration_required"); }
  return done;
}
function cleanupWindow() {
  const end = performance.now() + CLEANUP_MS;
  return async <T>(fn: () => Promise<T>): Promise<T | null> => {
    const left = end - performance.now(); if (left <= 0) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([Promise.resolve().then(fn), new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), left); })]); }
    catch { return null; } finally { clearTimeout(timer); }
  };
}
async function release(id: string | null, d: EtsySteelHandoffDependencies, bounded: ReturnType<typeof cleanupWindow>) {
  if (!id) return false;
  const result = await bounded(() => d.releaseSession(id));
  return result?.sessionId === id && result.released === true && result.terminalReadback === true;
}
async function recordOutcome(result: EtsySteelHandoffReceipt, scope: EtsySteelHandoffScope, d: EtsySteelHandoffDependencies,
  bounded: ReturnType<typeof cleanupWindow>) {
  const saved = await bounded(async () => { await d.recordOutcome(immutable(result)); return true; });
  if (saved) return result;
  return receipt(scope, { ...result, status: "failed", reason: "handoff_outcome_recording_unconfirmed", liabilityState:
    result.liabilityState === "not_dispatched" ? "not_dispatched" : "unknown" });
}

export async function beginEtsySteelHandoff(input: EtsySteelHandoffScope, d: EtsySteelHandoffDependencies): Promise<EtsySteelHandoffReceipt> {
  const scope = validateEtsySteelHandoffScope(input); validateDependencies(d);
  const done = registeredCleanup(d), s = stage(scope, d);
  let reservation: EtsySteelHandoffPermit | null = null, creation: Promise<EtsySteelOwnerSession> | null = null;
  let session: EtsySteelOwnerSession | null = null, pinned: PrivateSession | null = null, dispatched = false;
  let result = receipt(scope, {}), handedOff = false, pendingHandoffId: string | null = null;
  try {
    reservation = await permit(scope, d, s, "create", null); assertPermitFresh(reservation, s);
    const createdAt = s.now(), expiresAt = new Date(Math.min(Date.parse(scope.approvalExpiresAt), createdAt + scope.maximumSessionMs)).toISOString();
    dispatched = true;
    creation = Promise.resolve().then(() => {
      assertPermitFresh(reservation!, s);
      return d.createSession(Object.freeze({ browserSessionId: scope.operationId, profileId: null,
        timeoutMs: Date.parse(expiresAt) - createdAt }), s.signal);
    });
    session = await s.work(() => creation!);
    handoffAssert(session && session.providerKey === "steel" && session.providerProjectId === scope.providerProjectId && session.providerSessionId === scope.operationId && handoffUuid(session.providerSessionId) && handoffUuid(session.profileId) &&
      session.freshProfile === true && session.entryUrl === "https://www.etsy.com" && typeof session.disconnectForOwner === "function", "handoff_session_invalid");
    pinned = privateSession({ version: "etsy.steel-owner-private.1", scopeHash: etsySteelHash(scope), sessionId: session.providerSessionId,
      profileId: session.profileId, viewerUrl: viewerUrl(session.debugUrl, session.providerSessionId) }, etsySteelHash(scope));
    const proof = structuredClone(await s.work(() => session!.disconnectForOwner(s.signal)));
    handoffExact(proof, "version,sessionId,cdpDisconnected,observersDrained,inFlightCommandsSettled,appCaptureStopped,routeHandlersDrained,eventListenersRemoved", "handoff_disconnect_unconfirmed");
    handoffAssert(proof.version === "etsy.steel-owner-disconnect.1" && proof.sessionId === pinned.sessionId &&
      proof.cdpDisconnected === true && proof.observersDrained === true && proof.inFlightCommandsSettled === true &&
      proof.appCaptureStopped === true && proof.routeHandlersDrained === true && proof.eventListenersRemoved === true &&
      session.providerSessionId === pinned.sessionId && session.profileId === pinned.profileId && session.debugUrl === pinned.viewerUrl,
    "handoff_disconnect_unconfirmed");
    const id = randomUUID(); pendingHandoffId = id;
    const publish = await permit(scope, d, s, "publish_handoff", reservation, id, pinned);
    assertPermitFresh(publish, s);
    const body: Omit<EtsySteelHandoffRecord, "recordHash"> = { version: "etsy.steel-owner-handoff-record.1", id,
      scope, scopeHash: etsySteelHash(scope), reservationId: reservation.reservationId, reservationHash: reservation.reservationHash,
      envelope: sealAccountSecret(pinned, secretContext(scope), d.vaultKey), disconnectProof: proof, createdAt: new Date(createdAt).toISOString(), expiresAt };
    const record = { ...body, recordHash: etsySteelHash(body) };
    const stored = await s.work(() => { assertPermitFresh(publish, s); return d.storeHandoff(immutable(record), immutable(publish)); });
    handoffExact(stored, "recordHash,cleanupRegistered", "handoff_storage_unconfirmed");
    handoffAssert(stored.recordHash === record.recordHash && stored.cleanupRegistered === true, "handoff_storage_unconfirmed");
    handedOff = true;
    result = receipt(scope, { handoffId: id, status: "awaiting_owner", reason: "owner_entry_required", releaseState: "held_for_owner",
      liabilityState: "held", reservationId: reservation.reservationId, reservationHash: reservation.reservationHash });
  } catch (e) { result = receipt(scope, { handoffId: pendingHandoffId, reason: code(e), status: d.signal.aborted ? "stopped" : "failed" }); }
  finally {
    s.close(); const bounded = cleanupWindow();
    if (!handedOff && dispatched) {
      // Late creation is released within this registered cleanup budget. Beyond
      // it, liability stays unknown and the provider TTL/durable reconciler owns
      // recovery. Never retry create or assume no session from a timeout.
      if (!session && creation) session = await bounded(() => creation!);
      const id = pinned?.sessionId ?? (handoffUuid(session?.providerSessionId) ? session.providerSessionId : null);
      const verified = await release(id, d, bounded);
      result = receipt(scope, { ...result, releaseState: verified ? "verified" : "unconfirmed", liabilityState: verified ? "receipt_required" : "unknown",
        reservationId: reservation?.reservationId ?? null, reservationHash: reservation?.reservationHash ?? null });
    }
    result = await recordOutcome(result, scope, d, bounded); done();
  }
  return result;
}

async function load(owner: EtsySteelOwner, id: string, d: EtsySteelHandoffDependencies) {
  handoffExact(owner, "ownerId,businessId", "handoff_owner_required");
  handoffAssert(handoffUuid(owner.ownerId) && handoffUuid(owner.businessId) && handoffUuid(id), "handoff_owner_required");
  let loaded: unknown;
  try { loaded = await awaitRequestDeadline(d.loadHandoff(immutable(owner), id),requestDeadline(5_000)); } catch { throw new EtsySteelHandoffError("handoff_record_unavailable"); }
  const record = validateEtsySteelHandoffRecord(loaded, owner, id);
  const session = privateSession(unsealAccountSecret(record.envelope, secretContext(record.scope), d.vaultKey), record.scopeHash);
  return { record, session };
}

/** Owner HTTP handler only: private/no-store/no-referrer response, never a model
 * tool, log, audit payload or artifact. The trusted loader must reject consumed
 * records; admission rechecks the current owner/account/approval on every view. */
export async function openEtsySteelOwnerHandoff(owner: EtsySteelOwner, id: string, d: EtsySteelHandoffDependencies) {
  validateDependencies(d);
  let s: ReturnType<typeof stage> | null = null;
  try {
    const { record, session } = await load(owner, id, d); s = stage(record.scope, d, record.expiresAt);
    const p = await permit(record.scope, d, s, "owner_view", record, record.id, session); assertPermitFresh(p, s);
    return { handoffId: id, viewerUrl: session.viewerUrl, expiresAt: record.expiresAt };
  } catch (e) { throw new EtsySteelHandoffError(code(e)); } finally { s?.close(); }
}

/** Consumes the live handoff first. It never reconnects to the login session,
 * inspects logged-in pages, or treats READY as account/Insights verification. */
export async function finishEtsySteelHandoff(owner: EtsySteelOwner, id: string, action: "return" | "stop", d: EtsySteelHandoffDependencies): Promise<EtsySteelHandoffReceipt> {
  validateDependencies(d); handoffAssert(action === "return" || action === "stop", "handoff_action_invalid");
  const { record, session } = await load(owner, id, d), scope = record.scope;
  const done = registeredCleanup(d), s = stage(scope, d, record.expiresAt);
  let consumed = false, released = false, result = receipt(scope, { handoffId: id, reservationId: record.reservationId, reservationHash: record.reservationHash,
    releaseState: "held_for_owner", liabilityState: "held" });
  try {
    const p = action === "return" ? await permit(scope, d, s, "owner_return", record, id, session) : null;
    if (p) assertPermitFresh(p, s);
    // Stop cleanup is deliberately independent of the expired/revoked read fence.
    const accepted = await cleanupWindow()(() => d.consumeHandoff(immutable(record), immutable(owner), action, p ? immutable(p) : null));
    handoffAssert(accepted?.consumed === true && accepted.recordHash === record.recordHash, "handoff_consumption_unconfirmed");
    consumed = true;
    released = await release(session.sessionId, d, cleanupWindow());
    handoffAssert(released, "handoff_release_unconfirmed");
    if (action === "stop") result = receipt(scope, { handoffId: id, status: "stopped", reason: "owner_stopped",
      releaseState: "verified", liabilityState: "receipt_required", reservationId: record.reservationId, reservationHash: record.reservationHash });
    else {
      let ready = false;
      for (let attempt = 0; attempt < 10; attempt++) {
        const read = await permit(scope, d, s, "profile_readback", record, id, session); assertPermitFresh(read, s);
        const profile = structuredClone(await s.work(() => { assertPermitFresh(read, s); return d.readProfile(session.profileId, s.signal); }));
        handoffExact(profile, "id,sourceSessionId,status", "handoff_profile_invalid");
        handoffAssert(profile.id === session.profileId && profile.sourceSessionId === session.sessionId &&
          ["UPLOADING","READY","FAILED"].includes(profile.status), "handoff_profile_invalid");
        if (profile.status === "READY") { ready = true; break; }
        handoffAssert(profile.status !== "FAILED", "handoff_profile_failed");
        await s.work(() => new Promise(resolve => setTimeout(resolve, 200)));
      }
      handoffAssert(ready, "handoff_profile_pending");
      const body: Omit<EtsySteelProfileCandidate, "candidateHash"> = { version: "etsy.steel-profile-candidate.1", handoffId: id,
        scopeHash: record.scopeHash, ownerId: scope.ownerId, businessId: scope.businessId, accountId: scope.accountId,
        testEnvelopeId: scope.testEnvelopeId, testEnvelopeHash: scope.testEnvelopeHash,
        accountRevision: scope.accountRevision, expectedShopName: scope.expectedShopName, expectedShopId: scope.expectedShopId,
        approvalId: scope.approvalId, approvalRevision: scope.approvalRevision, purpose: scope.purpose,
        providerProjectId:scope.providerProjectId, profileId: session.profileId, sourceSessionId: session.sessionId, expiresAt: scope.profileAccessExpiresAt,
        accountIdentityVerified: false, insightsAccessVerified: false, reuseRequiresFreshAuthority: true };
      const candidate = { ...body, candidateHash: etsySteelHash(body) };
      const accept = await permit(scope, d, s, "accept_profile", record, id, session); assertPermitFresh(accept, s);
      const saved = await s.work(() => { assertPermitFresh(accept, s); return d.saveProfileCandidate(immutable(candidate), immutable(accept)); });
      handoffExact(saved, "candidateHash,bindingId,revision", "handoff_profile_storage_unconfirmed");
      handoffAssert(saved.candidateHash === candidate.candidateHash && handoffUuid(saved.bindingId) && handoffUuid(saved.revision), "handoff_profile_storage_unconfirmed");
      result = receipt(scope, { handoffId: id, status: "profile_pending_verification", reason: "separate_account_and_insights_verification_required",
        releaseState: "verified", liabilityState: "receipt_required", reservationId: record.reservationId, reservationHash: record.reservationHash,
        profileBindingId: saved.bindingId, profileBindingRevision: saved.revision });
    }
  } catch (e) { result = receipt(scope, { handoffId: id, status: action === "stop" && consumed ? "stopped" : "failed", reason: code(e),
    releaseState: released ? "verified" : "unconfirmed", liabilityState: released ? "receipt_required" : "unknown",
    reservationId: record.reservationId, reservationHash: record.reservationHash }); }
  finally {
    s.close(); const bounded = cleanupWindow();
    // Consumption ambiguity does not authorize continued use. Release the exact
    // existing session even when admission is revoked or its CAS reply is lost.
    if (!consumed) {
      const invalidated = await bounded(() => d.consumeHandoff(immutable(record), immutable(owner), "stop", null));
      consumed = invalidated?.consumed === true && invalidated.recordHash === record.recordHash;
    }
    if (!released) {
      released = await release(session.sessionId, d, bounded);
      result = receipt(scope, { ...result, releaseState: released ? "verified" : "unconfirmed",
        liabilityState: released && consumed ? "receipt_required" : "unknown" });
    }
    if(action === "stop") result = receipt(scope, { ...result, status: consumed ? "stopped" : "failed",
      liabilityState: released && consumed ? "receipt_required" : "unknown" });
    result = await recordOutcome(result, scope, d, bounded); done();
  }
  return result;
}
