/** Real multi-session gate. Fresh disposable loopback database only; no HTTP. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {r04SqlBootstrap} from './r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './r10-sql-fixture.mjs';
import {validateOwnerInitialRaceEnvironment,orderedRace,asRole} from './r12-owner-initial-postgres-races.mjs';
import {exerciseOwnerInitialRuntime} from './r12-owner-initial-runtime.mjs';
import {enrollOwnerEpisodeGrant,episodeInput,runOwnerEpisodePhases} from './r12-owner-episode-sql-fixture.mjs';
import {one} from './r12-owner-initial-sql-fixture.mjs';
import {r12QuoteFixture} from './r12-provider-fixture.mjs';
import {appendOwnerGrantRootRevision,enrollOwnerExtensionGrant} from './r12-owner-grant-extension-sql-fixture.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const validateOwnerEpisodeRaceEnvironment=validateOwnerInitialRaceEnvironment;
export async function exerciseOwnerEpisodePostgresRaces(env=process.env){
 const target=validateOwnerEpisodeRaceEnvironment(env),req=createRequire(path.resolve(target.host,'package.json'));
 assert.equal(req('pg/package.json').version,'8.16.3');const {Client}=req('pg');
 const clients=['observer','holder','waiter'].map(label=>new Client({connectionString:target.url,ssl:false,application_name:'r12-owner-episode-'+label,connectionTimeoutMillis:5000}));
 const [db,holder,waiter]=clients,connected=new Set(),originalFetch=globalThis.fetch,races=[];let transportCalls=0;
 globalThis.fetch=async()=>{transportCalls++;throw Error('HTTP forbidden in episode race gate');};
 try{
  for(const client of clients){await client.connect();connected.add(client);client.exec=sql=>client.query(sql);await client.query("set timezone='UTC'");assert.deepEqual(await one(client,'select current_user actor,current_database() db,host(inet_server_addr()) address'),{actor:'r12_test',db:'r12_test',address:target.address});}
  assert.equal((await one(db,"select count(*)::int n from pg_tables where schemaname in ('public','private')")).n,0,'Fresh disposable database required');
  assert.deepEqual((await db.query("select rolname from pg_roles where rolname in ('anon','authenticated','service_role')")).rows,[],'Fresh bootstrap roles required');
  await db.exec(r04SqlBootstrap+sessionBootstrap);
  for(const file of readdirSync(root+'/supabase/migrations').filter(x=>x.endsWith('.sql')).sort())await db.exec(readFileSync(root+'/supabase/migrations/'+file,'utf8'));
  const record=(name,r)=>{assert.equal(r.observedLockWait,true);races.push({name,observedLockWait:true,waitEvent:r.waitEvent});};
  await exerciseOwnerInitialRuntime(db,{onCompleted:async ctx=>{
   await ctx.server.stopDiscoveryR12(ctx.context,ctx.f.businessId,ctx.scope.id,true);
   const amount=r12QuoteFixture().maximumMicrousd,f=await enrollOwnerEpisodeGrant(db,ctx.f,{maximumEpisodes:3,maximumAllocationMicrounits:String(2*amount)});
   const owner=(c,op,payload)=>asRole(c,'authenticated','r12_owner_research_server',[f.businessId,op,payload,op.startsWith('stop')?'':f.bootstrapKey],f.ownerId);
   const prepare=async()=>f.server('prepare_episode',{input:await episodeInput(db,f),quote:r12QuoteFixture()});
   const stop=s=>({setupId:s.setupId,setupHash:s.setupHash,submissionId:randomUUID()});
   const a=await prepare(),b=await prepare();
   // A concurrent counter change invalidates the exact closure before activation.
   const stale=await orderedRace({observer:db,holder,waiter,first:async c=>{await c.query('select id from public.businesses where id=$1 for update',[f.businessId]);await c.query('update private.r07_heads set children_created=children_created+1 where goal_id=$1',[f.goalId]);return true;},second:c=>owner(c,'confirm_episode',f.confirmPayload(a))});
   assert.ok(stale.second.error);assert.match(stale.second.error.message,/counter|stale|predecessor|lineage|lifetime_bound/);record('counter-tamper-cannot-activate-stale-closure',stale);
   await db.query('update private.r07_heads set children_created=children_created-1 where goal_id=$1',[f.goalId]);
   const confirm=f.confirmPayload(a),competing=await orderedRace({observer:db,holder,waiter,first:c=>owner(c,'confirm_episode',confirm),second:c=>owner(c,'confirm_episode',f.confirmPayload(b))});
   assert.equal(competing.first.activated,true);assert.ok(competing.second.error);record('same-closed-predecessor-has-one-successor',competing);
   const replay=await orderedRace({observer:db,holder,waiter,first:c=>owner(c,'confirm_episode',confirm),second:c=>owner(c,'confirm_episode',confirm)});
   assert.equal(replay.second.error,undefined);assert.equal(replay.second.value.replayed,true);assert.equal(replay.first.scopeId,replay.second.value.scopeId);record('exact-confirm-replay-is-one-activation',replay);
   await f.server('stop',stop(a),'');
   // Stopping a prepared successor wins before confirmation and mints no authority.
   const c=await prepare(),stopFirst=await orderedRace({observer:db,holder,waiter,first:x=>owner(x,'stop',stop(c)),second:x=>owner(x,'confirm_episode',f.confirmPayload(c))});
   assert.ok(stopFirst.second.error);assert.match(stopFirst.second.error.message,/stopped|revoked/);record('stop-before-confirm-mints-no-authority',stopFirst);
   const d=await prepare(),confirmFirst=await orderedRace({observer:db,holder,waiter,first:x=>owner(x,'confirm_episode',f.confirmPayload(d)),second:x=>owner(x,'stop',stop(d))});
   assert.equal(confirmFirst.second.error,undefined);assert.equal(confirmFirst.second.value.stopped,true);record('confirm-before-stop-consumes-zero-send-episode',confirmFirst);
   assert.equal((await one(db,'select count(*)::int n from private.r12_owner_episode_activations where goal_id=$1',[f.goalId])).n,2);
   assert.equal((await one(db,'select count(*)::int n from private.r05_markers where business_id=$1',[f.businessId])).n,5,'Neither activated continuation sent a provider request');
   const input=await episodeInput(db,f),exhausted=await orderedRace({observer:db,holder,waiter,first:async x=>{await x.query('select id from public.businesses where id=$1 for update',[f.businessId]);return true;},second:x=>owner(x,'prepare_episode',{input,quote:r12QuoteFixture()})});
   assert.match(exhausted.second.error?.message??'',/episode_grant_exhausted/);record('cumulative-allocation-bound-blocks-next-episode',exhausted);
   assert.equal((await one(db,'select count(*)::int n from private.r12_owner_episode_closures where goal_id=$1',[f.goalId])).n,2);
  }});
  await exerciseOwnerInitialRuntime(db,{fixtureOptions:{maximumScopes:1,maximumAllocation:Number(r12QuoteFixture().maximumMicrousd)},onCompleted:async ctx=>{
   await ctx.server.stopDiscoveryR12(ctx.context,ctx.f.businessId,ctx.scope.id,true);
   const amount=Number(r12QuoteFixture().maximumMicrousd),expiry=ctx.f.profile.validUntil;
   const rev1=await appendOwnerGrantRootRevision(db,ctx.f.rootId,{maximumScopes:2,maximumAllocationMicrounits:String(2*amount),expiresAt:expiry});
   const first=await enrollOwnerExtensionGrant(db,ctx.f,rev1,{maximumEpisodes:1,maximumAllocationMicrounits:String(amount)});
   const staleSetup=await first.server('prepare_episode',{input:await episodeInput(db,first),quote:r12QuoteFixture()});
   const confirm=(c,f,s)=>asRole(c,'authenticated','r12_owner_research_server',[f.businessId,'confirm_episode',f.confirmPayload(s),f.bootstrapKey],f.ownerId);
   // Operator extension commits while confirmation waits on the immutable root.
   const extensionFirst=await orderedRace({observer:db,holder,waiter,lockRelation:'private.r12_owner_grant_roots',first:async c=>{
    await c.query('select id from private.r12_owner_grant_roots where id=$1 for update',[ctx.f.rootId]);
    return appendOwnerGrantRootRevision(c,ctx.f.rootId,{maximumScopes:3,maximumAllocationMicrounits:String(3*amount),expiresAt:expiry});
   },second:c=>confirm(c,first,staleSetup)});
   assert.equal(extensionFirst.first.revision,2);assert.match(extensionFirst.second.error?.message??'',/extension_grant_stale/);record('extension-first-invalidates-unactivated-setup',extensionFirst);
   assert.equal((await one(db,'select count(*)::int n from private.r12_owner_episode_activations where grant_root_id=$1',[ctx.f.rootId])).n,0);
   const second=await enrollOwnerExtensionGrant(db,ctx.f,extensionFirst.first,{maximumEpisodes:1,maximumAllocationMicrounits:String(amount)});
   const setup=await second.server('prepare_episode',{input:await episodeInput(db,second),quote:r12QuoteFixture()});
   const confirmation=second.confirmPayload(setup);
   const confirmFirst=await orderedRace({observer:db,holder,waiter,lockRelation:'private.r12_owner_grant_roots',first:c=>asRole(c,'authenticated','r12_owner_research_server',[second.businessId,'confirm_episode',confirmation,second.bootstrapKey],second.ownerId),second:c=>appendOwnerGrantRootRevision(c,ctx.f.rootId,{maximumScopes:4,maximumAllocationMicrounits:String(4*amount),expiresAt:expiry})});
   assert.equal(confirmFirst.first.activated,true);assert.equal(confirmFirst.second.error,undefined);assert.equal(confirmFirst.second.value.revision,3);record('confirmation-first-preserves-activated-receipt',confirmFirst);
   assert.equal((await second.server('confirm_episode',confirmation)).replayed,true);
   const stop=await second.server('stop',{setupId:setup.setupId,setupHash:setup.setupHash,submissionId:randomUUID()},'');assert.equal(stop.stopped,true);
   assert.equal((await one(db,'select count(*)::int n from private.r05_markers where business_id=$1',[ctx.f.businessId])).n,5,'Extension and Stop sent no provider request');
  }});
  await exerciseOwnerInitialRuntime(db,{onCompleted:async ctx=>{
   await ctx.server.stopDiscoveryR12(ctx.context,ctx.f.businessId,ctx.scope.id,true);
   const f=await enrollOwnerEpisodeGrant(db,ctx.f),s=await f.server('prepare_episode',{input:await episodeInput(db,f),quote:r12QuoteFixture()});await f.server('confirm_episode',f.confirmPayload(s));
   const plan=await one(db,'select p.* from private.r07_plans p join private.r07_heads h on h.plan_id=p.id where h.goal_id=$1',[f.goalId]);
   await runOwnerEpisodePhases(db,f,s,{expectStopped:true,onFirstPost:async()=>{
    const owner=(c,op,payload)=>asRole(c,'authenticated','r12_owner_research_server',[f.businessId,op,payload,op==='stop'?'':f.bootstrapKey],f.ownerId);
    const input={...f.input,submissionId:randomUUID(),predecessorPlanId:plan.id,predecessorPlanHash:plan.content_hash,predecessorScopeId:s.scopeId,predecessorScopeHash:plan.content.discoveryScopeHash};
    const race=await orderedRace({observer:db,holder,waiter,first:c=>owner(c,'stop',{setupId:s.setupId,setupHash:s.setupHash,submissionId:randomUUID()}),second:c=>owner(c,'prepare_episode',{input,quote:r12QuoteFixture()})});
    assert.match(race.second.error?.message??'',/unresolved_liability/);record('stop-and-continue-before-late-settlement-retain-liability',race);
   }});
   assert.equal((await one(db,'select count(*)::int n from private.r05_exposure($1) where unknown',[f.businessId])).n,0);
   assert.equal((await one(db,'select plan_id from private.r07_heads where goal_id=$1',[f.goalId])).plan_id,plan.id,'Late settlement cannot advance or reopen the predecessor');
   assert.equal((await one(db,'select count(*)::int n from private.r12_owner_episode_activations where goal_id=$1',[f.goalId])).n,1);
  }});
  assert.equal(transportCalls,0);return {version:'r12.owner-episode-postgres-races.1',engine:'postgresql',passed:true,providerCalls:0,transportHttpCalls:0,races};
 }finally{globalThis.fetch=originalFetch;await Promise.all(clients.map(async c=>{if(connected.has(c))await c.query('rollback').catch(()=>{});await c.end().catch(()=>{});}));}
}
