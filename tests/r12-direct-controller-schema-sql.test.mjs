import test from 'node:test';import assert from 'node:assert/strict';
import {directControllerDatabase} from './helpers/r12-direct-controller-database.mjs';
import {one} from './helpers/r12-owner-initial-sql-fixture.mjs';
import {ETSY_INSIGHTS_SOURCE_POLICY_HASH,ETSY_INSIGHTS_CAPTURE_POLICY_HASH} from '../.core-tests/browser/etsy-insights-policy.js';
import {publicResearchModelSchema,publicResearchModelSystemInstruction} from '../.core-tests/products/discovery-r12-public-model.js';
import {projectProviderJsonSchema} from '../.core-tests/models/openrouter.js';
import {discoveryV2Hash as hash} from '../.core-tests/products/discovery-v2-hash.js';
import {publicResearchQuestionHash} from '../.core-tests/products/discovery-r12-public-contracts.js';
import {PUBLIC_RESEARCH_QUALITY_ANCHORS,PUBLIC_RESEARCH_QUALITY_WEIGHTS} from '../.core-tests/products/discovery-r12-public-quality.js';
test('direct controller migration defines isolated gates and exact static model/source policies',{skip:!process.env.R12_SQL_TEST_HOST&&!process.env.R12_REQUIRE_POSTGRES&&!process.env.R12_POSTGRES_URL,timeout:120000},async()=>{
 const db=await directControllerDatabase();try{
  const policies=(await one(db,'select private.r12_direct_source_policies() p')).p;
  assert.equal(policies.sourcePolicyHash,ETSY_INSIGHTS_SOURCE_POLICY_HASH);assert.equal(policies.capturePolicyHash,ETSY_INSIGHTS_CAPTURE_POLICY_HASH);
  for(const phase of ['plan','strategy','review']){
   const static_=(await one(db,'select private.r12_direct_model_static($1) p',[phase])).p;
   assert.deepEqual(static_.outputSchema,publicResearchModelSchema(phase));assert.equal(static_.systemInstruction,publicResearchModelSystemInstruction(phase));
   assert.equal(static_.outputSchemaHash,hash(static_.outputSchema));assert.equal(static_.systemInstructionHash,hash(static_.systemInstruction));
   assert.deepEqual((await one(db,'select private.r12_direct_provider_schema($1) p',[static_.outputSchema])).p,projectProviderJsonSchema(static_.outputSchema));
  }
  assert.deepEqual((await one(db,'select private.r12_direct_quality_rubric() p')).p,{weights:PUBLIC_RESEARCH_QUALITY_WEIGHTS,anchors:PUBLIC_RESEARCH_QUALITY_ANCHORS,minimumBasisPoints:8000});
  const command={kind:'targeted',criteriaHash:'a'.repeat(64),questionHash:publicResearchQuestionHash('Which wording is visible?'),query:'astronomy gifts',namedGap:'Which wording is visible?',expectedInformationGain:'A literal display comparison.',opposingCheck:'Check missing denominators.',changedCriterion:null};
  await db.query('select private.r12_direct_command_check($1)',[command]);for(const k of ['kind','criteriaHash','questionHash','query','namedGap','expectedInformationGain','opposingCheck'])await assert.rejects(db.query('select private.r12_direct_command_check($1)',[{...command,[k]:null}]),/invalid_command/);
  await assert.rejects(db.query('select private.r12_direct_command_check($1,true)',[{kind:'finish',rationale:null}]),/invalid_command/);
  const renderer={version:'etsy.insights-renderer-policy.1',staticOrigins:[],maximumRequests:256,navigation:'fixed_insights_get_only',sameOrigin:'renderer_get_only',post:'denied',extraction:'visible_aggregate_dom_only'};
  for(const request of [{method:'GET',navigation:false,resourceType:'image'},{method:'GET',navigation:false,resourceType:'image',url:null},{method:'GET',navigation:false,url:'https://www.etsy.com/assets/a.png'},{method:'GET',navigation:false,resourceType:null,url:'https://www.etsy.com/assets/a.png'}])await assert.rejects(db.query('select private.r12_direct_renderer_check($1,$2,$3)',[renderer,request,'inert query']),/renderer_request_denied/);
  assert.deepEqual(await one(db,"select has_function_privilege('anon','private.r12_direct_dispatch(uuid,jsonb)','EXECUTE') helper,has_table_privilege('service_role','private.r12_direct_research_activations','INSERT') activation,has_table_privilege('authenticated','private.r12_direct_source_pngs','SELECT') png"),{helper:false,activation:false,png:false});
 }finally{await db.close();}
});
