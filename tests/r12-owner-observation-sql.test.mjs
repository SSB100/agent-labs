/** Owner-reported evidence is immutable and only a selected, reviewed bundle
 * enters a fresh adaptive packet. No provider transport occurs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './helpers/r10-sql-fixture.mjs';
import {prepareFourPlanAdaptiveFixture} from './helpers/r12-adaptive-activation-fixture.mjs';
import {discoveryV2Hash} from '../.core-tests/products/discovery-v2.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const host=process.env.R12_SQL_TEST_HOST;
test('attributed owner capture is immutable, private and pinned through adaptive preflight',
 {skip:!host,timeout:120000},async()=>{
 const req=createRequire(path.resolve(host,'package.json'));
 const {PGlite}=req('@electric-sql/pglite'),{pgcrypto}=req('@electric-sql/pglite/contrib/pgcrypto');
 const db=new PGlite({extensions:{pgcrypto}});
 try{
  await db.exec(r04SqlBootstrap+sessionBootstrap);
  for(const file of readdirSync(path.join(root,'supabase/migrations')).filter(x=>x.endsWith('.sql')).sort())
   await db.exec(readFileSync(path.join(root,'supabase/migrations',file),'utf8'));
  const x=await prepareFourPlanAdaptiveFixture(db);
  const stamp=new Date(Date.now()-60_000).toISOString(),windowStart=new Date(Date.now()-86_400_000).toISOString();
  const content='Searches 1.1k';
  const o={id:randomUUID(),sourceId:'owner-insights-capture-1',provenance:'owner_reported_capture',
   source:{url:'https://market.example/owner/insights',interface:'Owner keyword dashboard',capturedAt:stamp,captureHash:'a'.repeat(64)},
   context:{productFormat:'Printed adult T-shirt',category:'Adult apparel',query:'astronomy shirt',windowStart,windowEnd:stamp,
    locale:'en-NZ',geography:{kind:'unknown',countries:[],basis:'No buyer-country segmentation displayed.'}},
   content,contentHash:discoveryV2Hash(content),metrics:[{id:'searches',label:'Searches',displayed:'1.1k',
    start:0,end:content.length,kind:'count',unit:'searches',value:1100,precision:'rounded'}],
   limitations:['Rounded aggregate; no item sales or causal demand conclusion.'],dataClass:'aggregate_nonpersonal'};
  const body={version:'r12.owner-observations.1',id:randomUUID(),businessId:x.f.businessId,ownerId:x.f.ownerId,
   createdAt:stamp,observations:[o],baseline:null,privacyAttestation:'reviewed_aggregate_only_no_credentials_or_customer_data'};
  const bundle={...body,bundleHash:discoveryV2Hash(body)};
  const save=()=>x.f.rpc('r12_owner_observation_server',[x.f.businessId,'save',{bundle},x.key]);
  assert.deepEqual((await save()).bundle,bundle);
  assert.deepEqual((await save()).bundle,bundle,'exact replay returns the immutable capture');
  const read=await x.f.rpc('r12_owner_observation_server',[x.f.businessId,'read',{bundleId:bundle.id},null]);
  assert.deepEqual(read.bundle,bundle);
  await assert.rejects(x.f.rpc('r12_owner_observation_server',[x.f.businessId,'save',
   {bundle:{...bundle,bundleHash:'b'.repeat(64)}},x.key]),/r12_owner_observation_unverified/);
  const manifest=[{bundleId:bundle.id,bundleHash:bundle.bundleHash,selectedObservationIds:[o.id]}];
  const ref={manifestHash:discoveryV2Hash(manifest),manifest};
  const selected=await x.prepare({ownerObservationRef:ref});
  assert.deepEqual(selected.prepared.ownerObservationRef,ref);
  assert.deepEqual(selected.prepared.preview.ownerObservationRef,ref);
  assert.deepEqual(selected.packet.ownerObservationContext.manifest,manifest);
  assert.equal(selected.packet.ownerObservationContext.bundles[0].bundleHash,bundle.bundleHash);
  assert.equal(selected.packet.intentPins.ownerObservationRef.manifestHash,ref.manifestHash);
  assert.equal(selected.preflight.inputHash,selected.packet.inputHash);
  await assert.rejects(x.prepare({ownerObservationRef:{...ref,manifestHash:'c'.repeat(64)}}),
   /r12_owner_observation_manifest_invalid/);
 }finally{await db.close();}
});
