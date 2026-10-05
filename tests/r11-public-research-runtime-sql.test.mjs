import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './helpers/r10-sql-fixture.mjs';
import {RESEARCH_CAPABILITY,setupResearchFixture,seedResearch,enrollResearch,research,financial,value,hash} from './helpers/r11-public-research-fixture.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),host=process.env.R11_SQL_TEST_HOST;
test('R11 actual TypeScript runner, adapter wire and SQL source/financial guard agree end to end',{skip:!host,timeout:120000},async()=>{
 const require=createRequire(import.meta.url),sqlRequire=createRequire(path.resolve(host,'package.json'));
 const {PGlite}=sqlRequire('@electric-sql/pglite'),{pgcrypto}=sqlRequire('@electric-sql/pglite/contrib/pgcrypto');
 const q=require('../.core-tests/research/qualification.js'),rt=require('../.core-tests/research/qualification-runtime.js');
 const {OpenRouterAdapter}=require('../.core-tests/models/openrouter.js'),{resolveModelRoute}=require('../.core-tests/models/registry.js');
 const db=new PGlite({extensions:{pgcrypto}});
 try{
  await db.exec(r04SqlBootstrap+sessionBootstrap);
  for(const name of readdirSync(path.join(root,'supabase/migrations')).filter(n=>n.endsWith('.sql')).sort())await db.exec(readFileSync(path.join(root,'supabase/migrations',name),'utf8'));
  const model=structuredClone(resolveModelRoute('standard.default').primary);
  await setupResearchFixture(db,{modelId:model.providerModelId});const s=await seedResearch(db,{enroll:false,policyOverrides:{modelId:model.providerModelId}});
  s.search=await rt.inspectPublicResearchWire(q.publicResearchSearchRequest(s.policy,model),'search');await enrollResearch(db,s);
  const sent=[],rpcCalls=[],excerpt='Adult gardeners often value practical tools and containers suited to the available growing space.';
  const runtime={model,verifyQuote:async()=>({providerName:'Azure'}),
   rpc:async(operation,payload)=>{rpcCalls.push(operation);return research(db,s,operation,payload);},
   settle:async(requestId,receipt)=>{const result=await financial(db,s,'settle',{requestId,currency:'USD',actualMicrounits:receipt.reportedMicrousd===null?null:String(receipt.reportedMicrousd),providerRequestId:receipt.providerRequestId,receiptHash:hash(receipt)});assert.equal(result.decision,'allowed');},
   provider:admit=>new OpenRouterAdapter({config:{apiKey:'inert-r11-wire',baseUrl:'https://openrouter.ai/api/v1',appUrl:'https://example.invalid',appName:'R11 inert SQL test'},admitDispatch:admit,fetcher:async(url,init)=>{
    const body=JSON.parse(init.body),search=!!body.tools;sent.push({url,body});
    return new Response(JSON.stringify({id:search?'inert-search-receipt':'inert-selector-receipt',provider:'Azure',model:s.policy.modelId,
     choices:[{finish_reason:'stop',message:search?{content:'One factual source',annotations:[{type:'url_citation',url_citation:{url:'https://gardening.example/report',title:'Public report',content:excerpt}}]}:{content:JSON.stringify({selections:[{sourceKey:'S1',quote:excerpt}],limitations:['limited_sources']})}}],
     usage:{prompt_tokens:10,completion_tokens:10,cost:0.00002,...(search?{server_tool_use:{web_search_requests:1}}:{})}}),{status:200});
   }})};
  const scope={businessId:s.businessId,coreWorkflowRunId:s.workflowRunId,runtimeCapability:RESEARCH_CAPABILITY};
  const result=await rt.runPublicResearchQualification(scope,s.policy.id,runtime);
  assert.equal(result.receipts.length,2);assert.equal(sent.length,2);assert.deepEqual(rpcCalls,['load','guard','collect','guard']);
  assert.equal(await value(db,'select count(*)::int result from private.r05_markers where business_id=$1',[s.businessId]),2);
  assert.equal(await value(db,'select count(*)::int result from private.r05_settlements where business_id=$1',[s.businessId]),2);
  assert.equal(await value(db,'select coalesce(sum(held),0)::text result from private.r05_exposure($1)',[s.businessId]),'40');
  const retained=await value(db,'select collection result from private.r11_research_collections where id=$1',[result.collectionId]);
  assert.equal(result.evidencePack.sourceLineage.collectionHash,q.publicResearchHash(retained));
  const payloads=await value(db,'select jsonb_agg(payload) result from private.r05_requests where business_id=$1',[s.businessId]);assert.equal(JSON.stringify(payloads).includes(RESEARCH_CAPABILITY),false);
  await assert.rejects(rt.runPublicResearchQualification(scope,s.policy.id,runtime));assert.equal(sent.length,2);
 }finally{await db.close();}
});
