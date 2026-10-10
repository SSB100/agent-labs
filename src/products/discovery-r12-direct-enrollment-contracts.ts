import {publicHash, publicInteger, publicMoney, publicResearchHash, publicTime, publicUuid} from './discovery-r12-public-utils';

/** Owner projections only. These hashes identify separately authenticated
 * reviews; structural validation never qualifies a provider or grants access. */
export type DirectEnrollmentBounds = {
  currency: 'USD'; maximumTestMicrounits: string; maximumUnitsInWindow: number;
  cumulativeDispatchesCeiling: number;
};
export type DirectEnrollmentQualification = {
  releaseHash: string; routeHash: string; tariffHash: string; sourceQualificationHash: string;
  ownerRendererReviewHash: string; verificationCandidateReviewHash: string;
  researchRendererReviewHash: string; landingControlsHash: string; reviewExpiresAt: string;
};
export type DirectEnrollmentOffer = {
  reviewedPackageHash: string; grantId: string; expiresAt: string;
  testBounds: DirectEnrollmentBounds; qualification: DirectEnrollmentQualification;
};
export type DirectEnrollmentProposal = {
  version: 'r12.owner-direct-enrollment-proposal.1'; businessId: string; goalId: string;
  ownerId: string; reviewedPackageHash: string; grantId: string; profileId: string;
  authorityRootId: string; bindingId: string; originHash: string;
  businessRevision: number; businessHash: string; goalRevision: number; goalHash: string;
  currentGrantRoot: {rootId: string; revision: number; revisionHash: string; maximumScopes: number;
    maximumAllocationMicrounits: string; scopesUsed: number; allocationUsedMicrounits: string};
  proposedGrantRoot: {revision: number; previousHash: string; maximumScopes: number;
    maximumAllocationMicrounits: string; expiresAt: string};
  testBounds: DirectEnrollmentBounds; qualification: DirectEnrollmentQualification;
  expiresAt: string; authorityCreated: false;
};
export type DirectEnrollmentReceipt = {
  version: 'r12.owner-direct-enrollment-receipt.1'; businessId: string; goalId: string;
  proposalId: string; proposalHash: string; confirmed: boolean; createdAt: string;
  expiresAt: string; preview: DirectEnrollmentProposal;
};
export const DIRECT_ENROLLMENT_REASONS = ['reviewed_package_required', 'current_origin_unavailable',
  'unresolved_liability', 'lifetime_bound_exhausted', 'reviewed_package_inactive', 'already_enrolled', 'historical_selection'] as const;
export type DirectEnrollmentCatalog = {
  version: 'r12.owner-direct-enrollment-catalog.1'; businessId: string; goalId: string; ownerId: string;
  eligible: boolean; reason: typeof DIRECT_ENROLLMENT_REASONS[number] | null;
  offers: DirectEnrollmentOffer[]; current: DirectEnrollmentReceipt | null;
};
export type DirectEnrollmentInput = {
  version: 'r12.owner-direct-enrollment-input.1'; goalId: string; reviewedPackageHash: string; submissionId: string;
};
export type DirectEnrollmentConfirmation = {
  version: 'r12.owner-direct-enrollment-confirmation.1'; proposalId: string; proposalHash: string; submissionId: string;
};
type Pins = {businessId?: string; goalId?: string; ownerId?: string; proposalId?: string; proposalHash?: string; reviewedPackageHash?: string; grantId?: string};
const fail = (): never => {throw Error('r12_direct_enrollment_unavailable');};
function check(value: unknown): asserts value {if (!value) fail();}
function exact(value: unknown, fields: string): asserts value is Record<string, unknown> {
  check(!!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === fields.split(',').sort().join(','));
}
/** Reject accessors and exotic objects before hashing/cloning. Neither receipt
 * validation nor error handling evaluates a caller-controlled getter/toJSON. */
function scan(value: unknown): void {
  let nodes = 0, bytes = 0;
  const visit = (v: unknown, depth: number): void => {
    check(++nodes <= 2000 && depth <= 12);
    if (typeof v === 'string') {bytes += Buffer.byteLength(v, 'utf8'); check(v.length <= 4096 && bytes <= 131072); return;}
    if (v === null || typeof v === 'boolean') return;
    if (typeof v === 'number') {check(Number.isSafeInteger(v)); return;}
    check(!!v && typeof v === 'object');
    check(Object.getPrototypeOf(v) === (Array.isArray(v) ? Array.prototype : Object.prototype) || Object.getPrototypeOf(v) === null);
    const descriptors = Object.getOwnPropertyDescriptors(v);
    for (const key of Reflect.ownKeys(v)) {
      check(typeof key === 'string' && !['__proto__', 'constructor', 'prototype', 'toJSON'].includes(key));
      const d = descriptors[key]; check('value' in d && !d.get && !d.set);
      if (Array.isArray(v) && key === 'length') continue;
      check(d.enumerable); visit(d.value, depth + 1);
    }
  };
  visit(value, 0);
}
function bounds(value: unknown): asserts value is DirectEnrollmentBounds {
  exact(value, 'currency,maximumTestMicrounits,maximumUnitsInWindow,cumulativeDispatchesCeiling');
  check(value.currency === 'USD' && publicMoney(value.maximumTestMicrounits) > BigInt(0) &&
    publicMoney(value.maximumTestMicrounits) <= BigInt(10000000) && publicInteger(value.maximumUnitsInWindow, 1, 32) &&
    publicInteger(value.cumulativeDispatchesCeiling, 4, 64));
}
function qualification(value: unknown): asserts value is DirectEnrollmentQualification {
  exact(value, 'releaseHash,routeHash,tariffHash,sourceQualificationHash,ownerRendererReviewHash,verificationCandidateReviewHash,researchRendererReviewHash,landingControlsHash,reviewExpiresAt');
  check(Object.entries(value).every(([k, v]) => k === 'reviewExpiresAt' ? Number.isFinite(publicTime(v)) : publicHash(v)));
}
function offer(value: unknown): asserts value is DirectEnrollmentOffer {
  exact(value, 'reviewedPackageHash,grantId,expiresAt,testBounds,qualification');
  check(publicHash(value.reviewedPackageHash) && publicUuid(value.grantId));
  bounds(value.testBounds); qualification(value.qualification);
  check(publicTime(value.expiresAt) <= publicTime(value.qualification.reviewExpiresAt));
}
function proposal(value: unknown): asserts value is DirectEnrollmentProposal {
  exact(value, 'version,businessId,goalId,ownerId,reviewedPackageHash,grantId,profileId,authorityRootId,bindingId,originHash,businessRevision,businessHash,goalRevision,goalHash,currentGrantRoot,proposedGrantRoot,testBounds,qualification,expiresAt,authorityCreated');
  check(value.version === 'r12.owner-direct-enrollment-proposal.1' && value.authorityCreated === false &&
    [value.businessId,value.goalId,value.ownerId,value.grantId,value.profileId,value.authorityRootId,value.bindingId].every(publicUuid) &&
    [value.reviewedPackageHash,value.originHash,value.businessHash,value.goalHash].every(publicHash) &&
    publicInteger(value.businessRevision, 1) && publicInteger(value.goalRevision, 1));
  bounds(value.testBounds); qualification(value.qualification);
  const old = value.currentGrantRoot, next = value.proposedGrantRoot;
  exact(old, 'rootId,revision,revisionHash,maximumScopes,maximumAllocationMicrounits,scopesUsed,allocationUsedMicrounits');
  exact(next, 'revision,previousHash,maximumScopes,maximumAllocationMicrounits,expiresAt');
  check(publicUuid(old.rootId) && publicHash(old.revisionHash) && publicInteger(old.revision, 0, 31) &&
    publicInteger(old.maximumScopes, 1, 31) && publicInteger(old.scopesUsed, 0, old.maximumScopes) &&
    publicMoney(old.maximumAllocationMicrounits) > BigInt(0) &&
    publicMoney(old.allocationUsedMicrounits) <= publicMoney(old.maximumAllocationMicrounits));
  // One new envelope's reviewed allocation extends the SAME cumulative root.
  // This is allocated allowance, not a replacement for known actual spending.
  check(next.revision === old.revision + 1 && next.previousHash === old.revisionHash &&
    next.maximumScopes === old.maximumScopes + 1 &&
    publicMoney(next.maximumAllocationMicrounits) === publicMoney(old.maximumAllocationMicrounits) + publicMoney(value.testBounds.maximumTestMicrounits) &&
    publicTime(value.expiresAt) <= publicTime(next.expiresAt) &&
    publicTime(value.expiresAt) <= publicTime(value.qualification.reviewExpiresAt));
}
function receipt(value: unknown, expected: Pins): asserts value is DirectEnrollmentReceipt {
  exact(value, 'version,businessId,goalId,proposalId,proposalHash,confirmed,createdAt,expiresAt,preview');
  check(value.version === 'r12.owner-direct-enrollment-receipt.1' && [value.businessId,value.goalId,value.proposalId].every(publicUuid) &&
    publicHash(value.proposalHash) && typeof value.confirmed === 'boolean' && publicTime(value.createdAt) < publicTime(value.expiresAt));
  proposal(value.preview);
  check(value.preview.businessId === value.businessId && value.preview.goalId === value.goalId && value.preview.expiresAt === value.expiresAt &&
    publicResearchHash(value.preview) === value.proposalHash);
  for (const [key, pin] of Object.entries(expected)) {
    const actual = ['ownerId','reviewedPackageHash','grantId'].includes(key) ? value.preview[key as keyof DirectEnrollmentProposal] : value[key];
    check(actual === pin);
  }
}
function validated<T>(value: unknown, validate: (v: unknown) => asserts v is T): T {
  try {scan(value); validate(value); return structuredClone(value);} catch {return fail();}
}
export function validateDirectEnrollmentInput(value: unknown): DirectEnrollmentInput {
  return validated(value, (v): asserts v is DirectEnrollmentInput => {
    exact(v, 'version,goalId,reviewedPackageHash,submissionId');
    check(v.version === 'r12.owner-direct-enrollment-input.1' && publicUuid(v.goalId) && publicHash(v.reviewedPackageHash) && publicUuid(v.submissionId));
  });
}
export function validateDirectEnrollmentConfirmation(value: unknown): DirectEnrollmentConfirmation {
  return validated(value, (v): asserts v is DirectEnrollmentConfirmation => {
    exact(v, 'version,proposalId,proposalHash,submissionId');
    check(v.version === 'r12.owner-direct-enrollment-confirmation.1' && publicUuid(v.proposalId) && publicHash(v.proposalHash) && publicUuid(v.submissionId));
  });
}
export function validateDirectEnrollmentReceipt(value: unknown, expected: Pins = {}): DirectEnrollmentReceipt {
  return validated(value, (v): asserts v is DirectEnrollmentReceipt => receipt(v, expected));
}
export function validateDirectEnrollmentCatalog(value: unknown, expected: {businessId: string; goalId: string; ownerId: string; proposalId?: string}): DirectEnrollmentCatalog {
  return validated(value, (v): asserts v is DirectEnrollmentCatalog => {
    exact(v, 'version,businessId,goalId,ownerId,eligible,reason,offers,current');
    check(v.version === 'r12.owner-direct-enrollment-catalog.1' && [v.businessId,v.goalId,v.ownerId].every(publicUuid) &&
      v.businessId === expected.businessId && v.goalId === expected.goalId && v.ownerId === expected.ownerId &&
      typeof v.eligible === 'boolean' && Array.isArray(v.offers) && v.offers.length <= 10);
    for (const x of v.offers) offer(x);
    const offers = v.offers as DirectEnrollmentOffer[];
    check(new Set(offers.map(x => x.reviewedPackageHash)).size === offers.length && new Set(offers.map(x => x.grantId)).size === offers.length);
    check(v.eligible ? v.reason === null && offers.length > 0 : offers.length === 0 && typeof v.reason === 'string' && DIRECT_ENROLLMENT_REASONS.includes(v.reason as typeof DIRECT_ENROLLMENT_REASONS[number]));
    if (expected.proposalId !== undefined) check(v.eligible === false && offers.length === 0);
    if (v.current !== null) receipt(v.current, expected);
    else check(expected.proposalId === undefined);
  });
}
