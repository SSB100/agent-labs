import { discoveryV2Hash } from '../products/discovery-v2-hash';

/** Semantic compatibility, not a credential, owner grant or release attestation.
 * Only the trusted registry/admission transaction may authenticate these facts.
 * This deterministic boundary also validates owner-safe read projections. */
export const STABLE_OPERATIONS = Object.freeze(['public.research', 'owner.observation.analyze', 'etsy.shop.read', 'etsy.listing.read', 'etsy.owner.sign_in'] as const);
export const STABLE_PERMISSION_CONTRACT = Object.freeze({
  operations: STABLE_OPERATIONS,
  providerScopeRules: Object.freeze({
    etsyOAuth: 'etsy.shop.read requires shops_r; etsy.listing.read requires listings_r; no other operations or scopes',
    steel: 'etsy.owner.sign_in only; owner_sign_in scope only',
    connectionFree: 'public.research and owner.observation.analyze only; no connection credential or access',
  }),
  version: 'core.stable-permission.1',
  authority: 'owned-current-connection-and-envelope',
  release: 'exact-independently-qualified-release-and-schema',
  financial: 'existing-r05-atomic-admission-and-held-unknown-liability',
  lifecycle: 'existing-r07-exact-attempt-no-resend',
  changes: 'material-scope-recipient-key-spend-retention-require-approval',
  history: 'immutable-no-legacy-auto-mapping',
  stop: 'deny-new-effects-allow-exact-cleanup-and-settlement',
} as const);
export const STABLE_PERMISSION_CONTRACT_HASH = discoveryV2Hash(STABLE_PERMISSION_CONTRACT);
export type StableOperation = typeof STABLE_OPERATIONS[number];
export type StableReleaseIdentity = {
  repository: 'SSB100/agent-labs'; environment: 'production';
  commitSha: string; treeSha: string; deploymentId: string;
};
export type StableReleaseQualification = {
  version: 'core.qualified-release.1'; identity: StableReleaseIdentity;
  databaseDefinitionHash: string; schemaSecurityManifestHash: string;
  qualificationEvidenceHash: string; deploymentEvidenceHash: string;
  validFrom: string; expiresAt: string;
};
export type StableReleaseCompatibility = {
  version: 'core.release-compatibility.1'; releaseHash: string; contractHash: string;
  independentReviewHash: string; reviewedAt: string; expiresAt: string;
};
export type StableConnectionRevision = {
  version: 'core.connection-revision.1'; id: string; revision: string;
  businessId: string; ownerId: string; provider: 'etsy_oauth' | 'steel';
  accountId: string; providerProjectId: string; credentialBindingHash: string;
  scopes: string[]; operations: StableOperation[]; endpointPolicyHash: string;
  recipientPolicyHash: string; retentionPolicyHash: string; tariffPolicyHash: string;
  approvalHash: string; approvedAt: string; expiresAt: string;
};
/** References the existing financial ledger; never a second allowance or a
 * replacement for current R05 reserve/marker checks under the Business lock. */
export type StableOperatingEnvelope = {
  version: 'core.operating-envelope.1'; id: string; businessId: string; ownerId: string;
  goalId: string; authorityRootId: string; policyId: string; policyHash: string;
  contractHash: string; operations: StableOperation[]; connectionHash: string | null;
  sourcePolicyHash: string; recipientPolicyHash: string; retentionPolicyHash: string; boundsHash: string;
  approvalHash: string; approvedAt: string; expiresAt: string;
};
export type StableOperationPins = {
  operationId: string; businessId: string; ownerId: string; goalId: string;
  authorityRootId: string; envelopeHash: string; connectionHash: string | null;
  operation: StableOperation; requestHash: string;
};
export type StableAdmissionProjection = {
  version: 'core.stable-admission-projection.1';
  envelope: StableOperatingEnvelope; connection: StableConnectionRevision | null;
  release: StableReleaseQualification; compatibility: StableReleaseCompatibility;
  envelopeState: 'active' | 'stopped' | 'revoked'; connectionState: 'active' | 'revoked' | null;
  releaseState: 'active' | 'revoked'; compatibilityState: 'active' | 'revoked';
  databaseDefinitionHash: string; schemaSecurityManifestHash: string;
};
export type StableExecutionPin = {
  version: 'core.execution-release-pin.1'; operationId: string; requestHash: string;
  envelopeHash: string; connectionHash: string | null; releaseHash: string;
  compatibilityHash: string; contractHash: string; identity: StableReleaseIdentity;
};
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const fail = (): never => { throw new Error('stable_permission_unverified'); };
function check(value: unknown): asserts value { if (!value) fail(); }
function exact(value: unknown, keys: string): asserts value is Record<string, unknown> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === keys.split(',').sort().join(','));
}
/** Accessors/exotic objects are rejected before hashing or reading fields. */
function snapshot<T>(value: T): T {
  let nodes = 0, bytes = 0;
  const seen = new Set<object>();
  const visit = (v: unknown, depth: number): void => {
    check(++nodes <= 1024 && depth <= 12);
    if (v === null || typeof v === 'boolean') return;
    if (typeof v === 'string') { bytes += Buffer.byteLength(v); check(v.length <= 4096 && bytes <= 32768); return; }
    check(typeof v === 'object' && v !== null && !seen.has(v)); seen.add(v);
    check(Object.getPrototypeOf(v) === (Array.isArray(v) ? Array.prototype : Object.prototype) || Object.getPrototypeOf(v) === null);
    const descriptors = Object.getOwnPropertyDescriptors(v);
    if (Array.isArray(v)) {
      check(Object.keys(v).length === v.length && Object.keys(v).every((key, index) => key === String(index)));
    }
    for (const key of Reflect.ownKeys(v)) {
      check(typeof key === 'string' && !['__proto__', 'constructor', 'prototype', 'toJSON'].includes(key));
      const d = descriptors[key]; check('value' in d && !d.get && !d.set);
      if (Array.isArray(v) && key === 'length') continue;
      check(d.enumerable); visit(d.value, depth + 1);
    }
    seen.delete(v);
  };
  visit(value, 0); return structuredClone(value);
}
function hash(v: unknown): v is string { return typeof v === 'string' && HASH.test(v); }
function uuid(v: unknown): v is string { return typeof v === 'string' && UUID.test(v); }
function instant(v: unknown): number {
  check(typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v));
  const t = Date.parse(v); check(Number.isFinite(t) && new Date(t).toISOString() === v); return t;
}
function active(start: unknown, end: unknown, now: number): void { check(instant(start) <= now && now < instant(end) && instant(start) < instant(end)); }
function operations(v: unknown): asserts v is StableOperation[] {
  check(Array.isArray(v) && v.length >= 1 && v.length <= STABLE_OPERATIONS.length && new Set(v).size === v.length && v.every(x => STABLE_OPERATIONS.includes(x)));
}
function identity(value: unknown): asserts value is StableReleaseIdentity {
  exact(value, 'repository,environment,commitSha,treeSha,deploymentId');
  check(value.repository === 'SSB100/agent-labs' && value.environment === 'production' &&
    typeof value.commitSha === 'string' && /^[a-f0-9]{40}$/.test(value.commitSha) &&
    typeof value.treeSha === 'string' && /^[a-f0-9]{40}$/.test(value.treeSha) &&
    typeof value.deploymentId === 'string' && /^dpl_[A-Za-z0-9_-]{1,124}$/.test(value.deploymentId));
}
export function stablePermissionHash(value: StableOperatingEnvelope | StableConnectionRevision | StableReleaseQualification | StableReleaseCompatibility): string {
  return discoveryV2Hash(snapshot(value));
}
/** Validates trusted readback only. A passing result is NOT a dispatch permit:
 * SQL must repeat these bindings, current revocations and financial checks and
 * atomically consume the existing operation marker immediately before send. */
export function validateStableAdmissionProjection(raw: StableAdmissionProjection, rawPins: StableOperationPins,
  executing: StableReleaseIdentity, now = Date.now()): StableExecutionPin {
  check(Number.isSafeInteger(now));
  const p = snapshot(raw), pins = snapshot(rawPins), runtime = snapshot(executing);
  exact(p, 'version,envelope,connection,release,compatibility,envelopeState,connectionState,releaseState,compatibilityState,databaseDefinitionHash,schemaSecurityManifestHash');
  exact(pins, 'operationId,businessId,ownerId,goalId,authorityRootId,envelopeHash,connectionHash,operation,requestHash');
  check(p.version === 'core.stable-admission-projection.1' && [pins.operationId,pins.businessId,pins.ownerId,pins.goalId,pins.authorityRootId].every(uuid) &&
    hash(pins.envelopeHash) && hash(pins.requestHash) && (pins.connectionHash === null || hash(pins.connectionHash)) && STABLE_OPERATIONS.includes(pins.operation));
  const e = p.envelope, c = p.connection, r = p.release, a = p.compatibility;
  exact(e, 'version,id,businessId,ownerId,goalId,authorityRootId,policyId,policyHash,contractHash,operations,connectionHash,sourcePolicyHash,recipientPolicyHash,retentionPolicyHash,boundsHash,approvalHash,approvedAt,expiresAt');
  check(e.version === 'core.operating-envelope.1' && [e.id,e.businessId,e.ownerId,e.goalId,e.authorityRootId,e.policyId].every(uuid) &&
    [e.policyHash,e.contractHash,e.sourcePolicyHash,e.recipientPolicyHash,e.retentionPolicyHash,e.boundsHash,e.approvalHash].every(hash));
  operations(e.operations); active(e.approvedAt, e.expiresAt, now);
  check(p.envelopeState === 'active' && e.contractHash === STABLE_PERMISSION_CONTRACT_HASH && stablePermissionHash(e) === pins.envelopeHash &&
    e.businessId === pins.businessId && e.ownerId === pins.ownerId && e.goalId === pins.goalId && e.authorityRootId === pins.authorityRootId &&
    e.connectionHash === pins.connectionHash && e.operations.includes(pins.operation));
  const needsConnection = pins.operation.startsWith('etsy.');
  if (needsConnection) {
    check(c !== null && hash(e.connectionHash) && p.connectionState === 'active');
    exact(c, 'version,id,revision,businessId,ownerId,provider,accountId,providerProjectId,credentialBindingHash,scopes,operations,endpointPolicyHash,recipientPolicyHash,retentionPolicyHash,tariffPolicyHash,approvalHash,approvedAt,expiresAt');
    check(c.version === 'core.connection-revision.1' && [c.id,c.revision,c.businessId,c.ownerId].every(uuid) &&
      ['etsy_oauth','steel'].includes(c.provider) && typeof c.accountId === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(c.accountId) &&
      typeof c.providerProjectId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(c.providerProjectId) &&
      [c.credentialBindingHash,c.endpointPolicyHash,c.recipientPolicyHash,c.retentionPolicyHash,c.tariffPolicyHash,c.approvalHash].every(hash));
    operations(c.operations); active(c.approvedAt, c.expiresAt, now);
    check(Array.isArray(c.scopes) && c.scopes.length > 0 && c.scopes.length <= 8 && new Set(c.scopes).size === c.scopes.length && c.scopes.every(s => typeof s === 'string' && /^[a-z_.]{1,64}$/.test(s)));
    check(c.businessId === e.businessId && c.ownerId === e.ownerId && stablePermissionHash(c) === pins.connectionHash &&
      c.operations.includes(pins.operation) && c.recipientPolicyHash === e.recipientPolicyHash);
    if (c.provider === 'etsy_oauth') check(c.scopes.every(s => ['shops_r','listings_r'].includes(s)) &&
      c.operations.every(o => ['etsy.shop.read','etsy.listing.read'].includes(o)) &&
      (!c.operations.includes('etsy.shop.read') || c.scopes.includes('shops_r')) &&
      (!c.operations.includes('etsy.listing.read') || c.scopes.includes('listings_r')));
    else check(c.operations.length === 1 && c.operations[0] === 'etsy.owner.sign_in' && c.scopes.length === 1 && c.scopes[0] === 'owner_sign_in');
  } else check(c === null && e.connectionHash === null && p.connectionState === null);
  exact(r, 'version,identity,databaseDefinitionHash,schemaSecurityManifestHash,qualificationEvidenceHash,deploymentEvidenceHash,validFrom,expiresAt');
  check(r.version === 'core.qualified-release.1' && [r.databaseDefinitionHash,r.schemaSecurityManifestHash,r.qualificationEvidenceHash,r.deploymentEvidenceHash].every(hash));
  identity(r.identity); identity(runtime); active(r.validFrom, r.expiresAt, now);
  check(p.releaseState === 'active' && discoveryV2Hash(runtime) === discoveryV2Hash(r.identity) &&
    r.databaseDefinitionHash === p.databaseDefinitionHash && r.schemaSecurityManifestHash === p.schemaSecurityManifestHash);
  exact(a, 'version,releaseHash,contractHash,independentReviewHash,reviewedAt,expiresAt');
  check(a.version === 'core.release-compatibility.1' && [a.releaseHash,a.contractHash,a.independentReviewHash].every(hash));
  active(a.reviewedAt, a.expiresAt, now);
  check(p.compatibilityState === 'active' && a.releaseHash === stablePermissionHash(r) && a.contractHash === e.contractHash &&
    instant(a.expiresAt) <= instant(r.expiresAt));
  return Object.freeze({version: 'core.execution-release-pin.1', operationId:pins.operationId, requestHash:pins.requestHash,
    envelopeHash:pins.envelopeHash, connectionHash:pins.connectionHash, releaseHash:a.releaseHash,
    compatibilityHash:stablePermissionHash(a), contractHash:e.contractHash, identity:Object.freeze(runtime)});
}
