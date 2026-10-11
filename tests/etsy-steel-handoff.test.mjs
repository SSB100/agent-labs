import test from 'node:test';import assert from 'node:assert/strict';
import {buildEtsySteelHandoffDisclosure,validateEtsySteelHandoffScope,etsySteelHash as hash} from '../.core-tests/accounts/etsy-steel-handoff-contracts.js';
import {beginEtsySteelHandoff,openEtsySteelOwnerHandoff,finishEtsySteelHandoff} from '../.core-tests/accounts/etsy-steel-handoff-runtime.js';
const NOW=Date.parse('2026-10-10T12:00:00Z'),id=n=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`,H=n=>n.toString(16).padStart(64,'0');
function scope(changes={}){const s={version:'etsy.steel-owner-handoff-scope.1',operationId:id(1),ownerId:id(2),businessId:id(3),goalId:id(4),authorityRootId:id(5),testEnvelopeId:id(10),testEnvelopeHash:H(10),providerProjectId:id(11),verificationOperationId:id(12),verificationMaximumMicrounits:'4000',verificationQuoteHash:H(12),accountId:id(6),accountRevision:id(7),expectedShopName:'Synthetic Owner Shop',expectedShopId:null,purpose:'etsy_insights_read_only',approvalId:id(8),approvalRevision:id(9),approvedAt:new Date(NOW-1000).toISOString(),approvalExpiresAt:new Date(NOW+900000).toISOString(),profileAccessExpiresAt:new Date(NOW+86400000).toISOString(),maximumSessionMs:60000,maximumBrowserMicrounits:'20000',currency:'USD',quoteHash:H(1),...changes};return{...s,disclosureHash:hash(buildEtsySteelHandoffDisclosure(s))};}
function fixture(changes={}){const s=scope(changes),owner={ownerId:s.ownerId,businessId:s.businessId},events=[],records=new Map(),receipts=[],candidates=[],consumed=new Set(),stop=new AbortController();let created=false;
 const session={providerKey:'steel',providerProjectId:s.providerProjectId,providerSessionId:s.operationId,profileId:id(91),debugUrl:`https://api.steel.dev/v1/sessions/${s.operationId}/player`,freshProfile:true,entryUrl:'https://www.etsy.com',async disconnectForOwner(){events.push('disconnect');return{version:'etsy.steel-owner-disconnect.1',sessionId:s.operationId,cdpDisconnected:true,observersDrained:true,inFlightCommandsSettled:true,appCaptureStopped:true,routeHandlersDrained:true,eventListenersRemoved:true};}};
 const d={vaultKey:'a'.repeat(64),signal:stop.signal,now:()=>NOW,monotonic:()=>0,registerCleanup(p){void p;},
 async admit(r){events.push('admit:'+r.operation);assert.equal(r.testEnvelopeHash,s.testEnvelopeHash);assert.equal(r.providerProjectId,s.providerProjectId);if(r.operation==='create'){if(created)throw Error('duplicate');created=true;}return{version:'etsy.steel-owner-handoff-permit.1',requestHash:hash(r),approval:'explicit_owner_persistent_access_and_budget',reservationId:id(70),reservationHash:H(70),reservedBrowserMicrounits:s.maximumBrowserMicrounits,expiresAt:new Date(NOW+10000).toISOString()};},
 async createSession(r){events.push('create');assert.equal(r.browserSessionId,s.operationId);return session;},
 async storeHandoff(r){events.push('store');assert.ok(events.includes('disconnect'));records.set(r.id,r);return{recordHash:r.recordHash,cleanupRegistered:true};},
 async loadHandoff(o,h){assert.deepEqual(o,owner);if(consumed.has(h))throw Error('consumed');return records.get(h);},
 async consumeHandoff(r,o,a){events.push('consume:'+a);assert.deepEqual(o,owner);if(consumed.has(r.id))throw Error('consumed');consumed.add(r.id);return{recordHash:r.recordHash,consumed:true};},
 async releaseSession(sid){events.push('release');return{sessionId:sid,released:true,terminalReadback:true};},
 async readProfile(pid){events.push('profile');return{id:pid,sourceSessionId:s.operationId,status:'READY'};},
 async saveProfileCandidate(c){candidates.push(c);return{candidateHash:c.candidateHash,bindingId:id(80),revision:id(81)};},
 async recordOutcome(r){receipts.push(r);},};return{s,owner,d,session,stop,events,records,receipts,candidates};}
test('bundled scope pins verification and disclosed recording risks',()=>{const s=scope();assert.deepEqual(validateEtsySteelHandoffScope(s),s);const d=buildEtsySteelHandoffDisclosure(s);assert.equal(d.recording,'provider_records_session');assert.equal(d.manualMfaMasking,'not_verified');assert.equal(d.verificationOperationId,s.verificationOperationId);assert.throws(()=>validateEtsySteelHandoffScope({...s,verificationMaximumMicrounits:'1'}));});
test('disconnect and encryption precede owner view; receipts contain no live URL',async()=>{const f=fixture(),r=await beginEtsySteelHandoff(f.s,f.d);assert.equal(r.status,'awaiting_owner');assert.doesNotMatch(JSON.stringify(r),/api.steel|account-v1|profileId|viewerUrl/);const stored=f.records.get(r.handoffId);assert.match(stored.envelope,/^account-v1\./);assert.doesNotMatch(stored.envelope,/api.steel/);const view=await openEtsySteelOwnerHandoff(f.owner,r.handoffId,f.d);assert.equal(view.viewerUrl,f.session.debugUrl);});
test('owner return consumes URL before release; READY remains unverified candidate',async()=>{const f=fixture(),start=await beginEtsySteelHandoff(f.s,f.d),r=await finishEtsySteelHandoff(f.owner,start.handoffId,'return',f.d);assert.equal(r.status,'profile_pending_verification');assert.ok(f.events.indexOf('consume:return')<f.events.indexOf('release'));assert.equal(f.candidates[0].accountIdentityVerified,false);assert.equal(f.candidates[0].testEnvelopeHash,f.s.testEnvelopeHash);await assert.rejects(openEtsySteelOwnerHandoff(f.owner,start.handoffId,f.d));});
test('owner Stop releases and preserves unsettled liability',async()=>{const f=fixture(),start=await beginEtsySteelHandoff(f.s,f.d);f.stop.abort();const r=await finishEtsySteelHandoff(f.owner,start.handoffId,'stop',f.d);assert.equal(r.status,'stopped');assert.equal(r.releaseState,'verified');assert.equal(r.liabilityState,'receipt_required');assert.equal(f.candidates.length,0);});
test('unconfirmed Stop consumption and release never claim stopped',async()=>{const f=fixture(),start=await beginEtsySteelHandoff(f.s,f.d);f.d.consumeHandoff=async()=>{throw Error('unknown');};f.d.releaseSession=async()=>({sessionId:f.s.operationId,released:false,terminalReadback:false});const r=await finishEtsySteelHandoff(f.owner,start.handoffId,'stop',f.d);assert.equal(r.status,'failed');assert.equal(r.releaseState,'unconfirmed');assert.equal(r.liabilityState,'unknown');});
for(const [name,mutate]of[['wrong project',f=>f.session.providerProjectId=id(99)],['wrong session',f=>f.session.providerSessionId=id(99)],['unsafe viewer',f=>f.session.debugUrl='https://untrusted.example'],['disconnect proof',f=>f.session.disconnectForOwner=async()=>({cdpDisconnected:false})]])test(name+' cannot publish handoff',async()=>{const f=fixture();mutate(f);const r=await beginEtsySteelHandoff(f.s,f.d);assert.equal(r.status,'failed');assert.equal(f.records.size,0);});
test('wrong owner cannot open a private live URL',async()=>{const f=fixture(),r=await beginEtsySteelHandoff(f.s,f.d);await assert.rejects(openEtsySteelOwnerHandoff({...f.owner,ownerId:id(90)},r.handoffId,f.d));});
test('duplicate create never dispatches again',async()=>{const f=fixture();await beginEtsySteelHandoff(f.s,f.d);const r=await beginEtsySteelHandoff(f.s,f.d);assert.equal(r.status,'failed');assert.equal(f.events.filter(e=>e==='create').length,1);});
test('missing durable cleanup storage cannot expose a viewer',async()=>{const f=fixture();f.d.storeHandoff=async r=>({recordHash:r.recordHash,cleanupRegistered:false});const r=await beginEtsySteelHandoff(f.s,f.d);assert.equal(r.status,'failed');assert.ok(f.events.includes('release'));});

/** Advance the injected wall and monotonic clocks together: these are latency
 * simulations of the real runtime, not provider calls or live readiness proof. */
function timedFixture(changes={}){
 const f=fixture(changes);let elapsed=0;f.d.now=()=>NOW+elapsed;f.d.monotonic=()=>elapsed;
 const admit=f.d.admit;f.d.admit=async r=>({...await admit(r),expiresAt:new Date(Math.min(NOW+elapsed+10000,Date.parse(f.s.approvalExpiresAt))).toISOString()});
 return{...f,advance(ms){elapsed+=ms;},elapsed:()=>elapsed};
}
test('begin allows combined admitted create and disconnect latency above 15s within its existing 60s port ceiling',async()=>{
 const f=timedFixture(),admit=f.d.admit,create=f.d.createSession,disconnect=f.session.disconnectForOwner,store=f.d.storeHandoff;let request;
 f.d.admit=async r=>{f.advance(1000);return admit(r);};
 f.d.createSession=async r=>{request=r;f.advance(20000);return create(r);};
 f.session.disconnectForOwner=async()=>{f.advance(5000);return disconnect();};
 f.d.storeHandoff=async(...args)=>{f.advance(2000);return store(...args);};
 const result=await beginEtsySteelHandoff(f.s,f.d);assert.equal(result.status,'awaiting_owner');assert.equal(f.elapsed(),29000);
 assert.equal(request.timeoutMs,f.s.maximumSessionMs);const record=f.records.get(result.handoffId);
 assert.equal(record.createdAt,new Date(NOW+1000).toISOString());assert.equal(record.expiresAt,new Date(NOW+1000+f.s.maximumSessionMs).toISOString());
 assert.equal(f.events.filter(e=>e==='create').length,1);assert.ok(f.events.indexOf('disconnect')<f.events.indexOf('store'));assert.equal(f.events.includes('release'),false);
 const duplicate=await beginEtsySteelHandoff(f.s,f.d);assert.equal(duplicate.status,'failed');assert.equal(f.events.filter(e=>e==='create').length,1);
});
for(const [label,changes,elapsed] of [
 ['whole begin 60s ceiling',{maximumSessionMs:900000},60000],
 ['shorter approved session lifetime',{maximumSessionMs:15000},15000],
 ['original approval expiry',{approvalExpiresAt:new Date(NOW+20000).toISOString()},20000],
])test(`${label} rejects late create, retains cleanup and never publishes a viewer`,async()=>{
 const f=timedFixture(changes),create=f.d.createSession;f.d.createSession=async r=>{const session=await create(r);f.advance(elapsed);return session;};
 const result=await beginEtsySteelHandoff(f.s,f.d);assert.equal(result.status,'failed');assert.equal(result.reason,'handoff_expired');
 assert.equal(result.releaseState,'verified');assert.equal(result.liabilityState,'receipt_required');assert.equal(f.records.size,0);assert.equal(f.candidates.length,0);
 assert.equal(f.events.filter(e=>e==='create').length,1);assert.equal(f.events.filter(e=>e==='release').length,1);assert.equal(f.events.includes('disconnect'),false);
});
test('Stop during pending create still releases the late exact session without another create',async()=>{
 const f=timedFixture(),create=f.d.createSession;let started;const pending=new Promise(resolve=>{started=resolve;});let resolveCreate;
 f.d.createSession=r=>{const session=create(r);started();return new Promise(resolve=>{resolveCreate=async()=>resolve(await session);});};
 const beginning=beginEtsySteelHandoff(f.s,f.d);await pending;f.stop.abort();setImmediate(()=>resolveCreate());
 const result=await beginning;assert.equal(result.status,'stopped');assert.equal(result.reason,'handoff_stopped');assert.equal(result.releaseState,'verified');
 assert.equal(result.liabilityState,'receipt_required');assert.equal(f.records.size,0);assert.equal(f.events.filter(e=>e==='create').length,1);assert.equal(f.events.filter(e=>e==='release').length,1);
});
test('failed late-create release keeps the original reservation and unknown liability',async()=>{
 const f=timedFixture({maximumSessionMs:900000}),create=f.d.createSession;f.d.createSession=async r=>{const session=await create(r);f.advance(60000);return session;};
 f.d.releaseSession=async()=>{f.events.push('release');return{sessionId:f.s.operationId,released:false,terminalReadback:false};};
 const result=await beginEtsySteelHandoff(f.s,f.d);assert.equal(result.reason,'handoff_expired');assert.equal(result.releaseState,'unconfirmed');assert.equal(result.liabilityState,'unknown');
 assert.equal(result.reservationId,id(70));assert.equal(result.reservationHash,H(70));assert.equal(f.records.size,0);assert.equal(f.receipts.at(-1).receiptHash,result.receiptHash);
});
for(const operation of ['view','return'])test(`owner ${operation} retains its 15s stage fence`,async()=>{
 const f=timedFixture(),started=await beginEtsySteelHandoff(f.s,f.d),admit=f.d.admit;
 f.d.admit=async r=>{const result=await admit(r);if(r.operation===`owner_${operation}`)f.advance(15000);return result;};
 if(operation==='view')await assert.rejects(openEtsySteelOwnerHandoff(f.owner,started.handoffId,f.d),/handoff_expired/);
 else{const result=await finishEtsySteelHandoff(f.owner,started.handoffId,'return',f.d);assert.equal(result.status,'failed');assert.equal(result.reason,'handoff_expired');assert.ok(f.events.includes('release'));}
 assert.equal(f.candidates.length,0);assert.equal(f.events.filter(e=>e==='create').length,1);
});
