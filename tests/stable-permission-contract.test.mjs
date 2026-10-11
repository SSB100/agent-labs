import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { STABLE_OPERATIONS, STABLE_PERMISSION_CONTRACT_HASH as contractHash, stablePermissionHash as hash,
  validateStableAdmissionProjection as validate } from '../.core-tests/core/stable-permission-contract.js';

const now = Date.parse('2026-10-11T21:40:00.000Z');
const from = '2026-10-11T21:00:00.000Z', until = '2026-10-12T02:06:00.000Z';
const digest = s => s.repeat(64);
function fixture(operation = 'etsy.shop.read') {
  const businessId = randomUUID(), ownerId = randomUUID(), goalId = randomUUID(), authorityRootId = randomUUID();
  const connection = operation.startsWith('etsy.') ? {
    version:'core.connection-revision.1', id:randomUUID(), revision:randomUUID(), businessId, ownerId,
    provider:'etsy_oauth', accountId:'StudioKindredStore', providerProjectId:'existingPersonalAccessApp',
    credentialBindingHash:digest('a'), scopes:['shops_r','listings_r'], operations:['etsy.shop.read','etsy.listing.read'],
    endpointPolicyHash:digest('b'), recipientPolicyHash:digest('c'), retentionPolicyHash:digest('d'),
    tariffPolicyHash:digest('e'), approvalHash:digest('f'), approvedAt:from, expiresAt:until,
  } : null;
  const envelope = {version:'core.operating-envelope.1', id:randomUUID(), businessId, ownerId, goalId, authorityRootId,
    policyId:randomUUID(), policyHash:digest('1'), contractHash, operations:[operation], connectionHash:connection ? hash(connection) : null,
    sourcePolicyHash:digest('2'), recipientPolicyHash:digest('c'), retentionPolicyHash:digest('d'), boundsHash:digest('3'), approvalHash:digest('4'), approvedAt:from, expiresAt:until};
  const identity = {repository:'SSB100/agent-labs', environment:'production', commitSha:'a'.repeat(40), treeSha:'b'.repeat(40), deploymentId:'dpl_qualified_one'};
  const release = {version:'core.qualified-release.1', identity, databaseDefinitionHash:digest('5'), schemaSecurityManifestHash:digest('6'),
    qualificationEvidenceHash:digest('7'), deploymentEvidenceHash:digest('8'), validFrom:from, expiresAt:until};
  const compatibility = {version:'core.release-compatibility.1', releaseHash:hash(release), contractHash, independentReviewHash:digest('9'), reviewedAt:from, expiresAt:until};
  const projection = {version:'core.stable-admission-projection.1', envelope, connection, release, compatibility,
    envelopeState:'active', connectionState:connection?'active':null, releaseState:'active', compatibilityState:'active',
    databaseDefinitionHash:release.databaseDefinitionHash, schemaSecurityManifestHash:release.schemaSecurityManifestHash};
  const pins = {operationId:randomUUID(), businessId, ownerId, goalId, authorityRootId, envelopeHash:hash(envelope),
    connectionHash:envelope.connectionHash, operation, requestHash:digest('0')};
  return {projection,pins,identity};
}
const run = f => validate(f.projection,f.pins,f.identity,now);
const denied = f => assert.throws(()=>run(f),/stable_permission_unverified/);
test('separately qualified compatible releases preserve exact owner permission and record executing release',()=>{
  const f = fixture(), unchanged = structuredClone({envelope:f.projection.envelope,connection:f.projection.connection,pins:f.pins});
  const first = run(f);
  f.identity = {...f.identity,commitSha:'c'.repeat(40),treeSha:'d'.repeat(40),deploymentId:'dpl_qualified_two'};
  f.projection.release = {...f.projection.release,identity:f.identity,databaseDefinitionHash:digest('a'),qualificationEvidenceHash:digest('b'),deploymentEvidenceHash:digest('c')};
  f.projection.databaseDefinitionHash = f.projection.release.databaseDefinitionHash;
  f.projection.compatibility = {...f.projection.compatibility,releaseHash:hash(f.projection.release),independentReviewHash:digest('d')};
  const second = run(f);
  assert.notEqual(first.releaseHash,second.releaseHash);
  assert.notEqual(first.compatibilityHash,second.compatibilityHash);
  assert.deepEqual({envelope:f.projection.envelope,connection:f.projection.connection,pins:f.pins},unchanged);
  assert.equal(second.envelopeHash,first.envelopeHash); assert.equal(second.connectionHash,first.connectionHash);
  assert.equal(first.identity.deploymentId,'dpl_qualified_one'); assert.equal(second.identity.deploymentId,'dpl_qualified_two');
});
for(const field of ['envelopeState','connectionState','releaseState','compatibilityState']) test(`revoked ${field} blocks projection`,()=>{
  const f=fixture();f.projection[field]='revoked';denied(f);
});
test('Stop blocks projection without rewriting fixed deadline or financial pins',()=>{
  const f=fixture(), before=structuredClone(f.projection.envelope);f.projection.envelopeState='stopped';denied(f);assert.deepEqual(f.projection.envelope,before);
});
for(const field of ['businessId','ownerId','goalId','authorityRootId']) test(`cross-${field} pin denied`,()=>{
  const f=fixture();f.pins[field]=randomUUID();denied(f);
});
for(const field of ['credentialBindingHash','endpointPolicyHash','recipientPolicyHash','retentionPolicyHash','tariffPolicyHash','approvalHash']) test(`changed connection ${field} needs a new approved pin`,()=>{
  const f=fixture();f.projection.connection[field]=digest('0');denied(f);
});
for(const change of [{revision:randomUUID()},{accountId:'anotherShop'},{providerProjectId:'anotherApp'},{scopes:['shops_r','listings_r','listings_w']},{expiresAt:'2026-10-13T02:06:00.000Z'}]) test(`material connection change ${Object.keys(change)} is denied`,()=>{
  const f=fixture();Object.assign(f.projection.connection,change);denied(f);
});
for(const field of ['policyHash','sourcePolicyHash','recipientPolicyHash','retentionPolicyHash','boundsHash','approvalHash','contractHash']) test(`changed envelope ${field} needs a new approved pin`,()=>{
  const f=fixture();f.projection.envelope[field]=digest('0');denied(f);
});
for(const field of ['envelope','connection','release','compatibility']) test(`expired ${field} blocks dispatch even with recomputed hashes`,()=>{
  const f=fixture();f.projection[field].expiresAt='2026-10-11T21:39:59.999Z';denied(f);
});
test('unknown executing deployment cannot claim the known release',()=>{
  const f=fixture();f.identity={...f.identity,deploymentId:'dpl_unqualified'};denied(f);
});
test('changed release without independent compatibility record fails',()=>{
  const f=fixture();f.projection.release.qualificationEvidenceHash=digest('d');denied(f);
});
for(const field of ['databaseDefinitionHash','schemaSecurityManifestHash']) test(`${field} drift blocks admission`,()=>{
  const f=fixture();f.projection[field]=digest('e');denied(f);
});
for(const operation of ['public.research','owner.observation.analyze']) test(`${operation} works without OAuth or a browser connection`,()=>{
  const f=fixture(operation);assert.equal(run(f).connectionHash,null);
  f.projection.connection=fixture().projection.connection;denied(f);
});
test('OAuth does not grant Insights, marketplace analytics or browser login',()=>{
  for(const operation of ['etsy.insights.read','etsy.marketplace.analytics','etsy.owner.sign_in']) {
    const f=fixture();f.pins.operation=operation;f.projection.envelope.operations=[operation];f.pins.envelopeHash=hash(f.projection.envelope);denied(f);
  }
});
test('prospective DTO never reinterprets a legacy enrollment',()=>{
  const f=fixture();f.projection.envelope.version='r12.owner-direct-test-envelope.1';f.pins.envelopeHash=hash(f.projection.envelope);denied(f);
});
test('undeclared fields, getters and exotic instances are rejected without evaluation',()=>{
  const f=fixture();f.projection.extra='ignored';denied(f);
  const getter=fixture();let called=0;Object.defineProperty(getter.projection,'envelope',{get(){called++;throw Error('unsafe getter');},enumerable:true});denied(getter);assert.equal(called,0);
  const exotic=fixture();Object.setPrototypeOf(exotic.projection.release,{toJSON(){called++;}});denied(exotic);assert.equal(called,0);
});
test('receipt pins are detached and do not carry credentials or provider URLs',()=>{
  const f=fixture(),result=run(f);assert.deepEqual(Object.keys(result).sort(),['version','operationId','requestHash','envelopeHash','connectionHash','releaseHash','compatibilityHash','contractHash','identity'].sort());
  assert.ok(Object.isFrozen(result));assert.ok(Object.isFrozen(result.identity));f.identity.deploymentId='dpl_mutated';assert.equal(result.identity.deploymentId,'dpl_qualified_one');
});

test('semantic operation allowlist is immutable at runtime',()=>{assert.ok(Object.isFrozen(STABLE_OPERATIONS));assert.throws(()=>STABLE_OPERATIONS.push('etsy.marketplace.analytics'),TypeError);});

test('every advertised OAuth operation needs its own scope, not only the requested operation',()=>{
  const f=fixture();f.projection.connection.scopes=['shops_r'];
  f.pins.connectionHash=hash(f.projection.connection);f.projection.envelope.connectionHash=f.pins.connectionHash;f.pins.envelopeHash=hash(f.projection.envelope);denied(f);
});
test('sparse and extended arrays are rejected before canonical hashing',()=>{
  const f=fixture();delete f.projection.envelope.operations[0];denied(f);
  const g=fixture();g.projection.connection.scopes.extra='hidden';denied(g);
});
