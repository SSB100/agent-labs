import test from 'node:test';
import assert from 'node:assert/strict';
import contract from '../.core-tests/products/discovery-r12-evidence-addendum.js';
import { r12AddendumFixture } from './helpers/r12-addendum-fixture.mjs';
const now = Date.parse('2026-10-06T21:00:00Z');
const intent = { businessId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', comparisonUniverse: { markets: [{ countryCode: 'US' }, { countryCode: 'GB' }, { countryCode: 'AU' }, { countryCode: 'NZ' }] } };
test('public source addendum is immutable, exact-span and temporally bounded', () => {
  const value = r12AddendumFixture(intent, now), validated = contract.validateDiscoveryEvidenceAddendum(value, intent, now);
  assert.deepEqual(validated, value); assert.notEqual(validated, value);
  const reference = contract.discoveryAddendumReferences(value)[0];
  assert.deepEqual(contract.discoveryAddendumObservation(value, reference), value.observations[0]);
  assert.throws(() => contract.discoveryAddendumObservation(value, { ...reference, end: reference.end - 1 }), /unverified/);
});
test('reject stale, altered, private, widened or falsely classified observations before model ingestion', () => {
  for (const mutate of [
    v => v.businessId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    v => v.observations[0].context += ' Changed context.',
    v => v.observations[0].retrievedAt = new Date(now + 1).toISOString(),
    v => v.observations[0].expiresAt = new Date(now).toISOString(),
    v => v.expiresAt = new Date(now + 25 * 3600000).toISOString(),
    v => v.observations[0].url = 'https://user:secret@example.org/a',
    v => v.observations[0].url = 'https://127.0.0.1/a',
    v => v.observations[0].url = 'https://example.org/a?customer=private',
    v => v.observations[0].url = 'https://www.etsy.com/listing/123/nature',
    v => v.observations[0].dimensions.push('demand'),
    v => v.observations[0].countries = ['CA'],
    v => v.observations[0].limitations = [],
    v => v.observations[0].access = 'openrouter.exa',
    v => v.observations.push(structuredClone(v.observations[0])),
    v => v.observations[0].rawProviderReceipt = 'fabricated',
  ]) {
    const value = r12AddendumFixture(intent, now); mutate(value);
    assert.throws(() => contract.validateDiscoveryEvidenceAddendum(value, intent, now), /unverified/);
  }
});
test('official Etsy fee documents retain a narrow operating role without marketplace access', () => {
  const value = r12AddendumFixture(intent, now), observation = value.observations[0];
  observation.kind = 'official_operating_fact'; observation.dimensions = ['estimated_margin']; observation.url = 'https://www.etsy.com/legal/fees/';
  assert.doesNotThrow(() => contract.validateDiscoveryEvidenceAddendum(value, intent, now));
  observation.dimensions.push('competition');
  assert.throws(() => contract.validateDiscoveryEvidenceAddendum(value, intent, now), /unverified/);
});

test('repeated-text compression retains every value, ordering and adverse uncertainty without semantic shortening',()=>{
 const badNews='No candidate-specific evidence establishes buyer demand; retain this unknown and do not represent the result as profitable sales. 🏕️';
 const original={evidence:[{quote:badNews,context:badNews}],assessment:{rows:[[badNews,false,0,null],[badNews,'unique reasoning']]},previousDecision:{outcome:'NEEDS_MORE_EVIDENCE',reason:badNews}};
 const encoded=contract.compactDiscoveryEvidenceInput(original);
 const decode=v=>Array.isArray(v)?v.map(decode):v&&typeof v==='object'?Object.keys(v).length===1&&'$text' in v?encoded.sharedText[v.$text]:Object.fromEntries(Object.entries(v).filter(([k])=>k!=='sharedText').map(([k,value])=>[k,decode(value)])):v;
 assert.ok(Buffer.byteLength(JSON.stringify(encoded))<Buffer.byteLength(JSON.stringify(original)));
 assert.deepEqual(decode(encoded),original);
 assert.deepEqual(contract.compactDiscoveryEvidenceInput({short:'abc',other:'unique'}),{short:'abc',other:'unique'});
 assert.throws(()=>contract.compactDiscoveryEvidenceInput({value:{$text:1}}),/unverified/);
});
