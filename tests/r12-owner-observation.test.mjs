import test from 'node:test';
import assert from 'node:assert/strict';
import { discoveryV2Hash } from '../.core-tests/products/discovery-v2.js';
import { adaptiveEvidenceIdentity } from '../.core-tests/products/discovery-r12-adaptive-review-contract.js';
import { validateOwnerObservationBundle, resolveOwnerObservationEvidence, ownerObservationEvidenceIdentity } from '../.core-tests/products/discovery-r12-owner-observation.js';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const time='2026-10-10T00:00:00Z', now=Date.parse(time);
function seal(b) { const {bundleHash,...body}=b; void bundleHash; return {...body,bundleHash:discoveryV2Hash(body)}; }
function fixture() {
  const content='🌿 Searches 1.1k; conversion Very low; visits 0; displayed conversion 0%.';
  const obs = {id:id(4),sourceId:'owner-source',provenance:'owner_reported_capture',
    source:{url:'https://market.example/owner/insights',interface:'Owner keyword dashboard',capturedAt:time,captureHash:'a'.repeat(64)},
    context:{productFormat:'Printed adult T-shirt',category:'Adult apparel',query:'nature shirt',windowStart:'2026-09-10T00:00:00Z',windowEnd:'2026-10-09T00:00:00Z',locale:'en-NZ',geography:{kind:'unknown',countries:[],basis:'No buyer-country segmentation displayed.'}},
    content,contentHash:discoveryV2Hash(content),metrics:[{id:'searches',label:'Searches',displayed:'1.1k',start:2,end:15,kind:'count',unit:'searches',value:1100,precision:'rounded'}],
    limitations:['Rounded aggregate signal; no item sales or causal demand conclusion.'],dataClass:'aggregate_nonpersonal'};
  return seal({version:'r12.owner-observations.1',id:id(1),businessId:id(2),ownerId:id(3),createdAt:time,observations:[obs],baseline:null,privacyAttestation:'reviewed_aggregate_only_no_credentials_or_customer_data'});
}
const validate=b=>validateOwnerObservationBundle(b,{businessId:id(2),ownerId:id(3),now});
const ref=b=>({artifactId:id(4),evidenceId:'searches',sourceId:'owner-source',sourceContentHash:b.observations[0].contentHash,start:2,end:15});
test('owner capture resolves exact Unicode span without provider verification or geographic inference',()=>{
  const b=fixture(),saved=validate(b),resolved=resolveOwnerObservationEvidence(saved,ref(b));
  assert.equal(resolved.quote,'Searches 1.1k');assert.equal(resolved.sourceContext.independentVerification,false);
  assert.equal(resolved.sourceContext.attribution.providerSigned,false);assert.equal(resolved.sourceContext.context.geography.kind,'unknown');
  assert.equal(resolved.sourceContext.comparisonRole,'exploratory'); saved.observations[0].content='changed';assert.notEqual(b.observations[0].content,'changed');
});
test('altered content, content hash, bundle hash and citation identity fail closed',()=>{
  for(const mutate of [b=>b.observations[0].content+=' manipulated',b=>b.observations[0].contentHash='b'.repeat(64),b=>b.bundleHash='b'.repeat(64)]) {const b=fixture();mutate(b);assert.throws(()=>validate(b));}
  const b=fixture();b.observations[0].content+=' changed';assert.throws(()=>validate(seal(b)));
  for(const patch of [{start:3},{end:16},{sourceId:'another'},{artifactId:id(9)},{sourceContentHash:'b'.repeat(64)}]) assert.throws(()=>resolveOwnerObservationEvidence(fixture(),{...ref(fixture()),...patch}));
});
test('metrics reject invalid counts, ordinal numeric conversion and unobserved text',()=>{
  for(const patch of [{value:-1},{precision:'exact',value:1.1},{displayed:'900k'},{start:-1},{end:1000}]) {const b=fixture();Object.assign(b.observations[0].metrics[0],patch);assert.throws(()=>validate(seal(b)));}
  const b=fixture();b.observations[0].metrics=[{id:'conversion',label:'Conversion',displayed:'Very low',start:0,end:Array.from(b.observations[0].content).length,kind:'ordinal',scale:['Very low','Low','High'],value:'Very low',definition:'Relative provider band; no numeric rate supplied.'}];
  assert.doesNotThrow(()=>validate(seal(b))); b.observations[0].metrics[0].numericRate=0.01;assert.throws(()=>validate(seal(b)));
  delete b.observations[0].metrics[0].numericRate;b.observations[0].metrics[0].scale=['0%','1%'];b.observations[0].metrics[0].value='0%';assert.throws(()=>validate(seal(b)));
});
test('statement preserves observed text without inventing a complete ordinal scale',()=>{
  const b=fixture(),o=b.observations[0];o.metrics=[{id:'statement',label:'Displayed qualitative observation',displayed:'Very low',start:0,end:Array.from(o.content).length,kind:'statement'}];
  assert.doesNotThrow(()=>validate(seal(b)));
  o.metrics[0].numericRate=0.01;assert.throws(()=>validate(seal(b)));
  delete o.metrics[0].numericRate;o.metrics[0].displayed='Definitely profitable';assert.throws(()=>validate(seal(b)));
});
test('displayed percentage cannot invent eligible exposure; preserve it as witnessed text',()=>{
  for(const denominator of [0,10,1000]) {
    const b=fixture();b.observations[0].metrics=[{id:'rate',label:'Displayed conversion',displayed:'0%',start:0,end:Array.from(b.observations[0].content).length,kind:'rate',unit:'fraction',numerator:0,denominator,value:denominator===0?null:0}];
    assert.throws(()=>validate(seal(b)));
    b.observations[0].metrics=[{id:'displayed-rate',label:'Displayed conversion, exposure not established',displayed:'0%',start:0,end:Array.from(b.observations[0].content).length,kind:'statement'}];
    assert.equal(validate(seal(b)).observations[0].metrics[0].kind,'statement');
  }
});
test('unknown geography, privacy, tenant attribution, timestamps and size are enforced',()=>{
  for(const mutate of [b=>b.businessId=id(8),b=>b.ownerId=id(8),b=>b.observations[0].context.geography.countries=['NZ'],b=>b.observations[0].context.windowEnd='2027-01-01T00:00:00Z',b=>b.observations[0].source.url+='?access_token=secret',b=>b.observations[0].limitations=['customer email: person@example.com'],b=>b.observations[0].limitations=['password: actualprivatevalue'],b=>b.observations[0].dataClass='customer_data',b=>b.observations=Array.from({length:9},(_,i)=>({...b.observations[0],id:id(i+20)}))]) {const b=fixture();mutate(b);assert.throws(()=>validate(seal(b)));}
  const b=fixture();b.observations=Array.from({length:8},(_,i)=>({...structuredClone(b.observations[0]),id:id(i+20),content:'x'.repeat(3000),contentHash:discoveryV2Hash('x'.repeat(3000))}));assert.throws(()=>validate(seal(b)));
});
test('equivalent quotes share identity across owner and qualified public evidence',()=>{
  assert.equal(ownerObservationEvidenceIdentity('  Cafe\u0301\n search  signal '),adaptiveEvidenceIdentity({quote:'Café search signal'}));
  assert.equal(ownerObservationEvidenceIdentity('Searches 1.1k'),resolveOwnerObservationEvidence(fixture(),ref(fixture())).evidenceIdentityHash);
});
function baselineFixture() {
  const b=fixture();b.observations=Array.from({length:4},(_,i)=>({...structuredClone(b.observations[0]),id:id(i+4),context:{...structuredClone(b.observations[0].context),query:`term ${i}`}}));
  const c=b.observations[0].context;
  b.baseline={version:'r12.owner-observation-baseline.1',declaredAt:time,timing:'retrospective',productFormat:c.productFormat,category:c.category,windowStart:c.windowStart,windowEnd:c.windowEnd,locale:c.locale,candidateObservationIds:[id(4),id(5)],referenceObservationId:id(6),hypothesis:'A narrower interest may show stronger purchase intent.',positiveCriterion:'A relevant attributable contrast justifies a bounded test.',negativeCriterion:'Relevant contrary evidence defeats the specific hypothesis.',inconclusiveCriterion:'Missing or incomparable observations remain inconclusive.'};return seal(b);
}
test('baseline retains two candidates and a reference; additions are exploratory',()=>{
  const b=baselineFixture();assert.doesNotThrow(()=>validate(b));assert.equal(resolveOwnerObservationEvidence(b,ref(b)).sourceContext.comparisonRole,'candidate');
  assert.equal(resolveOwnerObservationEvidence(b,{...ref(b),artifactId:id(7)}).sourceContext.comparisonRole,'exploratory');
  for(const mutate of [b=>b.baseline.candidateObservationIds=[id(4)],b=>b.baseline.referenceObservationId=id(4),b=>b.observations[1].context.productFormat='Mug',b=>b.observations[1].context.query=' TERM   0 ',b=>b.baseline.locale='en-US',b=>b.observations[1].metrics[0].unit='orders']) {const b=baselineFixture();mutate(b);assert.throws(()=>validate(seal(b)));}
});
test('purchase range preserves currency and displayed bounds without implying margin',()=>{
  const b=fixture(),o=b.observations[0];o.content='Median purchase price NZ$22.46–NZ$27.45';o.contentHash=discoveryV2Hash(o.content);
  o.metrics=[{id:'purchase-price',label:'Median purchase price',displayed:'NZ$22.46–NZ$27.45',start:0,end:Array.from(o.content).length,kind:'money_range',currency:'NZD',lower:22.46,upper:27.45,basis:'Displayed aggregate sampled purchase price range; excludes seller costs.'}];
  assert.doesNotThrow(()=>validate(seal(b)));o.metrics[0].currency='USD';assert.throws(()=>validate(seal(b)));o.metrics[0].currency='NZD';o.metrics[0].upper=99;assert.throws(()=>validate(seal(b)));
});
test('a post-capture declaration cannot call itself prospective',()=>{
  const b=baselineFixture();b.createdAt='2026-10-11T00:00:00Z';b.baseline.declaredAt=b.createdAt;b.baseline.timing='prospective';
  assert.throws(()=>validateOwnerObservationBundle(seal(b),{businessId:id(2),ownerId:id(3),now:Date.parse(b.createdAt)}));
  b.baseline.timing='retrospective';assert.doesNotThrow(()=>validateOwnerObservationBundle(seal(b),{businessId:id(2),ownerId:id(3),now:Date.parse(b.createdAt)}));
});

test('conflicting displayed currency witnesses cannot be resolved by picking the first code',()=>{
  const b=fixture(),o=b.observations[0];o.content='USD NZ$22.46–NZ$27.45';o.contentHash=discoveryV2Hash(o.content);
  o.metrics=[{id:'price',label:'Displayed price',displayed:o.content,start:0,end:o.content.length,kind:'money_range',currency:'USD',lower:22.46,upper:27.45,basis:'Displayed price range.'}];
  assert.throws(()=>validate(seal(b)));o.metrics[0].currency='NZD';assert.throws(()=>validate(seal(b)));
});
