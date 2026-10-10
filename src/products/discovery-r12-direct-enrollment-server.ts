import 'server-only';
import {createHmac, randomUUID} from 'node:crypto';
import type {OwnerUiContext} from '../lib/core-ui/data';
import {verifyOwnerBusiness} from '../lib/core-ui/owner-business';
import {boundedRpc, requestDeadline} from '../core/request-deadline';
import {publicHash, publicResearchHash, publicTime, publicUuid} from './discovery-r12-public-utils';
import {
  validateDirectEnrollmentCatalog, validateDirectEnrollmentConfirmation,
  validateDirectEnrollmentInput, validateDirectEnrollmentReceipt,
  type DirectEnrollmentCatalog, type DirectEnrollmentReceipt,
} from './discovery-r12-direct-enrollment-contracts';

function check(value: unknown): asserts value {if (!value) throw Error('r12_direct_enrollment_unavailable');}
async function owner(context: OwnerUiContext, businessId: string, goalId: string): Promise<void> {
  check(publicUuid(businessId) && publicUuid(goalId) && publicUuid(context.userId) && await verifyOwnerBusiness(context, businessId));
  const claims = await context.supabase.auth.getClaims();
  check(!claims.error && claims.data?.claims?.sub === context.userId);
}
/** Same deployed derivation as owner-bootstrap. The private reviewed package
 * already pins its verifier; browser inputs cannot choose or enroll one. */
function capability(context: OwnerUiContext, businessId: string, grantId: string): string {
  const root = process.env.R05_ADMISSION_SERVER_KEY?.trim();
  check(process.env.VERCEL_ENV === 'production' && root && root.length >= 32 && root.length <= 200 && publicUuid(grantId));
  return createHmac('sha256', root).update(JSON.stringify({version:'r12.owner-bootstrap.1', businessId, ownerId:context.userId, grantId})).digest('base64url');
}
async function server(context: OwnerUiContext, businessId: string, grantId: string, operation: 'prepare'|'confirm', payload: unknown): Promise<unknown> {
  const result = await boundedRpc(context.supabase.rpc('r12_owner_direct_enrollment_server', {
    p_business_id:businessId, p_operation:operation, p_payload:payload,
    p_server_key:capability(context, businessId, grantId),
  }), requestDeadline(15000), 10000);
  check(!result.error && result.data !== null);
  return result.data;
}
export async function readDirectEnrollmentCatalog(context: OwnerUiContext, businessId: string, goalId: string, proposalId?: string): Promise<DirectEnrollmentCatalog> {
  await owner(context, businessId, goalId);
  check(proposalId === undefined || publicUuid(proposalId));
  const result = await boundedRpc(context.supabase.rpc('r12_owner_direct_enrollment_read', {
    p_business_id:businessId, p_goal_id:goalId, p_proposal_id:proposalId ?? null,
  }), requestDeadline(15000), 10000);
  check(!result.error && result.data !== null);
  return validateDirectEnrollmentCatalog(result.data, {businessId, goalId, ownerId:context.userId, ...(proposalId ? {proposalId} : {})});
}
export async function prepareDirectEnrollment(context: OwnerUiContext, businessId: string, goalId: string, reviewedPackageHash: string): Promise<DirectEnrollmentReceipt> {
  check(publicHash(reviewedPackageHash));
  const catalog = await readDirectEnrollmentCatalog(context, businessId, goalId);
  const selected = catalog.offers.find(x => x.reviewedPackageHash === reviewedPackageHash);
  check(catalog.eligible && selected && publicTime(selected.expiresAt) > Date.now());
  const payload = validateDirectEnrollmentInput({version:'r12.owner-direct-enrollment-input.1', goalId, reviewedPackageHash, submissionId:randomUUID()});
  const receipt = validateDirectEnrollmentReceipt(await server(context, businessId, selected.grantId, 'prepare', payload),
    {businessId, goalId, ownerId:context.userId, reviewedPackageHash, grantId:selected.grantId});
  check(receipt.confirmed === false && publicTime(receipt.expiresAt) <= publicTime(selected.expiresAt) &&
    publicResearchHash(receipt.preview.testBounds) === publicResearchHash(selected.testBounds) &&
    publicResearchHash(receipt.preview.qualification) === publicResearchHash(selected.qualification));
  return receipt;
}
export async function confirmDirectEnrollment(context: OwnerUiContext, businessId: string, goalId: string, proposalId: string, proposalHash: string): Promise<DirectEnrollmentReceipt> {
  check(publicUuid(proposalId) && publicHash(proposalHash));
  const catalog = await readDirectEnrollmentCatalog(context, businessId, goalId, proposalId);
  const receipt = validateDirectEnrollmentReceipt(catalog.current, {businessId, goalId, ownerId:context.userId, proposalId, proposalHash});
  // Repeated owner navigation/confirmation reads the existing immutable grant.
  // It cannot refresh expiry or consume a second enrollment package.
  if (receipt.confirmed) return receipt;
  check(publicTime(receipt.expiresAt) > Date.now());
  const payload = validateDirectEnrollmentConfirmation({version:'r12.owner-direct-enrollment-confirmation.1', proposalId, proposalHash, submissionId:randomUUID()});
  const confirmed = validateDirectEnrollmentReceipt(await server(context, businessId, receipt.preview.grantId, 'confirm', payload),
    {businessId, goalId, ownerId:context.userId, proposalId, proposalHash, reviewedPackageHash:receipt.preview.reviewedPackageHash, grantId:receipt.preview.grantId});
  check(confirmed.confirmed === true && confirmed.createdAt === receipt.createdAt && confirmed.expiresAt === receipt.expiresAt);
  return confirmed;
}
