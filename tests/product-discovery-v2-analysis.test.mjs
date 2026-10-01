import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
const {discoveryV2PackManifests,discoveryV2AnalysisPackManifest}=require('../.core-tests/products/discovery-v2-packs.js');
const {discoveryPlanModelSchemaV2}=require('../.core-tests/products/discovery-v2-plan.js');
const {validatePackManifest}=require('../.core-tests/packs/registry.js');
const migration=readFileSync('supabase/migrations/20261001093430_stage13_v2_evidence_analysis_continuation.sql','utf8');
test('analysis workflow is a separate immutable experimental release with no tool-capable stages',()=>{
 const before=discoveryV2PackManifests(),pack=discoveryV2AnalysisPackManifest();validatePackManifest(pack);
 assert.equal(pack.packKey,'workflow.product-discovery-v2-analysis');assert.equal(pack.version,'1.0.0');
 assert.deepEqual(pack.workflows.map(w=>w.key),['product.discovery-v2.analysis']);
 assert.deepEqual(pack.workflows[0].stages.map(s=>s.key),['strategy','review']);
 assert.ok(pack.workflows[0].stages.every(s=>s.permittedCapabilities.length===0));assert.equal(pack.workflows[0].stages[0].inputFrom,'workflow');
 assert.deepEqual(discoveryV2PackManifests(),before);
 const literal=migration.match(/select private\.stage10_register_pack\('((?:''|[^'])*)'::jsonb\);/)[1].replaceAll("''","'");
 assert.deepEqual(JSON.parse(literal),pack,'Registered immutable manifest exactly matches runtime source');
});
test('zero-collection round cannot normalize a fresh paid plan',()=>{
 assert.throws(()=>discoveryPlanModelSchemaV2({limits:{maximumNewCollections:0}}),/cannot plan new collections/);
});
test('migration preserves existing endpoint ACLs and fails closed on installed-function drift',()=>{
 assert.match(migration,/expected_count/);assert.match(migration,/Evidence-reuse migration refused unexpected function drift/);
 assert.doesNotMatch(migration,/grant\s+execute/i);assert.match(migration,/revoke all on function private\.stage13v2_analysis_source/);
 assert.match(migration,/all packs, with no overlapping active round/);assert.match(migration,/complete exact shortlist and every Evidence Pack/);
 assert.match(migration,/Plan reuse requires its completed task, worker and known original model charge/);
});
