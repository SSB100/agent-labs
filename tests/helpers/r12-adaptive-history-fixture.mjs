/** Inert engineering fixture: four genuinely executed, owner-stopped plans.
 * No terminal phase, outcome, charge or closure is fabricated. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {exerciseOwnerInitialRuntime} from './r12-owner-initial-runtime.mjs';
import {enrollOwnerEpisodeGrant,episodeInput,runOwnerEpisodePhases} from './r12-owner-episode-sql-fixture.mjs';
import {one} from './r12-owner-initial-sql-fixture.mjs';
import {r12QuoteFixture} from './r12-provider-fixture.mjs';

export async function readClosedResearchHistory(db,goalId,maximumVersion=4){
 return (await one(db,`select coalesce(jsonb_agg(jsonb_build_object(
  'plan',to_jsonb(p),
  'attempts',(select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]') from private.r07_attempts a where a.plan_id=p.id),
  'responses',(select coalesce(jsonb_agg(to_jsonb(r) order by r.attempt_id),'[]') from private.r07_responses r join private.r07_attempts a on a.id=r.attempt_id where a.plan_id=p.id),
  'candidates',(select coalesce(jsonb_agg(to_jsonb(c) order by c.request_id),'[]') from private.r12_discovery_candidates c join private.r12_discovery_wires w on w.request_id=c.request_id join private.r07_attempts a on a.id=w.attempt_id where a.plan_id=p.id)
 ) order by p.version),'[]') history from private.r07_plans p where p.goal_id=$1 and p.version<=$2`,[goalId,maximumVersion])).history;
}

export async function exerciseFourPlanResearchHistory(db,{legacy=null,onClosed=null}={}){
 return exerciseOwnerInitialRuntime(db,{legacy,fixtureOptions:{maximumScopes:4,maximumAllocation:8000000},onCompleted:async ctx=>{
  await ctx.server.stopDiscoveryR12(ctx.context,ctx.f.businessId,ctx.scope.id,true);
  const f=await enrollOwnerEpisodeGrant(db,ctx.f,{maximumEpisodes:3,maximumAllocationMicrounits:String(3*r12QuoteFixture().maximumMicrousd)});
  const scopes=[ctx.scope.id];
  let inertPosts=5,inertReceiptGets=5;
  for(let version=2;version<=4;version++){
   const prior=await readClosedResearchHistory(db,f.goalId,version-1);
   const prepared=await f.server('prepare_episode',{input:await episodeInput(db,f),quote:r12QuoteFixture()});
   const activated=await f.server('confirm_episode',f.confirmPayload(prepared));
   assert.equal(activated.activated,true);
   const run=await runOwnerEpisodePhases(db,f,activated);
   const workspace=await f.rpc('r12_discovery_owner_read',[f.businessId,activated.scopeId,false]);
   assert.equal(workspace.rootFunding.committedMicrousd,version*50+(legacy?.committedMicrounits??0));
   assert.equal(workspace.rootFunding.pendingExposureMicrousd,0);
   inertPosts+=run.posts;inertReceiptGets+=run.gets;
   await f.server('stop',{setupId:prepared.setupId,setupHash:prepared.setupHash,submissionId:randomUUID()},'');
   assert.deepEqual(await readClosedResearchHistory(db,f.goalId,version-1),prior,'Continuation preserves every closed predecessor record');
   scopes.push(activated.scopeId);
  }
  const history=await readClosedResearchHistory(db,f.goalId);
  assert.deepEqual(history.map(h=>h.plan.version),[1,2,3,4]);
  assert.ok(history.every(h=>h.attempts.length===5&&h.attempts.every(a=>a.status==='completed')));
  assert.equal(inertPosts,20);assert.equal(inertReceiptGets,20);
  const predecessor=(await one(db,'select private.r12_owner_episode_predecessor($1,$2) proof',[f.businessId,f.goalId])).proof;
  assert.equal(predecessor.predecessorPlanId,history.at(-1).plan.id);
  const value={...ctx,f,scopes,history,predecessor,inertPosts,inertReceiptGets};
  return onClosed?onClosed(value):value;
 }});
}
