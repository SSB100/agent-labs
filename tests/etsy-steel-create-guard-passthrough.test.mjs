/** Mechanical forwarding checks with explicit inert admission only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {fixture,verificationFixture} from './helpers/etsy-insights-playwright-fixture.mjs';
import * as contracts from '../.core-tests/accounts/etsy-steel-handoff-contracts.js';
import {inertSteelCreateConfigurationGuard} from './helpers/etsy-steel-create-config-fixture.mjs';
import * as deadlines from '../.core-tests/core/request-deadline.js';

for(const verification of [false,true]){
 test(`${verification?'verification':'research'} port forwards scoped create guard before provider IO`,async()=>{
  const seen=[],guard=inertSteelCreateConfigurationGuard(),admit=guard.admit;
  guard.admit=async(request,signal)=>{seen.push(request);return admit(request,signal);};
  const f=(verification?verificationFixture:fixture)({createConfigurationGuard:guard});
  if(verification){const result=await f.verifier.verify(f.authority,f.stop.signal);assert.equal(result.status,'verified');}
  else{const session=await f.port.createSession(f.s,f.stop.signal);await session.close(session.sessionId);}
  assert.equal(seen.length,1);assert.equal(seen[0].scopeHash,guard.scopeHash);assert.equal(seen[0].deploymentId,guard.deployment.deploymentId);assert.equal(seen[0].operationId,f.s.operationId);assert.equal(seen[0].providerProjectId,f.s.providerProjectId);assert.ok(Object.isFrozen(seen[0]));await Promise.all(f.cleanup);
 });
 for(const mode of ['missing','denied'])test(`${verification?'verification':'research'} port blocks ${mode} configuration before create and marker`,async()=>{
  const f=(verification?verificationFixture:fixture)({createConfigurationGuard:mode==='missing'?undefined:inertSteelCreateConfigurationGuard({admit:async()=>{throw Error('inert rejected binding');}})});
  if(verification){const result=await f.verifier.verify(f.authority,f.stop.signal);assert.equal(result.status,'paused');assert.equal(result.verification,null);}
  else await assert.rejects(f.port.createSession(f.s,f.stop.signal));
  assert.equal(f.events.includes('create'),false);assert.equal(f.events.includes('marker'),false);assert.equal(f.events.includes('connect'),false);await Promise.all(f.cleanup);
 });
}

test('handoff RPC composition passes the same guard object into the actual port boundary',()=>{
 const guard=inertSteelCreateConfigurationGuard(),id=n=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`,H=n=>n.toString(16).padStart(64,'0'),now=Date.now();
 const body={version:contracts.ETSY_STEEL_HANDOFF_VERSION,operationId:id(1),ownerId:id(2),businessId:id(3),goalId:id(4),authorityRootId:id(5),testEnvelopeId:id(10),testEnvelopeHash:H(10),providerProjectId:id(11),verificationOperationId:id(12),verificationMaximumMicrounits:'10000',verificationQuoteHash:H(12),accountId:id(6),accountRevision:id(7),expectedShopName:'Synthetic Owner Shop',expectedShopId:null,purpose:'etsy_insights_read_only',approvalId:id(8),approvalRevision:id(9),approvedAt:new Date(now-1000).toISOString(),approvalExpiresAt:new Date(now+900000).toISOString(),profileAccessExpiresAt:new Date(now+86400000).toISOString(),maximumSessionMs:60000,maximumBrowserMicrounits:'20000',currency:'USD',quoteHash:H(1)};
 const s={...body,disclosureHash:contracts.etsySteelHash(contracts.buildEtsySteelHandoffDisclosure(body))},loaded={exports:{}};let forwarded;
 const deps={'../core/request-deadline':deadlines,'./etsy-steel-handoff-contracts':contracts,'./etsy-steel-handoff-port':{createEtsySteelHandoffPort(input){forwarded=input;return{};}}};
 const source=readFileSync(new URL('../src/accounts/etsy-steel-handoff-rpc.ts',import.meta.url),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','module','exports',code)(name=>{assert.ok(Object.hasOwn(deps,name));return deps[name];},loaded,loaded.exports);
 loaded.exports.createEtsySteelHandoffRpcDependencies({scope:s,vaultKey:'a'.repeat(64),signal:new AbortController().signal,rpc:async()=>{throw Error('No RPC invoked');},registerCleanup:()=>{},createConfigurationGuard:guard});
 assert.equal(forwarded.createConfigurationGuard,guard);assert.equal(forwarded.providerProjectId,s.providerProjectId);
});
