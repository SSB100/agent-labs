import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { ownerGoalFixture, ownerGoalId } from './helpers/r12-owner-goal-fixture.mjs';
import { discoveryKnowledgeFixture } from './discovery-v2-fixtures.mjs';

const require=createRequire(import.meta.url),ts=require('typescript');
const core=name=>require('../.core-tests/'+name+'.js');
function load(dependencies){
  const fixtureModule={exports:{}};
  const source=ts.transpileModule(readFileSync('src/products/discovery-r12-goal-preparation-server.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  new Function('require','module','exports',source)(name=>{assert.ok(name in dependencies,'Unexpected dependency '+name);return dependencies[name];},fixtureModule,fixtureModule.exports);
  return fixtureModule.exports;
}
function fixture(){
  const f=ownerGoalFixture(),calls=[];
  const receipt={businessId:f.input.businessId,goalId:f.input.goalId,setupId:f.scope.setupId,scopeId:f.scope.id,grantId:f.input.grantId,
    submissionId:f.input.submissionId,policyId:ownerGoalId(20),setupHash:f.scope.setupHash,policyHash:'a'.repeat(64),confirmed:false,activated:false,stopped:false,preview:f.preview};
  const packet={version:'r12.owner-planner-preflight-input.1',setupId:receipt.setupId,setupHash:receipt.setupHash,scopeId:receipt.scopeId,
    cutoff:f.scope.expiresAt,intent:f.scope.intent,knowledgeSnapshot:discoveryKnowledgeFixture(f.now).snapshot,inputHash:'b'.repeat(64)};
  const state={receipt,packet,failPreflight:false};
  const context={userId:ownerGoalId(99),businesses:[{id:f.input.businessId}],supabase:{auth:{getClaims:async()=>({data:{claims:{sub:ownerGoalId(99)}}})},rpc:async(name,args)=>{
    calls.push(name);
    if(name==='r12_owner_research_read')return{data:{setups:[state.receipt]}};
    if(name==='r12_owner_research_preflight')return{data:state.packet};
    assert.equal(name,'r12_owner_research_server');
    assert.equal(args.p_payload.preflight.inputHash,packet.inputHash);
    assert.ok(args.p_payload.preflight.requestBytes<=12288);
    state.receipt={...state.receipt,confirmed:true,activated:true};return{data:state.receipt};
  }}};
  const real=core('products/discovery-r12-planner-preflight');
  const server=load({
    'server-only':{},'node:crypto':require('node:crypto'),'../lib/core-ui/owner-business':{verifyOwnerBusiness:async()=>true},
    '../core/request-deadline':core('core/request-deadline'),'../core/quest-intake':core('core/quest-intake'),
    './discovery-v2':core('products/discovery-v2'),'./discovery-r12-goal-scope':core('products/discovery-r12-goal-scope'),
    './discovery-r12-owner-episode':core('products/discovery-r12-owner-episode'),
    './discovery-r12-goal-preparation-contract':core('products/discovery-r12-goal-preparation-contract'),
    './discovery-r12-server-dependencies':{discoveryR12ServerDependencies:()=>({quote:async()=>{calls.push('quote');return f.current.quote;}})},
    './discovery-r12-server':{prepareDiscoveryR12Authority:async()=>{calls.push('derive');return{controllerKeyHash:'c'.repeat(64),admissionKeyHash:'d'.repeat(64)};}},
    './discovery-r12-planner-preflight':{preflightDiscoveryR12OwnerPlanner:async(...args)=>{calls.push('inspect');if(state.failPreflight)throw Error('wire exceeds bound');return real.preflightDiscoveryR12OwnerPlanner(...args);}},
  });
  return{...f,state,calls,context,server,input:{businessId:receipt.businessId,setupId:receipt.setupId,setupHash:receipt.setupHash,submissionId:ownerGoalId(21)}};
}
test('owner confirmation inspects concrete planner before deriving or activating authority',async()=>{
  const oldEnv=process.env.VERCEL_ENV,oldKey=process.env.R05_ADMISSION_SERVER_KEY;
  process.env.VERCEL_ENV='production';process.env.R05_ADMISSION_SERVER_KEY='inert-confirmation-test-root-not-provider-credential';
  try{
    const f=fixture();assert.equal((await f.server.confirmOwnerResearch(f.context,f.input)).activated,true);
    assert.deepEqual(f.calls,['r12_owner_research_read','quote','r12_owner_research_preflight','inspect','derive','r12_owner_research_server']);
    f.calls.length=0;await f.server.confirmOwnerResearch(f.context,f.input);assert.deepEqual(f.calls,['r12_owner_research_read']);
    for(const corruption of ['reject','identity','intent']){
      const blocked=fixture();
      if(corruption==='reject')blocked.state.failPreflight=true;
      if(corruption==='identity')blocked.state.packet.scopeId=ownerGoalId(888);
      if(corruption==='intent')blocked.state.packet.intent={...blocked.state.packet.intent,objective:'An unreviewed replacement objective for another research request.'};
      await assert.rejects(blocked.server.confirmOwnerResearch(blocked.context,blocked.input),/r12_owner_planner_preflight/);
      assert.equal(blocked.calls.includes('derive'),false);assert.equal(blocked.calls.includes('r12_owner_research_server'),false);
      assert.equal(blocked.state.receipt.activated,false);
    }
  }finally{
    if(oldEnv===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=oldEnv;
    if(oldKey===undefined)delete process.env.R05_ADMISSION_SERVER_KEY;else process.env.R05_ADMISSION_SERVER_KEY=oldKey;
  }
});
