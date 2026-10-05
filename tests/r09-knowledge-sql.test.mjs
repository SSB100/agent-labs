import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {r07FixtureSetup,r07Seed,R07_OWNER} from './helpers/r07-sql-fixture.mjs';
import {R09_REVIEWER,R09_OUTSIDER,value,owner,read,controller,reviewFixture,sourceArtifact,proposalFixture,trustedRelease} from './helpers/r09-sql-fixture.mjs';
const root=process.cwd(),host=process.env.R09_SQL_TEST_HOST,required=process.env.R09_REQUIRE_POSTGRES==='1';
function fixtureUrl(value){const u=new URL(value);assert.ok(['postgres:','postgresql:'].includes(u.protocol)&&u.hostname==='127.0.0.1'&&u.pathname==='/r09_test'&&u.username==='r09_test'&&!u.search&&!u.hash,'Only a fresh loopback r09_test database is allowed');return u.href;}
test('R09 SQL fixture refuses production destinations',()=>{for(const url of ['postgresql://r09_test:x@db.example.com/r09_test','postgresql://postgres:x@127.0.0.1/r09_test','postgresql://r09_test:x@127.0.0.1/production'])assert.throws(()=>fixtureUrl(url));});
test('R09 actual reviewed proposal, immutable promotion, scoped applications and exact future work',{skip:!host&&!required},async t=>{
 const require=createRequire(path.resolve(host??root,'package.json'));let db,Client,config;
 if(required){assert.ok(process.env.R09_POSTGRES_URL);({Client}=require('pg'));config={connectionString:fixtureUrl(process.env.R09_POSTGRES_URL),statement_timeout:15000};const c=new Client(config);await c.connect();db={exec:s=>c.query(s),query:(s,p)=>c.query(s,p),close:()=>c.end()};assert.equal((await db.query("select count(*)::int n from pg_namespace where nspname in ('auth','private','storage')")).rows[0].n,0,'Fresh isolated cluster required');}
 else{const{PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');db=new PGlite({extensions:{pgcrypto}});}
 const functions="select p.oid::regprocedure::text id,pg_get_functiondef(p.oid) body,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f' order by 1";
 const tables="select c.oid::regclass::text id,c.relacl::text acl,c.relrowsecurity rls from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind in ('r','v','p') order by 1";
 try{
 await db.exec(r04SqlBootstrap);let oldFunctions,oldTables,legacy,legacySnapshot,beforeRows;
 const preservedRows=async()=>{const result={};for(const table of ['public.packs','public.installed_packs','private.r04_envelopes','private.r04_confirmations','private.r05_policies','private.r07_plans'])result[table]=await value(db,`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') result from ${table} t`);return result;};
 for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort()){
 const sql=readFileSync(`supabase/migrations/${file}`,'utf8');
 if(file.endsWith('_r09_reviewed_knowledge.sql')){
 await db.exec(r07FixtureSetup(root));legacy=await r07Seed(db);await controller(db,legacy,'plan',{plan:legacy.plan,expectedVersion:0,reason:'Legacy immutable plan',evidenceHash:'a'.repeat(64)});legacySnapshot=await controller(db,legacy,'read');
 oldFunctions=(await db.query(functions)).rows;oldTables=(await db.query(tables)).rows;beforeRows=await preservedRows();
 await assert.rejects(db.exec(sql.replace(/commit;\s*$/,()=>"do $$ begin raise exception 'r09_rollback'; end $$; commit;")),/r09_rollback/);await db.exec('rollback');assert.deepEqual((await db.query(functions)).rows,oldFunctions);assert.deepEqual((await db.query(tables)).rows,oldTables);assert.deepEqual(await preservedRows(),beforeRows);
 }
 await db.exec(sql);
 }
 // Later additive migrations may seed new inert pack definitions. Every
 // pre-R09 row must still be present byte-for-byte; this does not exempt edits.
 const preservedAfter=await preservedRows();
 for(const [table,before] of Object.entries(beforeRows)) {
  const ids=new Set(before.map(row=>row.id));
  assert.deepEqual(preservedAfter[table].filter(row=>ids.has(row.id)),before);
 }
 const after=new Map((await db.query(functions)).rows.map(x=>[x.id,x]));for(const row of oldFunctions){if(row.id==='private.r07_snapshot(uuid,uuid,uuid)')assert.equal(after.get(row.id).acl,row.acl);else if(row.id==='r07_controller(uuid,uuid,text,jsonb,uuid,text,text,bigint,text)'){const changed=after.get(row.id);assert.equal(changed.acl,row.acl);assert.equal(changed.body.replace(" if p_operation='plan' or result->>'status' in ('scheduled','reserved') or result->'shouldDispatch'='true'::jsonb then\n perform private.r09_assert_pins(coalesce((select snapshot from private.r09_run_pins where workflow_run_id=a.id and business_id=p_business_id),(select snapshot from private.r09_plan_pins where plan_id=p.id and business_id=p_business_id)));\n end if;\n",''),row.body);}else assert.deepEqual(after.get(row.id),row);}
 const rels=new Map((await db.query(tables)).rows.map(x=>[x.id,x]));for(const row of oldTables)assert.deepEqual(rels.get(row.id),row);
 const afterLegacy=await controller(db,legacy,'read');assert.deepEqual(afterLegacy.knowledge.pins,[]);delete afterLegacy.knowledge;assert.deepEqual(afterLegacy,legacySnapshot);
 await db.exec(readFileSync('supabase/tests/r09_reviewed_knowledge.sql','utf8'));
 for(const table of (await db.query("select tablename from pg_tables where schemaname='private' and tablename like 'r09_%'")).rows){const acl=(await db.query("select has_table_privilege('authenticated',$1,'SELECT,INSERT,UPDATE,DELETE') owner,has_table_privilege('service_role',$1,'SELECT,INSERT,UPDATE,DELETE') service",[`private.${table.tablename}`])).rows[0];assert.deepEqual(acl,{owner:false,service:false});}
 const a=await r07Seed(db),b=await r07Seed(db),artifact=await sourceArtifact(db,a),otherArtifact=await sourceArtifact(db,b);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[R07_OWNER]);await db.exec('set role authenticated');
 for(const payload of [null,{}, {...proposalFixture(artifact),artifactIds:null},{...proposalFixture(artifact),artifactIds:[artifact,artifact]},{...proposalFixture(artifact),limitations:[]},{...proposalFixture(artifact),lesson:'password: test-secret'},{...proposalFixture(artifact),artifactIds:[otherArtifact]}])await assert.rejects(owner(db,a.businessId,'propose',payload),/r0[49]_/);
 const submission=randomUUID(),p=await owner(db,a.businessId,'propose',proposalFixture(artifact),submission);assert.equal((await owner(db,a.businessId,'propose',proposalFixture(artifact),submission)).id,p.id);await assert.rejects(owner(db,a.businessId,'propose',{...proposalFixture(artifact),title:'Changed source'},submission),/submission_conflict/);
 await assert.rejects(owner(db,b.businessId,'propose',{...proposalFixture(otherArtifact),proposalId:p.proposalId,expectedVersion:1}),/compare_and_swap/);
 await assert.rejects(db.query('select private.r09_review($1,$2,$3,$4,$5)',[p.id,R09_REVIEWER,'a'.repeat(64),'approved',reviewFixture()]),/permission denied/);
 assert.equal((await read(db,b.businessId,'proposals',{selectedId:p.id})).selection.status,'missing');
 await db.exec('reset role');
 const actual=(await db.query('select e.snapshot,e.artifact_hash,private.r04_hash(to_jsonb(a)) expected from private.r09_evidence e join public.artifacts a on a.id=e.artifact_id where e.proposal_version_id=$1',[p.id])).rows[0];assert.equal(actual.artifact_hash,actual.expected);assert.equal(actual.snapshot.content.customerName,'Private Fixture Customer');
 await assert.rejects(db.query('update public.artifacts set content=$1 where id=$2',[{changed:true},artifact]),/immutable_source_evidence/);await assert.rejects(db.query('delete from public.artifacts where id=$1',[artifact]),/immutable_source_evidence/);
 const attemptReview=(id,review,verdict='approved',reviewer=R09_REVIEWER)=>value(db,'select private.r09_review($1,$2,$3,$4,$5) result',[id,reviewer,'c'.repeat(64),verdict,review]);
 await assert.rejects(attemptReview(p.id,reviewFixture(),'approved',R07_OWNER),/independent_reviewer/);
 for(const patch of [{proofPreserved:false},{redactionStatus:'rejected'},{generalizable:false},{privateContentRemoved:false},{independentSourcesVerified:false},{expiresAt:null}])await assert.rejects(attemptReview(p.id,reviewFixture(patch)),/r09_/);
 const contradictory=reviewFixture();contradictory.sources[1].stance='contradicts';await assert.rejects(attemptReview(p.id,contradictory),/conflicting_source/);
 const stale=reviewFixture();stale.sources[0].verifiedAt=new Date(Date.now()-100*86400000).toISOString();await assert.rejects(attemptReview(p.id,stale),/stale_source/);
 for(const change of [x=>x.content.limitations.push(x.content.limitations[0]),x=>x.sources.push({...x.sources[0]}),x=>x.sources[0].url='https://a.test/page',x=>x.sources[0].url='https://a.example/page',x=>x.sources[0].verifiedAt='2026-10-04T00:00Z',x=>x.content.guidance='Unsafe control \u0007',x=>x.proofPreserved=null]){const invalid=reviewFixture();change(invalid);await assert.rejects(attemptReview(p.id,invalid),/r09_/);}
 const one=reviewFixture();one.sources.pop();await assert.rejects(attemptReview(p.id,one),/evidence_missing/);
 for(const text of [a.businessId,'private@example.com','accountId: private-value','token: abcdefghijk']){const unsafe=reviewFixture();unsafe.content.guidance=text;await assert.rejects(attemptReview(p.id,unsafe),/private_content|credential_content/);}
 const rejected=await attemptReview(p.id,reviewFixture({redactionStatus:'rejected',proofPreserved:false}),'rejected');await assert.rejects(value(db,'select private.r09_promote($1,$2,$3,null,$4) result',[rejected,'knowledge.learned.rejected','1.0.0','Rejected proof must stay private.']),/approved_review_required/);
 await assert.rejects(attemptReview(p.id,reviewFixture()),/already_recorded/);
 const first=await trustedRelease(db,a,artifact);const second=await trustedRelease(db,a,artifact,'2.0.0',first.releaseId);
 const {validatePackManifest}=await import('../.core-tests/packs/registry.js'),{readQuestKnowledge}=await import('../.core-tests/core/reviewed-knowledge.js');
 for(const id of [first.releaseId,second.releaseId]){const pack=(await db.query('select manifest,qualification_evidence from public.packs where id=$1',[id])).rows[0];validatePackManifest(pack.manifest);assert.equal(pack.manifest.kind,'knowledge');for(const key of ['dependencies','capabilities','workers','workflows'])assert.deepEqual(pack.manifest[key],[]);for(const privateValue of [a.businessId,artifact,'Private Fixture Customer','private-fixture-account',first.proposal.id,R07_OWNER])assert.ok(!JSON.stringify(pack).includes(privateValue));}
 await assert.rejects(db.query("update public.packs set status='retired' where id=$1",[first.releaseId]),/immutable_release/);await assert.rejects(db.query("update public.pack_knowledge_definitions set content='{}' where pack_id=$1",[first.releaseId]),/immutable_release/);await assert.rejects(db.query("insert into public.pack_knowledge_definitions(pack_id,knowledge_key,version,name,source,verified_at,freshness_days,content) values($1,'injected','1.0.0','Unreviewed','https://www.nist.gov',now(),1,'{}')",[first.releaseId]),/immutable_release/);
 await assert.rejects(db.query('update public.pack_knowledge_definitions set pack_id=$1 where id=(select id from public.pack_knowledge_definitions where pack_id not in (select id from private.r09_releases) limit 1)',[first.releaseId]),/immutable_release/);
 await db.exec('set role authenticated');
 await assert.rejects(value(db,'select public.activate_business_pack($1,$2) result',[a.businessId,first.releaseId]),/deliberate_application/);
 let app1=await owner(db,a.businessId,'apply',{releaseId:first.releaseId,expectedApplicationId:null,reason:'Use reviewed guidance for future research.'});assert.equal(app1.businessId,a.businessId);assert.equal(app1.status,'applied');
 await assert.rejects(owner(db,b.businessId,'rollback',{applicationId:app1.id,expectedApplicationId:null,reason:'Should reject other Business history.'}),/application_unavailable/);
 assert.equal((await read(db,b.businessId,'releases',{selectedId:first.releaseId})).selection.item.application,null);
 const installBefore=await value(db,'select to_jsonb(i) result from public.installed_packs i where id=$1',[app1.installationId]);
 await db.exec('reset role');
 // Current applications become future immutable plan snapshots; unchanged legacy plan remains empty.
 await controller(db,a,'plan',{plan:a.plan,expectedVersion:0,reason:'Reviewed knowledge plan',evidenceHash:'a'.repeat(64)});let snap=await controller(db,a,'read');const originalPins=structuredClone(snap.knowledge);readQuestKnowledge(originalPins,a.businessId,snap.planId);assert.equal(originalPins.pins[0].releaseId,first.releaseId);
 await controller(db,a,'claim',{seconds:120});const aid=randomUUID();await controller(db,a,'schedule',{stepKey:'research',attemptId:aid,reason:'Reviewed finite schedule',evidenceHash:'b'.repeat(64),runtimeCapability:'inert-r09-runtime-capability-'.repeat(3)});
 const runPins=await value(db,'select snapshot result from private.r09_run_pins where workflow_run_id=$1',[aid]);const taskPins=await value(db,'select snapshot result from private.r09_task_pins where workflow_run_id=$1',[aid]);assert.deepEqual(runPins,originalPins);assert.deepEqual(taskPins,originalPins);
 await db.exec('set role authenticated');const app2=await owner(db,a.businessId,'apply',{releaseId:second.releaseId,expectedApplicationId:app1.id,reason:'Apply the reviewed second revision deliberately.'});
 assert.deepEqual((await read(db,a.businessId,'applications',{selectedId:app1.id})).selection.item.application,{id:app2.id,releaseId:second.releaseId});
 await assert.rejects(owner(db,a.businessId,'apply',{releaseId:first.releaseId,expectedApplicationId:app1.id,reason:'Stale optimistic revision cannot change history.'}),/compare_and_swap/);
 const rollback=await owner(db,a.businessId,'rollback',{applicationId:app1.id,expectedApplicationId:app2.id,reason:'Return to the earlier reviewed version for future work.'});assert.equal(rollback.releaseId,first.releaseId);assert.notEqual(rollback.id,app1.id);assert.equal(rollback.installationId,app1.installationId);assert.deepEqual(await value(db,'select to_jsonb(i) result from public.installed_packs i where id=$1',[app1.installationId]),installBefore);
 const removed=await owner(db,a.businessId,'remove',{packKey:app1.packKey,expectedApplicationId:rollback.id,reason:'Remove the application without deleting past evidence.'});assert.equal(removed.status,'removed');assert.equal(removed.releaseId,null);
 await db.exec('reset role');assert.deepEqual((await controller(db,a,'read')).knowledge,originalPins);
 // Dependency-root activation cannot smuggle reviewed knowledge past deliberate application.
 const manifest=await value(db,'select manifest result from public.packs where id=$1',[first.releaseId]);manifest.packKey='knowledge.r09-bypass-fixture';manifest.dependencies=[{packKey:app1.packKey,version:'1.0.0'}];const dependencyPack=await value(db,'select private.stage10_register_pack($1) result',[manifest]);await db.query('select private.stage10_qualify_pack($1,$2)',[dependencyPack,{source:'inert fixture',checks:Object.fromEntries(manifest.evals.map(x=>[x,'passed']))}]);
 await db.exec('set role authenticated');await assert.rejects(value(db,'select public.activate_business_pack($1,$2) result',[b.businessId,dependencyPack]),/deliberate_application/);await db.exec('reset role');
 // Shared release withdrawal stops new scheduling/reservation/dispatch but never rewrites existing pins.
 await db.query('select private.r09_withdraw($1,$2,$3)',[first.releaseId,R09_REVIEWER,'New contradictory evidence requires another independent review.']);
 await assert.rejects(owner(db,a.businessId,'apply',{releaseId:first.releaseId,expectedApplicationId:removed.id,reason:'Withdrawn content cannot be newly applied.'}),/stale_or_withdrawn/);await assert.rejects(owner(db,a.businessId,'rollback',{applicationId:app1.id,expectedApplicationId:removed.id,reason:'Withdrawn history is not an eligible rollback.'}),/stale_or_withdrawn/);
 assert.deepEqual((await controller(db,a,'read')).knowledge,originalPins);readQuestKnowledge(originalPins,a.businessId,snap.planId);
 await db.exec('set role authenticated');const usage=(await read(db,a.businessId,'usage',{selectedId:snap.planId})).selection.item;assert.equal(usage.knowledge[0].currentStatus,'withdrawn');assert.equal(usage.knowledge[0].applicationReason,app1.reason);await db.exec('reset role');
 const descriptor=await value(db,'select public.r05_input($1,$2) result',[a.businessId,`r07:${aid}`]);descriptor.workflowRunId=aid;delete descriptor.runtimeCapability;
 await assert.rejects(controller(db,a,'reserve',{attemptId:aid,descriptor,runtimeCapability:'inert-r09-runtime-capability-'.repeat(3)}),/stale_or_withdrawn/);assert.equal(await value(db,'select count(*)::int result from private.r07_bindings where attempt_id=$1',[aid]),0);

 // Schedule, reserve and dispatch are separately freshness-gated; in-flight readback remains possible.
 async function setupPlan(releaseId){const s=await r07Seed(db);await owner(db,s.businessId,'apply',{releaseId,expectedApplicationId:null,reason:'Reviewed information for this isolated future plan.'});await controller(db,s,'plan',{plan:s.plan,expectedVersion:0,reason:'Finite knowledge gate test',evidenceHash:'a'.repeat(64)});await controller(db,s,'claim',{seconds:120});return s;}
 const runtime='inert-r09-runtime-capability-'.repeat(3);
 async function schedule(s,key='research'){const id=randomUUID();await controller(db,s,'schedule',{stepKey:key,attemptId:id,reason:'Finite gated test step',evidenceHash:'b'.repeat(64),runtimeCapability:runtime});return id;}
 async function reserve(s,id){const d=await value(db,'select public.r05_input($1,$2) result',[s.businessId,`r07:${id}`]);d.workflowRunId=id;delete d.runtimeCapability;return controller(db,s,'reserve',{attemptId:id,descriptor:d,runtimeCapability:runtime});}
 const dispatch=(s,id)=>controller(db,s,'dispatch',{attemptId:id,wireHash:'f'.repeat(64)});
 async function respond(s,id,outcome='accepted'){const snapshot=await controller(db,s,'read'),attempt=snapshot.attempts.find(x=>x.id===id);return controller(db,s,'response',{attemptId:id,planHash:snapshot.planHash,inputHash:attempt.inputHash,outcome,result:{verdict:outcome==='accepted'?'pass':'reject',evidence:'Inert independently checked output.'},checkedArtifacts:attempt.dependencyPins,settlement:{actualMicrounits:'40',providerRequestId:`r09:${id}`,receiptHash:'d'.repeat(64)}});}
 const scheduledOnly=await setupPlan(second.releaseId),reservedOnly=await setupPlan(second.releaseId),inflight=await setupPlan(second.releaseId);
 const reservedId=await schedule(reservedOnly),inflightId=await schedule(inflight);await reserve(reservedOnly,reservedId);await reserve(inflight,inflightId);assert.equal((await dispatch(inflight,inflightId)).shouldDispatch,true);
 await db.query('select private.r09_withdraw($1,$2,$3)',[second.releaseId,R09_REVIEWER,'Withdraw before any additional bounded operation.']);
 await assert.rejects(schedule(scheduledOnly),/stale_or_withdrawn/);await assert.rejects(dispatch(reservedOnly,reservedId),/stale_or_withdrawn/);assert.equal(await value(db,'select count(*)::int result from private.r07_markers where attempt_id=$1',[reservedId]),0);assert.equal(await value(db,'select count(*)::int result from private.r05_markers where request_id=(select request_id from private.r07_bindings where attempt_id=$1)',[reservedId]),0);
 assert.equal((await respond(inflight,inflightId)).recorded,true,'Already-sent work can preserve truthful response/settlement after withdrawal');
 const rejectedApplication=(await read(db,a.businessId,'applications',{selectedId:app2.id})).selection.item;assert.equal(rejectedApplication.status,'superseded');assert.equal(rejectedApplication.releaseStatus,'withdrawn');
 const historical=(await read(db,inflight.businessId,'usage')).items[0];assert.equal(historical.knowledgeCount,1);assert.ok(!Object.hasOwn(historical,'knowledge'));
 const exactUsage=(await read(db,inflight.businessId,'usage',{selectedId:historical.id})).selection.item;assert.equal(exactUsage.runs[0].workflowRunId,inflightId);assert.ok(exactUsage.runs[0].taskContractId);
 // Actual controller pivot reuses exact successful work only while its original knowledge pins still match.
 for(const changed of [false,true]){
 const q=await r07Seed(db),source=await sourceArtifact(db,q),key=`knowledge.learned.pivot-${changed?'changed':'same'}`;
 const r1=await trustedRelease(db,q,source,'1.0.0',null,key),applied=await owner(db,q.businessId,'apply',{releaseId:r1.releaseId,expectedApplicationId:null,reason:'Pin the first reviewed guidance in this plan.'});
 await controller(db,q,'plan',{plan:q.plan,expectedVersion:0,reason:'Initial finite reuse plan',evidenceHash:'a'.repeat(64)});await controller(db,q,'claim',{seconds:120});
 const research=await schedule(q);await reserve(q,research);await dispatch(q,research);await respond(q,research);await controller(db,q,'finish',{attemptId:research});
 const challenge=await schedule(q,'challenge');await reserve(q,challenge);await dispatch(q,challenge);await respond(q,challenge,'rejected');await controller(db,q,'finish',{attemptId:challenge});
 const before=await controller(db,q,'read');
 if(changed){const revised=reviewFixture();revised.content.guidance='A changed reviewed lesson requires independently reconsidered research.';const r2=await trustedRelease(db,q,source,'2.0.0',r1.releaseId,key,revised);await owner(db,q.businessId,'apply',{releaseId:r2.releaseId,expectedApplicationId:applied.id,reason:'Use changed reviewed guidance in the next plan.'});}
 await controller(db,q,'plan',{plan:q.plan,expectedVersion:1,reason:'Repair based on an independent challenge result',evidenceHash:before.attempts.find(x=>x.id===challenge).resultEvidenceHash});
 const after=await controller(db,q,'read');assert.equal(after.reused.length,changed?0:1);if(!changed)assert.equal(after.reused[0].attemptId,research);readQuestKnowledge(after.knowledge,q.businessId,after.planId);
 assert.deepEqual(await value(db,'select snapshot result from private.r09_run_pins where workflow_run_id=$1',[research]),before.knowledge);
 }
 // Natural expiry is enforced without rewriting a release, application or historical pin.
 const exp=await r07Seed(db),expSource=await sourceArtifact(db,exp),short=reviewFixture({expiresAt:new Date(Date.now()+700).toISOString()});
 const expRelease=await trustedRelease(db,exp,expSource,'1.0.0',null,'knowledge.learned.expiry',short);
 await owner(db,exp.businessId,'apply',{releaseId:expRelease.releaseId,expectedApplicationId:null,reason:'Apply current evidence before its short expiry.'});
 await pause(800);await assert.rejects(controller(db,exp,'plan',{plan:exp.plan,expectedVersion:0,reason:'Expired evidence cannot seed new work',evidenceHash:'a'.repeat(64)}),/stale_or_withdrawn/);
 assert.equal((await read(db,exp.businessId,'releases',{selectedId:expRelease.releaseId})).selection.item.status,'expired');
 // Review rejection and raw evidence remain private under both same-owner and cross-owner contexts.
 await db.exec('set role authenticated');for(const dataset of ['proposals','applications','usage']){const id=dataset==='proposals'?first.proposal.id:dataset==='applications'?app1.id:snap.planId;assert.equal((await read(db,b.businessId,dataset,{selectedId:id})).selection.status,'missing');}
 for(const q of [null,{limit:null},{limit:26},{offset:-1},{offset:10001},{query:1},{selectedId:null},{unknown:true}])await assert.rejects(read(db,a.businessId,'proposals',q),/r09_/);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[R09_OUTSIDER]);await assert.rejects(read(db,a.businessId,'releases'),/owner_required/);await assert.rejects(owner(db,a.businessId,'propose',proposalFixture(artifact)),/owner_required/);await db.exec('reset role');
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[R07_OWNER]);
 // Independently counted 127-row private proposal pages and exact selections outside the page/filter.
 for(let n=0;n<124;n++)await owner(db,a.businessId,'propose',{...proposalFixture(artifact),title:`Bounded lesson ${n} 100%_`});
 await db.exec('begin read only; set local role authenticated');const page=await read(db,a.businessId,'proposals'),last=await read(db,a.businessId,'proposals',{offset:125}),exact=await read(db,a.businessId,'proposals',{query:'no match',offset:125,selectedId:p.id});assert.equal(page.total,127);assert.equal(page.items.length,25);assert.equal(last.items.length,2);assert.equal(exact.total,0);assert.equal(exact.selection.item.id,p.id);assert.equal((await read(db,a.businessId,'proposals',{query:'100%_'})).total,124);await db.exec('rollback');
 for(const role of ['anon','service_role']){await db.exec(`set role ${role}`);await assert.rejects(read(db,a.businessId,'proposals'),/permission denied/);await assert.rejects(db.query('select private.r09_promote($1,$2,$3,null,$4)',[first.reviewId,'knowledge.learned.no','3.0.0','Not an authorized platform reviewer.']),/permission denied/);await db.exec('reset role');}
 if(required)await qualifyRaces(db,Client,config,t);
 t.diagnostic(`${required?'PostgreSQL 17':'PGlite'}: transactional rollback, prior authority/rows, trusted review privacy, real compatible manifests, immutable exact plan/run/task pins, bounded reads and role isolation passed`);
 }finally{await db.close();}
});

async function qualifyRaces(db,Client,config,t){
 const left=new Client(config),right=new Client(config);await Promise.all([left.connect(),right.connect()]);
 async function begin(c){await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[R07_OWNER]);}
 async function lockWait(){const until=Date.now()+10000;while(Date.now()<until){const row=(await db.query('select wait_event_type,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=$1',[right.processID])).rows[0];if(row?.wait_event_type==='Lock'&&row.blockers.includes(left.processID))return;await pause(15);}throw new Error('R09 independent operation did not reach observed lock wait');}
 async function race(first,second,afterWait=async()=>{}){await begin(left);await begin(right);let pending;try{const a=await first();pending=second().then(result=>({result}),error=>({error}));await lockWait();await afterWait();await left.query('commit');const b=await pending;await right.query(b.error?'rollback':'commit');return {a,b};}catch(error){await left.query('rollback').catch(()=>{});if(pending)await pending;await right.query('rollback').catch(()=>{});throw error;}}
 try{
 let s=await r07Seed(db),artifact=await sourceArtifact(db,s),release=await trustedRelease(db,s,artifact,'1.0.0',null,`knowledge.learned.race-${randomUUID().slice(0,8)}`);
 let result=await race(()=>owner(left,s.businessId,'apply',{releaseId:release.releaseId,expectedApplicationId:null,reason:'First concurrently applied exact release.'}),()=>owner(right,s.businessId,'apply',{releaseId:release.releaseId,expectedApplicationId:null,reason:'Competing optimistic revision must fail.'}));assert.equal(result.a.status,'applied');assert.match(result.b.error?.message??'',/compare_and_swap/);
 const app=result.a;await owner(db,s.businessId,'remove',{packKey:app.packKey,expectedApplicationId:app.id,reason:'Remove before testing atomic plan snapshot.'});
 const head=(await read(db,s.businessId,'releases',{selectedId:release.releaseId})).selection.item.application;
 result=await race(()=>owner(left,s.businessId,'apply',{releaseId:release.releaseId,expectedApplicationId:head.id,reason:'Apply before a concurrent future plan.'}),()=>controller(right,s,'plan',{plan:s.plan,expectedVersion:0,reason:'Plan after application commit',evidenceHash:'a'.repeat(64)}));assert.ok(!result.b.error);assert.equal((await controller(db,s,'read')).knowledge.pins[0].applicationId,result.a.id);
 const other=await r07Seed(db);
 result=await race(()=>left.query('select private.r09_withdraw($1,$2,$3)',[release.releaseId,R09_REVIEWER,'Withdraw before concurrent application.']),()=>owner(right,other.businessId,'apply',{releaseId:release.releaseId,expectedApplicationId:null,reason:'Concurrent withdrawn release cannot apply.'}));assert.match(result.b.error?.message??'',/stale_or_withdrawn/);
 // In the reverse order withdrawal waits for a plan reader; the historical pin persists after withdrawal.
 s=await r07Seed(db);artifact=await sourceArtifact(db,s);release=await trustedRelease(db,s,artifact,'1.0.0',null,`knowledge.learned.pin-${randomUUID().slice(0,8)}`);await owner(db,s.businessId,'apply',{releaseId:release.releaseId,expectedApplicationId:null,reason:'Exact knowledge for a future plan.'});
 result=await race(()=>controller(left,s,'plan',{plan:s.plan,expectedVersion:0,reason:'Pin before withdrawal commit',evidenceHash:'a'.repeat(64)}),()=>right.query('select private.r09_withdraw($1,$2,$3)',[release.releaseId,R09_REVIEWER,'Withdrawal waits for atomic prior plan snapshot.']));assert.ok(!result.b.error);assert.equal((await controller(db,s,'read')).knowledge.pins[0].releaseId,release.releaseId);

 // A marker is insufficient: the final fence must survive a later Core-row lock wait.
 s=await r07Seed(db);artifact=await sourceArtifact(db,s);let expiresAt=new Date(Date.now()+4000).toISOString();
 release=await trustedRelease(db,s,artifact,'1.0.0',null,`knowledge.learned.dispatch-${randomUUID().slice(0,8)}`,reviewFixture({expiresAt}));
 await owner(db,s.businessId,'apply',{releaseId:release.releaseId,expectedApplicationId:null,reason:'Current knowledge expires during a later row lock.'});
 await controller(db,s,'plan',{plan:s.plan,expectedVersion:0,reason:'Post-marker expiry race',evidenceHash:'a'.repeat(64)});await controller(db,s,'claim',{seconds:120});
 const id=randomUUID(),runtime='inert-r09-runtime-capability-'.repeat(3);await controller(db,s,'schedule',{stepKey:'research',attemptId:id,reason:'Finite post-marker race',evidenceHash:'b'.repeat(64),runtimeCapability:runtime});
 const descriptor=await value(db,'select public.r05_input($1,$2) result',[s.businessId,`r07:${id}`]);descriptor.workflowRunId=id;delete descriptor.runtimeCapability;await controller(db,s,'reserve',{attemptId:id,descriptor,runtimeCapability:runtime});
 result=await race(()=>left.query('select * from public.worker_runs where workflow_run_id=$1 for update',[id]),()=>controller(right,s,'dispatch',{attemptId:id,wireHash:'f'.repeat(64)}),()=>pause(Math.max(0,Date.parse(expiresAt)-Date.now()+100)));
 assert.match(result.b.error?.message??'',/stale_or_withdrawn/);assert.equal(await value(db,'select count(*)::int result from private.r07_markers where attempt_id=$1',[id]),0);assert.equal(await value(db,'select count(*)::int result from private.r05_markers where request_id=(select request_id from private.r07_bindings where attempt_id=$1)',[id]),0);
 // Earlier-pin expiry while waiting for a later release lock must reject the complete plan atomically.
 s=await r07Seed(db);artifact=await sourceArtifact(db,s);expiresAt=new Date(Date.now()+4000).toISOString();const prefix=randomUUID().slice(0,8);
 const early=await trustedRelease(db,s,artifact,'1.0.0',null,`knowledge.learned.a-${prefix}`,reviewFixture({expiresAt})),later=await trustedRelease(db,s,artifact,'1.0.0',null,`knowledge.learned.z-${prefix}`);
 for(const r of [early,later])await owner(db,s.businessId,'apply',{releaseId:r.releaseId,expectedApplicationId:null,reason:'Two independent learned releases in one atomic snapshot.'});
 result=await race(()=>left.query('select * from private.r09_releases where id=$1 for update',[later.releaseId]),()=>controller(right,s,'plan',{plan:s.plan,expectedVersion:0,reason:'Multiple-pin expiry race',evidenceHash:'a'.repeat(64)}),()=>pause(Math.max(0,Date.parse(expiresAt)-Date.now()+100)));
 assert.match(result.b.error?.message??'',/stale_or_withdrawn/);assert.equal(await value(db,'select count(*)::int result from private.r07_plans where goal_id=$1',[s.goalId]),0);
 t.diagnostic('Six real PostgreSQL observed lock waits passed: apply/apply CAS, apply/plan, withdraw/apply, plan/withdraw, post-marker Core-row expiry, earlier-pin/later-lock expiry');

 }finally{await Promise.all([left.end(),right.end()]);}
}
