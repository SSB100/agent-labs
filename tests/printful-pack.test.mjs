import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {printfulPackManifest}=require('../.core-tests/printful/packs.js');
const {validatePackManifest}=require('../.core-tests/packs/registry.js');
const {resolvePackDependencies}=require('../.core-tests/packs/dependencies.js');
test('Printful is a pinned experimental capability with no installed executor or qualification bypass',()=>{
 const manifest=printfulPackManifest();validatePackManifest(manifest);assert.equal(manifest.capabilities[0].adapter,'printful.foundation');assert.deepEqual(manifest.workers,[]);assert.deepEqual(manifest.workflows,[]);assert.ok(manifest.evals.includes('live-qualification'));
 const release={id:'11111111-1111-4111-8111-111111111111',status:'experimental',manifest},root={packKey:manifest.packKey,version:manifest.version};
 assert.throws(()=>resolvePackDependencies([release],root),/not qualified/);assert.equal(resolvePackDependencies([release],root,true).length,1);
});
