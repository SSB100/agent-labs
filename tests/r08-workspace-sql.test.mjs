import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {r07FixtureSetup,r07Seed,R07_OWNER} from './helpers/r07-sql-fixture.mjs';
const root=process.cwd(),host=process.env.R08_SQL_TEST_HOST,required=process.env.R08_REQUIRE_POSTGRES==='1';
function fixtureUrl(value){const u=new URL(value);assert.ok(['postgres:','postgresql:'].includes(u.protocol)&&u.hostname==='127.0.0.1'&&u.pathname==='/r08_test'&&u.username==='r08_test'&&!u.search&&!u.hash,'Only a fresh loopback r08_test database is allowed');return u.href;}
test('R08 SQL fixture refuses production destinations',()=>{for(const url of ['postgresql://r08_test:x@db.example.com/r08_test','postgresql://postgres:x@127.0.0.1/r08_test','postgresql://r08_test:x@127.0.0.1/production'])assert.throws(()=>fixtureUrl(url));});
test('R08 additive pure reads preserve authority and qualify exact Quest, privacy, paging and lineage',{skip:!host&&!required},async t=>{
 const require=createRequire(path.resolve(host??root,'package.json'));let db;
 if(required){assert.ok(process.env.R08_POSTGRES_URL);const{Client}=require('pg');const c=new Client({connectionString:fixtureUrl(process.env.R08_POSTGRES_URL)});await c.connect();db={exec:s=>c.query(s),query:(s,p)=>c.query(s,p),close:()=>c.end()};
  assert.equal((await db.query("select count(*)::int n from pg_namespace where nspname in ('auth','private','storage')")).rows[0].n,0,'Fresh isolated cluster required');
 }else{const{PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');db=new PGlite({extensions:{pgcrypto}});}
 const functions="select p.oid::regprocedure::text id,pg_get_functiondef(p.oid) body,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f' order by 1";
 const tables="select c.oid::regclass::text id,c.relacl::text acl,c.relrowsecurity rls from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind in ('r','v','p') order by 1";
 try{
  await db.exec(r04SqlBootstrap);let oldFunctions,oldTables;
  for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort()){
   const sql=readFileSync(`supabase/migrations/${file}`,'utf8');
   if(file.endsWith('_r08_owner_workspace.sql')){
    oldFunctions=(await db.query(functions)).rows;oldTables=(await db.query(tables)).rows;
    await assert.rejects(db.exec(sql.replace(/commit;\s*$/, () => "do $$ begin raise exception 'r08_rollback'; end $$; commit;")),/r08_rollback/);await db.exec('rollback');
    assert.deepEqual((await db.query(functions)).rows,oldFunctions);assert.deepEqual((await db.query(tables)).rows,oldTables);
   }
   await db.exec(sql);
  }
  // Qualify production Knowledge projections against the replayed schema, not a permissive transport fixture.
  const ownerRecords=readFileSync('src/components/console/console-owner-records.tsx','utf8');
  const installationProjections=[...ownerRecords.matchAll(/from\("installed_packs"\)\.select\("([^"]+)"/g)].map(match=>match[1]);
  assert.equal(installationProjections.length,2);
  for(const projection of installationProjections){assert.match(projection,/activated_at/);assert.doesNotMatch(projection,/created_at/);assert.match(projection,/^[a-z_,]+$/);await db.query(`select ${projection} from public.installed_packs order by activated_at desc,id desc limit 0`);}
  const after=new Map((await db.query(functions)).rows.map(x=>[x.id,x]));for(const row of oldFunctions)assert.deepEqual(after.get(row.id),row);
  const rels=new Map((await db.query(tables)).rows.map(x=>[x.id,x]));for(const row of oldTables)assert.deepEqual(rels.get(row.id),row);
  for(const name of ['workflow_runs','product_experiments','artifacts','creative_runs','creative_assets','owner_interventions','events']){
   const table=`public.r08_${name}`;
   const acl=(await db.query("select has_table_privilege('authenticated',$1,'SELECT') sel,has_table_privilege('authenticated',$1,'INSERT,UPDATE,DELETE') mut,has_table_privilege('anon',$1,'SELECT') anon,has_table_privilege('service_role',$1,'SELECT') service",[table])).rows[0];assert.deepEqual(acl,{sel:true,mut:false,anon:false,service:false});
   const options=(await db.query('select reloptions from pg_class where oid=$1::regclass',[table])).rows[0].reloptions;assert.ok(options.includes('security_invoker=true')&&options.includes('security_barrier=true'));
  }
  await db.exec(r07FixtureSetup(root));const a=await r07Seed(db),b=await r07Seed(db);
  const ar=(await db.query('select * from public.r05_fixture where b=$1',[a.businessId])).rows[0],br=(await db.query('select * from public.r05_fixture where b=$1',[b.businessId])).rows[0];
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[R07_OWNER]);
  const other=(await db.query("select public.r04_quest_transition($1,'quest.save',jsonb_build_object('goalId',null,'expectedRevision',0,'content',(select content||'{\"title\":\"Other exact Quest\"}'::jsonb from private.r04_goal_versions where goal_id=$2 order by revision desc limit 1)),gen_random_uuid()) x",[a.businessId,a.goalId])).rows[0].x.id;
  const otherRun=randomUUID();await db.query("insert into public.workflow_runs(id,business_id,goal_id,workflow_definition_id,idempotency_key,status) values($1,$2,$3,$4,'r08-other','queued')",[otherRun,a.businessId,other,'95050000-0000-4000-8000-000000000012']);
  const packageIds=[];for(let n=0;n<127;n++){const id=randomUUID();packageIds.push(id);await db.query("insert into public.artifacts(id,business_id,workflow_run_id,artifact_type,name,content,created_at) values($1,$2,$3,'product.package.v1',$4,$5,'2026-01-01')",[id,a.businessId,ar.w,`Saved package ${n} 100%_`,JSON.stringify({candidateId:randomUUID(),productIdentity:`inert:${n}`,version:'1.0'})]);}
  const outside=randomUUID();await db.query("insert into public.artifacts(id,business_id,workflow_run_id,artifact_type,name) values($1,$2,$3,'product.package.v1','Other Quest package')",[outside,a.businessId,otherRun]);
  const notice=randomUUID();await db.query("insert into public.owner_interventions(id,business_id,workflow_run_id,intervention_type,title,description) values($1,$2,$3,'r08.fixture','Exact approval needed','Bounded inert owner exception')",[notice,a.businessId,ar.w]);
  await db.query("insert into private.r05_decisions(business_id,decision,reason) values($1,'blocked','unlinked Business-level decision')",[a.businessId]);
  await db.exec('set role authenticated');
  assert.equal((await db.query('select public.r08_workflow_quest($1,$2) q',[a.businessId,ar.w])).rows[0].q,a.goalId);
  assert.equal((await db.query('select count(*)::int n from public.r08_artifacts where quest_id=$1',[a.goalId])).rows[0].n,127);
  const read=async(dataset,query={},goal=a.goalId,business=a.businessId)=>(await db.query('select public.r08_owner_read($1,$2,$3,$4) x',[business,goal,dataset,query])).rows[0].x;
  const p1=await read('products'),p2=await read('products',{offset:25}),p6=await read('products',{offset:125});assert.equal(p1.total,127);assert.equal(p1.items.length,25);assert.equal(p6.items.length,2);assert.equal(new Set([...p1.items,...p2.items].map(x=>x.id)).size,50);
  const exact=await read('products',{offset:125,query:'does not match',selectedId:packageIds[0]});assert.equal(exact.total,0);assert.equal(exact.selection.item.id,packageIds[0]);assert.equal(exact.selection.item.readiness,'unqualified');
  assert.equal((await read('products',{selectedId:outside})).selection.status,'missing');assert.equal((await read('products',{query:'100%_'})).total,127);
  assert.equal((await read('decisions')).total,2);assert.equal((await read('decisions',{},null)).total,3);assert.equal((await read('decisions',{selectedId:`notice:${notice}`})).selection.item.recordId,notice);
  await assert.rejects(read('products',{},a.goalId,b.businessId),/quest_unavailable/);await assert.rejects(read('products',{offset:-1}),/invalid_offset/);await assert.rejects(read('products',{limit:26}),/invalid_bounds/);await assert.rejects(read('products',{danger:true}),/invalid_query/);await assert.rejects(read('secrets'),/dataset_invalid/);
  await assert.rejects(db.query("delete from public.r08_artifacts where id=$1",[packageIds[0]]),/permission denied/);
  // The exact context stays same-owner Business isolated, then cross-owner RLS rejects everything.
  assert.equal((await db.query('select public.r08_workflow_quest($1,$2) q',[a.businessId,br.w])).rows[0].q,null);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[randomUUID()]);assert.equal((await db.query('select count(*)::int n from public.r08_artifacts')).rows[0].n,0);await assert.rejects(read('products'),/owner_required/);
  await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[R07_OWNER]);
  // Conflicting same-Business intervention and action-intent runs remain unlinked.
  const action=randomUUID();await db.query("insert into public.action_intents(id,business_id,workflow_run_id,action_type,capability,idempotency_key,created_by_type) values($1,$2,$3,'r08.fixture','r08.read','r08-fixture','system')",[action,a.businessId,otherRun]);await assert.rejects(db.query('update public.owner_interventions set action_intent_id=$1 where id=$2',[action,notice]),/owner_interventions_action_workflow_fk/);
  await db.query('update public.owner_interventions set workflow_run_id=null,action_intent_id=$1 where id=$2',[action,notice]);
  await db.exec('set role authenticated');assert.equal((await db.query('select quest_id from public.r08_owner_interventions where id=$1',[notice])).rows[0].quest_id,other);assert.equal((await read('decisions',{selectedId:`notice:${notice}`})).selection.status,'missing');
  await db.exec('reset role');
  // Private draft lineage uses exact artifact identity, status and private-row owner, never title matching.
  const connection=randomUUID(),revision=randomUUID(),draft=randomUUID(),otherDraft=randomUUID(),otherOwner=randomUUID();
  await db.query("insert into auth.users(id,email) values($1,'r08-other@example.invalid')",[otherOwner]);
  await db.query("insert into private.etsy_connections(id,business_id,owner_id,shop_id,shop_name,currency,revision,status) values($1,$2,$3,1234,'Inert read-only shop','USD',$4,'revoked')",[connection,a.businessId,R07_OWNER,revision]);
  for(const [draftId,owner,suffix] of [[draft,R07_OWNER,'a'],[otherDraft,otherOwner,'b']]) await db.query("insert into private.etsy_draft_runs(id,business_id,owner_id,connection_id,connection_revision,package_artifact_id,package_hash,package,identity,shop_id,product_identity,state,action_intent_id,approval_expires_at) values($1,$2,$3,$4,$5,$6,repeat('a',64),'{\"title\":\"Exact inert draft\"}', 'al-'||repeat($7,40),1234,$7,'{\"status\":\"verified\",\"listingId\":42}',$8,clock_timestamp()+interval '1 hour')",[draftId,a.businessId,owner,connection,revision,packageIds[0],suffix,action]);
  await db.exec('set role authenticated');
  const product=(await read('products',{selectedId:packageIds[0]})).selection.item;assert.equal(product.listingCount,1);assert.deepEqual(product.listings.map(x=>x.id),[draft]);
  const listing=(await read('listings',{selectedId:draft})).selection.item;assert.equal(listing.packageArtifactId,packageIds[0]);assert.equal(listing.status,'verified');assert.match(listing.draftReadback,/verified draft/);assert.equal(listing.publicSellingReady,false);assert.equal(listing.supplier,null);assert.equal((await read('listings',{selectedId:otherDraft})).selection.status,'missing');assert.ok(!(await read('products')).items.some(x=>Object.hasOwn(x,'listings')),'Only exact detail receives nested provider evidence');
  await db.exec('reset role');
  // Legacy Research can bind a null-goal workflow. Contradictory links fail closed everywhere.
  const legacyRun=randomUUID();await db.query("insert into public.workflow_runs(id,business_id,workflow_definition_id,idempotency_key,status) values($1,$2,$3,'r08-legacy','completed')",[legacyRun,a.businessId,'95050000-0000-4000-8000-000000000012']);
  for(const [index,goal,rev]of [[0,a.goalId,2],[1,other,1]]){
   const candidate=randomUUID(),experiment=randomUUID();
   await db.query("insert into public.product_candidates(id,business_id,fingerprint,concept,audience,hypothesis,original_design,rights_status,source_domains) values($1,$2,repeat($3,64),'Inert original concept','Inert audience','Inert hypothesis, not demand evidence',true,'confirmed',array['example.invalid'])",[candidate,a.businessId,index?'b':'a']);
   await db.query("insert into public.product_experiments(id,business_id,candidate_id,workflow_run_id,fingerprint,hypothesis,variables,audience,status,measurement_plan) values($1,$2,$3,$4,repeat($5,64),'Inert legacy hypothesis','{}','Inert audience','reserved',private.stage13_plan())",[experiment,a.businessId,candidate,legacyRun,index?'b':'a']);
   await db.query("insert into private.r04_research_links(experiment_id,business_id,goal_id,goal_revision,workflow_run_id,evidence,evidence_hash,actor_id) values($1,$2,$3,$4,$5,'{}',repeat('a',64),$6)",[experiment,a.businessId,goal,rev,legacyRun,R07_OWNER]);
   await db.exec('set role authenticated');assert.equal((await db.query('select public.r08_workflow_quest($1,$2) q',[a.businessId,legacyRun])).rows[0].q,index?null:a.goalId);await db.exec('reset role');
  }
  await db.exec('set role authenticated');assert.equal((await db.query('select count(*)::int n from public.r08_product_experiments where workflow_run_id=$1 and quest_id is not null',[legacyRun])).rows[0].n,0);await db.exec('reset role');
  const before=(await db.query("select count(*)::int n from public.events")).rows[0].n;
  await db.exec('begin read only; set local role authenticated');await read('products');await read('decisions');await db.exec('rollback');assert.equal((await db.query("select count(*)::int n from public.events")).rows[0].n,before);
  await db.exec('set role anon');await assert.rejects(read('products'),/permission denied/);await db.exec('reset role');
  t.diagnostic(`${required?'PostgreSQL':'PGlite'}: rollback + prior authority preservation + seven invoker views + 127-row scoped page/exact selection + role isolation + pure reads passed`);
 }finally{await db.close();}
});
