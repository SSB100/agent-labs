import test from 'node:test';
import assert from 'node:assert/strict';
import {landingFixture,controls,hash} from './helpers/etsy-insights-landing-fixture.mjs';
import {open,search} from './helpers/etsy-insights-playwright-fixture.mjs';

test('explicit landing .2 verifies the visible same-shop no-query page and pins the new proof/context',async()=>{
 const f=landingFixture({},true),r=await f.verifier.verify(f.authority,f.stop.signal);
 assert.equal(r.status,'verified');assert.equal(r.release.observersDisposed,true);assert.equal(r.release.released,true);
 const v=r.verification;assert.equal(v.version,'etsy.steel-account-verification.2');assert.equal(v.landingControlsVersion,controls.ETSY_INSIGHTS_LANDING_CONTROLS_VERSION);
 assert.equal(v.landingControlsHash,controls.ETSY_INSIGHTS_LANDING_CONTROLS_HASH);assert.equal(v.queryControlWitnessHash,controls.ETSY_INSIGHTS_LANDING_WITNESS_HASH);
 const{verificationHash,...body}=v;assert.equal(verificationHash,hash(body));
 const{version,expiresAt,accountIdentityVerified,insightsAccessVerified,verifiedContextHash,...context}=body;void version;void expiresAt;void accountIdentityVerified;void insightsAccessVerified;
 assert.equal(verifiedContextHash,hash({version:'etsy.steel-visible-account-context.2',...context}));
 assert.equal(f.events.filter(e=>e==='create').length,1);assert.equal(f.events.includes('fill'),false);assert.equal(f.events.includes('submit'),false);assert.equal(f.events.includes('screenshot'),false);
});
test('acquisition .2 uses only the observed landing controls, then unchanged independent result witnesses',async()=>{
 const f=landingFixture(),session=await open(f);assert.equal((await session.observeAggregateView(f.stop.signal)).queryControl.id,controls.ETSY_INSIGHTS_LANDING_CONTROL_ID);const results=await search(f,session),capture=await session.captureSameEpoch(results.documentEpoch,f.stop.signal);
 assert.equal(results.queryControl.id,'observed-insights-query-form');assert.equal(results.view,'results');assert.equal(capture.facts.find(x=>x.kind==='query').quote,f.s.query);
 assert.equal(f.events.filter(e=>e==='fill').length,1);assert.equal(f.events.filter(e=>e==='submit').length,1);
 await assert.rejects(search(f,session));assert.equal(f.events.filter(e=>e==='submit').length,1);assert.equal((await session.close(session.sessionId)).observersDisposed,true);
});
for(const [label,change] of Object.entries({
 missingInput:{missingInput:true},duplicateInput:{duplicateInput:true},missingLabel:{missingLabel:true},duplicateLabel:{duplicateLabel:true},
 mismatchedName:{inputAttributes:{name:'wrong'}},mismatchedType:{inputAttributes:{type:'password'}},mismatchedLabelRef:{inputAttributes:{'aria-labelledby':'other'}},
 ariaOverride:{inputAttributes:{'aria-label':'Search'}},wrongLabel:{labelText:'Other search label'},hiddenLabel:{labelHidden:true},wrongTextboxName:{wrongInputAccessibleName:true},
 wrongContainer:{wrongContainer:true},extraContainerInput:{extraContainerInput:true},extraContainerButton:{extraContainerButton:true},nestedInput:{nestedInput:true},nestedSubmit:{nestedSubmit:true},
 duplicateSubmit:{duplicateSubmit:true},wrongButtonName:{wrongButtonAccessibleName:true},buttonLabelMismatch:{buttonLabel:'Go'},multipleButtonRefs:{buttonAttributes:{'aria-labelledby':'one two'}},
 inputDisabled:{inputDisabled:true},buttonDisabled:{buttonDisabled:true},buttonHidden:{buttonHidden:true},
})){test(`landing .2 refuses ${label} without query or account proof`,async()=>{
 const f=landingFixture(change,true),r=await f.verifier.verify(f.authority,f.stop.signal);assert.equal(r.status,'paused');assert.equal(r.verification,null);assert.equal(r.release.released,true);assert.equal(f.events.includes('submit'),false);
 const source=landingFixture(change),session=await open(source);await assert.rejects(search(source,session));assert.equal(source.events.includes('fill'),false);assert.equal(source.events.includes('submit'),false);await session.close(session.sessionId);
});}
for(const change of [{changeShopAfterFill:true},{changeControlsAfterFill:true}])test('account and controls are checked again after fill before quota-consuming submit',async()=>{
 const f=landingFixture(change),session=await open(f);await assert.rejects(search(f,session));assert.equal(f.events.includes('fill'),true);assert.equal(f.events.includes('submit'),false);await session.close(session.sessionId);
});
for(const options of [{qualificationPins:{landingControlsHash:'0'.repeat(64)}},{qualificationPins:{landingControlsVersion:'etsy.insights-landing-controls.1'}},{qualificationHash:'0'.repeat(64)},{qualificationPins:{version:'r12.etsy-insights-renderer-qualification.1'}}])test('new controls require exact immutable explicit qualification before paid create',async()=>{
 const f=landingFixture(options,true),r=await f.verifier.verify(f.authority,f.stop.signal);assert.equal(r.verification,null);assert.equal(f.events.includes('create'),false);
});
test('new landing contract never weakens independent results query agreement',async()=>{
 const f=landingFixture({summaryQuery:'other query'}),session=await open(f);await assert.rejects(search(f,session));await session.close(session.sessionId);
});
