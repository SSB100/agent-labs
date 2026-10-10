/** Inert direct-owner RPC parity; no grant, scope or provider is enrolled. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './helpers/r10-sql-fixture.mjs';
import {etsyObservationFixture} from './helpers/r12-etsy-activation-fixture.mjs';
import {ownerInitialRpc,one} from './helpers/r12-owner-initial-sql-fixture.mjs';
import {discoveryV2Hash as hash} from '../.core-tests/products/discovery-v2.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),host=process.env.R12_SQL_TEST_HOST;
function rehash(bundle){for(const o of bundle.observations)o.contentHash=hash(o.content);const {bundleHash:_,...body}=bundle;void _;bundle.bundleHash=hash(body);return bundle;}
function metricBundle(original,kind){const b=structuredClone(original);b.id=randomUUID();for(const [i,o] of b.observations.entries()){
 const displayed=kind==='money_range'?'NZ$22–NZ$27':kind==='count'?'100':'Very low';o.content=o.context.query+': '+displayed+'.';
 o.metrics=[{id:'measure-'+i,label:'Observed measure',displayed,start:0,end:o.content.length,kind,
  ...(kind==='money_range'?{currency:'NZD',lower:22,upper:27,basis:'Displayed item prices; shipping and taxes not included.'}:kind==='count'?{unit:'views',value:100,precision:'exact'}:{scale:['Very low','Low','High'],value:'Very low',definition:'The same source relative conversion bands.'})}];
 }return rehash(b);}
test('owner capture save/list/read enforces immutable typed baseline and currency contracts without a paid grant',{skip:!host,timeout:120000},async()=>{
 const req=createRequire(path.resolve(host,'package.json')),{PGlite}=req('@electric-sql/pglite'),{pgcrypto}=req('@electric-sql/pglite/contrib/pgcrypto');const db=new PGlite({extensions:{pgcrypto}});
 try{
  await db.exec(r04SqlBootstrap+sessionBootstrap);for(const file of readdirSync(path.join(root,'supabase/migrations')).filter(x=>x.endsWith('.sql')).sort())await db.exec(readFileSync(path.join(root,'supabase/migrations',file),'utf8'));
  const owner=randomUUID(),business=randomUUID(),other=randomUUID();await db.query('insert into auth.users(id,email) values($1,$2),($3,$4)',[owner,owner+'@example.invalid',other,other+'@example.invalid']);
  await db.query('insert into public.businesses(id,owner_user_id,name) values($1,$2,$3)',[business,owner,'Inert owner capture intake']);
  const rpc=(operation,payload,actor=owner)=>ownerInitialRpc(db,actor,'r12_owner_observation_server',[business,operation,payload,'']);
  const {bundle}=etsyObservationFixture(business,owner);
  assert.deepEqual((await rpc('save',{bundle})).bundle,bundle);assert.deepEqual((await rpc('save',{bundle})).bundle,bundle);
  assert.deepEqual((await rpc('list',{})).bundles,[bundle]);assert.deepEqual((await rpc('read',{bundleId:bundle.id})).bundle,bundle);
  for(const operation of ['save','read','list'])await assert.rejects(rpc(operation,operation==='save'?{bundle}:operation==='read'?{bundleId:bundle.id}:{},other));
  const bad=async(change,original=bundle)=>{const b=structuredClone(original);b.id=randomUUID();change(b);rehash(b);await assert.rejects(rpc('save',{bundle:b}));};
  for(const change of [b=>b.baseline.candidateObservationIds[1]=b.baseline.candidateObservationIds[0],b=>b.baseline.positiveCriterion='',b=>b.baseline.hypothesis=null,
   b=>b.observations[1].context.windowStart=new Date(Date.parse(b.baseline.windowStart)-1000).toISOString(),b=>b.observations[1].context.locale='en-US',
   b=>b.observations[1].context.query='  '+b.observations[0].context.query.toUpperCase()+' ',
   b=>{b.baseline.timing='prospective';b.baseline.declaredAt=new Date(Date.parse(b.createdAt)+1).toISOString();b.createdAt=b.baseline.declaredAt;},
   b=>b.observations[0].content=null,b=>b.observations[0].source.interface=null,b=>b.observations[0].context.windowStart='2026-02-31T00:00:00.000Z',
   b=>b.observations[0].source.capturedAt='2026-01-01T00:00:60.000Z',b=>b.observations[0].id=b.id,
   b=>b.observations[1].sourceId=b.observations[0].sourceId,b=>b.observations[0].metrics[0].start='0',
   b=>b.observations[0].metrics[0].end=1.5,b=>b.observations[0].metrics[0].label=null,
   b=>b.observations[0].metrics[0].scale=['1','2'],b=>b.observations[0].metrics[0].scale=['Very low','Very low']])await bad(change);
  const counts=metricBundle(bundle,'count');await rpc('save',{bundle:counts});
  for(const change of [b=>b.observations[0].metrics[0].value=null,b=>b.observations[0].metrics[0].value='100',b=>b.observations[0].metrics[0].value=9007199254740992,
   b=>{const o=b.observations[0];o.content='1.5';Object.assign(o.metrics[0],{displayed:'1.5',end:3,value:1.5});},b=>b.observations[0].metrics[0].unit=null])await bad(change,counts);
  const money=metricBundle(bundle,'money_range');await rpc('save',{bundle:money});
  for(const change of [b=>b.observations[0].metrics[0].lower=null,b=>b.observations[0].metrics[0].currency='USD',
   b=>{const o=b.observations[0];o.content='USD NZ$22–NZ$27';Object.assign(o.metrics[0],{displayed:o.content,end:o.content.length});},
   b=>{const o=b.observations[0];o.content='$22–$27';Object.assign(o.metrics[0],{displayed:o.content,end:o.content.length});},
   b=>{const o=b.observations[0];o.content='US$22–US$27';Object.assign(o.metrics[0],{currency:'USD',displayed:o.content,end:o.content.length});},
   b=>b.observations[0].metrics=[]])await bad(change,money);
  const ca=metricBundle(bundle,'money_range');ca.baseline=null;const o=ca.observations[0];o.content='CA$22–CA$27';Object.assign(o.metrics[0],{currency:'CAD',displayed:o.content,end:o.content.length});await rpc('save',{bundle:rehash(ca)});
  await bad(b=>{const o=b.observations[0];o.content='10%';o.metrics=[{id:'rate',label:'Conversion',kind:'rate',displayed:'10%',start:0,end:3,unit:'fraction',numerator:1,denominator:10,value:0.1}];b.baseline=null;});
  await assert.rejects(db.query('delete from private.r12_owner_observation_bundles where id=$1',[bundle.id]),/immutable/);
  assert.deepEqual(await one(db,'select (select count(*)::int from private.r12_owner_bootstrap_grants) grants,(select count(*)::int from private.r12_discovery_scopes) scopes,(select count(*)::int from private.r05_requests) requests'),{grants:0,scopes:0,requests:0});
 }finally{await db.close();}
});
