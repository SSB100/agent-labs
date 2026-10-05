import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './helpers/r10-sql-fixture.mjs';
const host=process.env.R11_SQL_TEST_HOST,pgUrl=process.env.R11_POSTGRES_URL;
function validatePg(url){const u=new URL(url);assert.ok(u.hostname==='127.0.0.1'&&u.username==='r11_test'&&u.pathname==='/r11_test'&&!u.search&&!u.hash,'Only isolated loopback r11_test allowed');return url;}
test('R11 SQL harness rejects production targets',()=>{for(const url of ['postgresql://r11_test:x@production.example/r11_test','postgresql://postgres:x@127.0.0.1/r11_test','postgresql://r11_test:x@127.0.0.1/production'])assert.throws(()=>validatePg(url));});
const sha=value=>createHash('sha256').update(value).digest('hex');
const user=randomUUID(),business=randomUUID(),authSession=randomUUID(),key='inert-r11-account-authority-only-123456789';
const envelope='account-v1.'+'a'.repeat(16)+'.'+'a'.repeat(22)+'.'+'a'.repeat(40);
const functions="select p.oid::regprocedure::text id,pg_get_functiondef(p.oid) body,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f' order by 1";
const value=async(db,sql,args=[])=>(await db.query(sql,args)).rows[0]?.result;
test('R11 additive SQL preserves prior functions/ACLs and installs no authority',{skip:!host},async t=>{
 const require=createRequire(path.resolve(host,'package.json'));let db,Client;
 if(pgUrl){validatePg(pgUrl);({Client}=require('pg'));db=new Client({connectionString:pgUrl});await db.connect();assert.equal(Number((await db.query("select count(*) from pg_tables where schemaname in ('public','private')")).rows[0].count),0,'Fresh fixture database required');db.exec=sql=>db.query(sql);db.close=()=>db.end();}
 else{const {PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');db=new PGlite({extensions:{pgcrypto}});}
 try{
 await db.exec(r04SqlBootstrap+sessionBootstrap);let before;
 for(const name of readdirSync('supabase/migrations').filter(n=>n.endsWith('.sql')).sort()){
  const source=readFileSync(`supabase/migrations/${name}`,'utf8');
  if(name.endsWith('_r11_scoped_connections.sql')){
   before=(await db.query(functions)).rows;await assert.rejects(db.exec(source.replace(/commit;\s*$/,()=>"do $$ begin raise exception 'r11_rollback';end $$;commit;")),/r11_rollback/);await db.exec('rollback');assert.deepEqual((await db.query(functions)).rows,before);
  }
  try{await db.exec(source);}catch(e){throw Error(`${name}: ${e.message}\n${e.where??''}\n${e.internalQuery??''}`);}
 }
 const after=new Map((await db.query(functions)).rows.map(x=>[x.id,x]));for(const row of before)assert.deepEqual(after.get(row.id),row);
 for(const name of ['r11_connection_grants','r11_connection_attempts','r11_credential_versions','r11_etsy_secrets'])assert.equal(await value(db,`select count(*)::int result from private.${name}`),0);
 await db.query('insert into auth.users(id,email) values($1,$2)',[user,'r11-inert@example.invalid']);await db.query('insert into public.businesses(id,owner_user_id,name) values($1,$2,$3)',[business,user,'R11 isolated fixture']);await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[authSession,user]);await db.query('insert into private.account_server_authority values($1,true)',[sha(key)]);
 await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[user,JSON.stringify({sub:user,session_id:authSession})]);
 const rpc=(operation,payload,authority=key)=>value(db,'select public.r11_connection_owner($1,$2,$3,$4) result',[business,operation,payload,authority]);
 const enroll=async(provider='etsy',extra={})=>{const id=randomUUID();await db.query("insert into private.r11_connection_grants(id,business_id,owner_id,auth_session_id,approved_credential_fingerprint,provider,application_id,expected_account,purpose_hash,approval_hash,credential_alias,store_kind,provider_type,provider_scopes,provider_scope_mode,expires_at,connection_expires_at) values($1,$2,$3,$4,repeat('4',64),$5,'inert-app',$6,$7,$8,$9,$10,$11,$12,'exact',clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 day')",[id,business,user,authSession,provider,provider==='etsy'?'InertOwnShop':'123','1'.repeat(64),'2'.repeat(64),provider==='printful'?'PRINTFUL_INERT_TOKEN':null,provider==='printful'?'manual_api':null,provider==='printful'?'native':null,JSON.stringify(provider==='printful'?['stores_list/read']:['shops_r','listings_r'])]);return {id,provider,...extra};};
 const begin=async(g)=>{const attemptId=randomUUID(),revision=randomUUID();await rpc('begin',{grantId:g.id,attemptId,revision,stateHash:g.provider==='etsy'?'3'.repeat(64):null,envelope:g.provider==='etsy'?envelope:null,credentialFingerprint:'4'.repeat(64)});return{g,attemptId,revision};};
 const mark=(a,step,facts={})=>rpc('mark',{attemptId:a.attemptId,step,facts,credentialFingerprint:'4'.repeat(64)});
 await t.test('authority and direct table grants are closed',async()=>{
  const g=await enroll();await assert.rejects(rpc('begin',{grantId:g.id,attemptId:randomUUID(),revision:randomUUID(),stateHash:'3'.repeat(64),envelope,credentialFingerprint:'4'.repeat(64)},'wrong'),/authority_required/);
  await db.exec('set role authenticated');await assert.rejects(db.query('select * from private.r11_connection_grants'),/permission denied/);await db.exec('reset role');
 });
 await t.test('exact scope, one-shot markers, immutable lineage and durable read-only custody',async()=>{
  const a=await begin(await enroll());await assert.rejects(begin(a.g),/already_used/);const consumed=await rpc('consume',{attemptId:a.attemptId,stateHash:'3'.repeat(64),credentialFingerprint:'4'.repeat(64)});assert.equal(consumed.envelope,envelope);
  assert.equal(await value(db,'select envelope result from private.r11_connection_attempts where id=$1',[a.attemptId]),null);
  await assert.rejects(rpc('consume',{attemptId:a.attemptId,stateHash:'3'.repeat(64),credentialFingerprint:'4'.repeat(64)}),/binding_mismatch/);
  const p=await mark(a,0);assert.equal(p.endpoint,'https://api.etsy.com/v3/public/oauth/token');await assert.rejects(mark(a,0),/already_dispatched/);
  await assert.rejects(mark(a,1,{userId:100,scopes:['shops_r','listings_r','listings_w'],tokenExpiresAt:new Date(Date.now()+300000).toISOString()}),/read_scope_required/);
  await mark(a,1,{userId:100,scopes:['shops_r','listings_r'],tokenExpiresAt:new Date(Date.now()+300000).toISOString()});
  await assert.rejects(mark(a,2,{userId:100,shopId:200,shopName:'OtherShop',currency:'NZD'}),/shop_mismatch/);
  await mark(a,2,{userId:100,shopId:200,shopName:'InertOwnShop',currency:'NZD'});
  const proof={userId:100,shopId:200,shopName:'InertOwnShop',currency:'NZD',listingCount:0,totalDrafts:0,factsHash:'5'.repeat(64),verifiedAt:new Date().toISOString()};
  const result=await rpc('complete',{attemptId:a.attemptId,proof,envelope,credentialFingerprint:'4'.repeat(64)});assert.equal(result.verified,true);
  assert.equal(await value(db,'select count(*)::int result from private.etsy_connections'),0,'No legacy write-scope connection created');
  assert.deepEqual(await value(db,'select provider_scopes result from private.r11_credential_versions where connection_id=$1',[result.connectionId]),['shops_r','listings_r']);
  const view=await value(db,'select public.r11_connection_read($1) result',[business]);assert.equal(view.connections[0].permittedOperations.includes('listing.write'),false);assert.ok(!JSON.stringify(view).includes(envelope));
  await rpc('disconnect',{connectionId:result.connectionId,revision:result.revision});assert.equal(await value(db,'select envelope result from private.r11_etsy_secrets where connection_id=$1',[result.connectionId]),null);
 });

 const prepareEtsy=async()=>{const a=await begin(await enroll());await rpc('consume',{attemptId:a.attemptId,stateHash:'3'.repeat(64),credentialFingerprint:'4'.repeat(64)});await mark(a,0);await mark(a,1,{userId:100,scopes:['shops_r','listings_r'],tokenExpiresAt:new Date(Date.now()+300000).toISOString()});await mark(a,2,{userId:100,shopId:200,shopName:'InertOwnShop',currency:'NZD'});return a;};
 const proof=()=>({userId:100,shopId:200,shopName:'InertOwnShop',currency:'NZD',listingCount:0,totalDrafts:0,factsHash:'5'.repeat(64),verifiedAt:new Date().toISOString()});
 const complete=a=>rpc('complete',{attemptId:a.attemptId,proof:proof(),envelope,credentialFingerprint:'4'.repeat(64)});
 await t.test('newer verified rotation fences an older attempt and retains both histories',async()=>{
  const older=await prepareEtsy(),newer=await prepareEtsy();const result=await complete(newer);await assert.rejects(complete(older),/stale_connection_revision/);
  assert.equal(await value(db,'select connection_revision result from private.connected_accounts where id=$1',[result.connectionId]),newer.revision);
  assert.equal(await value(db,'select count(*)::int result from private.r11_connection_markers where attempt_id=$1',[older.attemptId]),3);
 });
 await t.test('local disconnect cancels pending verification without requiring server authority',async()=>{
  const pending=await prepareEtsy(),current=(await db.query("select id,connection_revision from private.connected_accounts where business_id=$1 and provider='etsy'",[business])).rows[0];
  await rpc('disconnect',{connectionId:current.id,revision:current.connection_revision},'');await assert.rejects(complete(pending),/attempt_inactive/);
  assert.equal(await value(db,'select envelope result from private.r11_etsy_secrets where connection_id=$1',[current.id]),null);
 });
 await t.test('disconnect again while already revoked still cancels a new pending reconnect',async()=>{
  const current=(await db.query("select id,connection_revision from private.connected_accounts where business_id=$1 and provider='etsy'",[business])).rows[0];
  await rpc('disconnect',{connectionId:current.id,revision:current.connection_revision},'');const pending=await prepareEtsy();await rpc('disconnect',{connectionId:current.id,revision:current.connection_revision},'');await assert.rejects(complete(pending),/attempt_inactive/);
 });
 await t.test('revocation blocks dispatch and makes saved proof inactive without rewriting history',async()=>{
  const a=await prepareEtsy(),result=await complete(a);await db.query('insert into private.r11_connection_revocations(grant_id) values($1)',[a.g.id]);
  const view=await value(db,'select public.r11_connection_read($1) result',[business]);assert.equal(view.connections.find(c=>c.id===result.connectionId).status,'revoked');
  await assert.rejects(mark(a,0),/grant_inactive/);assert.equal(await value(db,'select count(*)::int result from private.r11_credential_versions where connection_id=$1',[result.connectionId])>=1,true);
 });
 await t.test('missing/null facts, foreign owner, wrong session and absent callbacks stay closed',async()=>{
  const a=await begin(await enroll());await assert.rejects(mark(a,0,null),/credential_changed/);
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:user,session_id:randomUUID()})]);await assert.rejects(rpc('consume',{attemptId:a.attemptId,stateHash:'3'.repeat(64),credentialFingerprint:'4'.repeat(64)}),/session_required/);
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:user,session_id:authSession})]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[randomUUID()]);await assert.rejects(value(db,'select public.r11_connection_read($1) result',[business]),/owner_required/);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
 });
 await t.test('Printful persists only exact environment custody and catalog scopes',async()=>{
  const a=await begin(await enroll('printful'));for(let step=0;step<2;step++){const p=await mark(a,step);assert.equal(p.method,'GET');assert.equal(p.endpoint,['https://api.printful.com/oauth/scopes','https://api.printful.com/stores/123'][step]);}
  const result=await rpc('complete',{attemptId:a.attemptId,proof:{storeId:123,storeKind:'manual_api',providerType:'native',providerScopes:['stores_list/read'],responseHash:'6'.repeat(64),verifiedAt:new Date().toISOString()},envelope:null,credentialFingerprint:'4'.repeat(64)});
  assert.equal(await value(db,'select count(*)::int result from private.provider_connections where id=$1',[result.connectionId]),0);
  const v=(await db.query('select custody,credential_alias,permitted_operations from private.r11_credential_versions where connection_id=$1',[result.connectionId])).rows[0];assert.equal(v.custody,'environment');assert.equal(v.credential_alias,'PRINTFUL_INERT_TOKEN');assert.deepEqual(v.permitted_operations,['catalog.read']);
 });
 if(pgUrl){
  const client=async()=>{const c=new Client({connectionString:pgUrl});await c.connect();await c.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[user,JSON.stringify({sub:user,session_id:authSession})]);return c;};
  const waiting=async(c)=>{const pid=c.processID;for(let i=0;i<100;i++){const blocked=(await db.query('select cardinality(pg_blocking_pids($1)) n',[pid])).rows[0].n;if(blocked>0)return;await new Promise(r=>setTimeout(r,20));}assert.fail('No real lock wait observed');};
  await t.test('observed PostgreSQL grant-revocation-before-dispatch race denies before marker',async()=>{
   const a=await begin(await enroll('printful')),locker=await client(),runner=await client();try{await locker.query('begin');await locker.query('insert into private.r11_connection_revocations(grant_id) values($1)',[a.g.id]);
    const pending=runner.query('select public.r11_connection_owner($1,$2,$3,$4)',[business,'mark',{attemptId:a.attemptId,step:0,facts:{},credentialFingerprint:'4'.repeat(64)},key]);const caught=pending.catch(e=>e);await waiting(runner);await locker.query('commit');assert.match((await caught).message,/grant_inactive/);assert.equal(await value(db,'select count(*)::int result from private.r11_connection_markers where attempt_id=$1',[a.attemptId]),0);
   }finally{await locker.query('rollback');await locker.end();await runner.end();}
  });
  await t.test('observed PostgreSQL session expiry during grant lock wait fails closed',async()=>{
   const a=await begin(await enroll('printful')),locker=await client(),runner=await client();try{await db.query("update auth.sessions set not_after=clock_timestamp()+interval '700 milliseconds' where id=$1",[authSession]);await locker.query('begin');await locker.query('select id from private.r11_connection_grants where id=$1 for update',[a.g.id]);
    const pending=runner.query('select public.r11_connection_owner($1,$2,$3,$4)',[business,'mark',{attemptId:a.attemptId,step:0,facts:{},credentialFingerprint:'4'.repeat(64)},key]);const caught=pending.catch(e=>e);await waiting(runner);await new Promise(r=>setTimeout(r,800));await locker.query('commit');assert.match((await caught).message,/grant_inactive|dispatch_expired/);assert.equal(await value(db,'select count(*)::int result from private.r11_connection_markers where attempt_id=$1',[a.attemptId]),0);
   }finally{await locker.query('rollback');await locker.end();await runner.end();await db.query('update auth.sessions set not_after=null where id=$1',[authSession]);}
  });
 }
 }finally{await db.close();}
});
