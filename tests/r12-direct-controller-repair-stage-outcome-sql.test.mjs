import test from 'node:test';import assert from 'node:assert/strict';
import {directRepairDatabase} from './helpers/r12-direct-controller-repair-database.mjs';
import {directRepairRaceFixture as directRepairFixture} from './helpers/r12-direct-controller-repair-race-fixture.mjs';
import {directRepairModelComplete as complete,directRepairModelFail as fail} from './helpers/r12-direct-controller-repair-model-fixture.mjs';
import {directRepairReview} from './helpers/r12-direct-controller-repair-review-fixture.mjs';
import {directControllerSource} from './helpers/r12-direct-controller-source-fixture.mjs';
import {r12PhaseOutputFixture} from './helpers/r12-phase-output-fixture.mjs';
import {one} from './helpers/r12-owner-initial-sql-fixture.mjs';
import {validatePublicResearchRepairState as valid} from '../.core-tests/products/discovery-r12-public-repair.js';
import {discoveryV2Hash as hash} from '../.core-tests/products/discovery-v2-hash.js';
test('repair cap stage outcomes distinguish invalid research and qualified insufficient evidence from the window terminal',{skip:!process.env.R12_SQL_TEST_HOST&&!process.env.R12_REQUIRE_POSTGRES&&!process.env.R12_POSTGRES_URL,timeout:240000},async()=>{const db=await directRepairDatabase();try{
 const failed=await directRepairFixture(db);failed.authority.db=db;
 for(let n=1;n<=10;n++)await fail(failed,await failed.schedule('plan'));
 const invalid=(await failed.read()).state;valid(invalid,failed.policy);assert.equal(invalid.unitsConsumed,10);assert.equal(invalid.nextAction,'window_limit');assert.equal(invalid.terminal,'RESEARCH_INSUFFICIENT_AT_WINDOW_LIMIT');assert.equal(invalid.researchStageOutcome,'INVALID_RESEARCH');assert.equal(invalid.questComplete,false);await assert.rejects(failed.schedule('plan'),/phase_not_admitted/);
 const f=await directRepairFixture(db);f.authority.db=db;
 for(let n=1;n<=9;n++)await fail(f,await f.schedule('plan'));
 const output=r12PhaseOutputFixture(f.profile.audience);output.plan.queryFocus=[];output.strategy.marketComparisons=output.strategy.marketComparisons.filter(x=>x.countryCode==='GB');await complete(f,await f.schedule('plan'),output.plan);await directControllerSource(f,await f.schedule('source'));const strategy=await complete(f,await f.schedule('strategy'),{assessment:output.strategy,measurement:null});
 const base=(await one(db,'select private.r12_direct_default_qualification(s) q from private.r12_direct_research_setups s where scope_id=$1',[f.prepared.scopeId])).q;
 // Private synthetic reviewed facts, never assertions supplied by the model.
 const qualification={...base,comparativeConclusion:false,missingCriticalRequirements:[]};await db.query('insert into private.r12_direct_review_qualifications(scope_id,ordinal,content,content_hash) values($1,1,$2,$3)',[f.prepared.scopeId,qualification,hash(qualification)]);
 const reviewer=await f.schedule('review'),raw=directRepairReview(f,reviewer,strategy.expected.proposalHash);for(const [dimension,rating] of Object.entries(raw.quality)){rating.score=4;rating.anchorId=dimension+'.4';rating.missingFacts=[];}
 const reviewed=await complete(f,reviewer,raw);assert.equal(reviewed.expected.review.quality.passed,true);assert.equal(reviewed.expected.outcome,'NME');const insufficient=reviewed.done.state;valid(insufficient,f.policy);assert.equal(insufficient.unitsConsumed,10);assert.equal(insufficient.logicalCyclesStarted,1);assert.equal(insufficient.terminal,'RESEARCH_INSUFFICIENT_AT_WINDOW_LIMIT');assert.equal(insufficient.researchStageOutcome,'INSUFFICIENT_EVIDENCE');assert.equal(insufficient.questComplete,false);await assert.rejects(f.schedule('plan'),/phase_not_admitted/);
 }finally{await db.close();}});
