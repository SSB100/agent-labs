import test from 'node:test';
import assert from 'node:assert/strict';
import {ETSY_INSIGHTS_DEFAULT_RENDERER_POLICY as base,validateEtsyInsightsRendererPolicy as validate,classifyEtsyInsightsRendererRequest as classify,admitEtsyInsightsRendererRequest as admit,etsyInsightsRendererPolicyHash as hash} from '../.core-tests/browser/etsy-insights-renderer-policy.js';
import {ETSY_RENDERER_DOM_REFERENCE_MANIFEST as refs,ETSY_RENDERER_DOM_REFERENCE_HASH as provenanceHash} from '../.core-tests/browser/etsy-insights-renderer-evidence.js';
import {ETSY_OWNER_BOOTSTRAP_POLICY as bootstrap} from '../.core-tests/accounts/etsy-steel-owner-bootstrap.js';
const policy=()=>({...base,version:'etsy.insights-renderer-policy.2',staticAssets:[{...refs.images[0]}],optionalTelemetry:[{...refs.optionalTelemetry[0]}],provenanceHash});
const request=(row,changes={})=>({url:row.origin+row.path,method:row.method,resourceType:row.resourceType,navigation:false,...changes});
test('observed .2 policy has explicit DOM-only provenance and exact image GET permission',()=>{
 const p=policy();assert.equal(refs.networkTrace,false);assert.equal(refs.observation,'read_only_dom_src_attributes');
 assert.equal(classify(p,request(refs.images[0]),null),'allow');assert.match(hash(p),/^[0-9a-f]{64}$/);
 for(const change of [{method:'POST'},{resourceType:'script'},{resourceType:'xhr'},{navigation:true},{url:refs.images[0].origin+refs.images[0].path+'?q=other'},{url:refs.images[0].origin+refs.images[0].path+'/other'}])assert.throws(()=>classify(p,request(refs.images[0],change),null));
});
test('optional telemetry is a narrow deny classification and never a continue permission',()=>{
 const p=policy(),r=request(refs.optionalTelemetry[0],{url:refs.optionalTelemetry[0].origin+refs.optionalTelemetry[0].path+'?tracking=redacted'});
 assert.equal(classify(p,r,'pottery gift'),'deny_optional_telemetry');assert.throws(()=>admit(p,r,'pottery gift'));
 for(const change of [{method:'POST'},{resourceType:'fetch'},{resourceType:'xhr'},{resourceType:'document',navigation:true},{url:r.url.replace('/static/','/unknown/')},{url:'https://transcend-cdn.com/cm/unknown/airgap.js'}])assert.throws(()=>classify(p,{...r,...change},'pottery gift'));
});
test('optional telemetry cannot exempt account, data or unapproved query requests',()=>{
 const p=policy();for(const url of ['https://www.etsy.com/your/orders','https://www.etsy.com/your/shops/me/marketplace-insights/search?query=other','https://www.etsy.com/api/marketplace-insights?query=other']){
  assert.throws(()=>classify(p,{url,method:'GET',resourceType:'xhr',navigation:false},'pottery gift'));
 }
});
test('invented paths, origins, evidence, wildcard rows or origin-only widening are rejected',()=>{
 const p=policy();for(const changed of [
  {...p,provenanceHash:'a'.repeat(64)}, {...p,staticOrigins:['https://i.etsystatic.com']},
  {...p,staticAssets:[{...p.staticAssets[0],path:'/*'}]}, {...p,optionalTelemetry:[{...p.optionalTelemetry[0],path:'/other.js'}]},
  {...p,optionalTelemetry:[{...p.optionalTelemetry[0],origin:'https://arbitrary.example'}]},
  {...p,optionalTelemetry:[{...p.optionalTelemetry[0],resourceType:'xhr'}]},
  {...p,optionalTelemetry:[...p.optionalTelemetry,...p.optionalTelemetry]},
 ])assert.throws(()=>validate(changed));
});
test('empty .2 lists deny unselected observed references; parent observation grants no automatic access',()=>{
 const p={...policy(),staticAssets:[],optionalTelemetry:[]};assert.doesNotThrow(()=>validate(p));
 assert.throws(()=>classify(p,request(refs.images[0]),null));assert.throws(()=>classify(p,request(refs.optionalTelemetry[0]),null));
});
test('owner-only asset-independent bootstrap never qualifies an Insights renderer',()=>{
 assert.throws(()=>validate(bootstrap));
 assert.throws(()=>classify(bootstrap,{url:'https://unreviewed.example/data',method:'POST',resourceType:'xhr',navigation:false},'pottery gift'));
});
