import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
export async function r11RefreshSqlCases(t,{db,user,authSession,key,envelope,Client}){
 const value=async(sql,args=[])=>(await db.query(sql,args)).rows[0]?.result;
 let shopCounter=10000;
 const fp='4'.repeat(64),proof=()=>({userId:100,shopId:200,shopName:'InertOwnShop',listingCount:0,totalDrafts:0,factsHash:'5'.repeat(64),verifiedAt:new Date(Date.now()+10).toISOString()});
 async function fixture({tokenMs=300000,setupMs=3600000,cutoffMs=86400000}={}){
  const shop=++shopCounter;
  const b=randomUUID(),g=randomUUID(),setupAttempt=randomUUID(),revision=randomUUID();await db.query('insert into public.businesses(id,owner_user_id,name) values($1,$2,$3)',[b,user,'Inert renewable connection']);
  await db.query("insert into private.r11_connection_grants(id,business_id,owner_id,auth_session_id,approved_credential_fingerprint,provider,application_id,expected_account,purpose_hash,approval_hash,provider_scopes,provider_scope_mode,expires_at,connection_expires_at) values($1,$2,$3,$4,$5,'etsy','inert-app','InertOwnShop',repeat('1',64),repeat('2',64),'[\"shops_r\",\"listings_r\"]','exact',clock_timestamp()+($6::integer*interval '1 millisecond'),clock_timestamp()+($7::integer*interval '1 millisecond'))",[g,b,user,authSession,fp,setupMs,cutoffMs]);
  const setup=(op,payload)=>value('select public.r11_connection_owner($1,$2,$3,$4) result',[b,op,payload,key]);
  await setup('begin',{grantId:g,attemptId:setupAttempt,revision,stateHash:'3'.repeat(64),envelope,credentialFingerprint:fp});await setup('consume',{attemptId:setupAttempt,stateHash:'3'.repeat(64),credentialFingerprint:fp});
  const mark=(step,facts={})=>setup('mark',{attemptId:setupAttempt,step,facts,credentialFingerprint:fp});await mark(0);await mark(1,{userId:100,scopes:['shops_r','listings_r'],tokenExpiresAt:new Date(Date.now()+tokenMs).toISOString()});await mark(2,{userId:100,shopId:shop,shopName:'InertOwnShop',currency:'NZD'});await setup('complete',{attemptId:setupAttempt,proof:{...proof(),shopId:shop,currency:'NZD'},envelope,credentialFingerprint:fp});
  const f={b,g,connectionId:setupAttempt,revision,setup,proof:()=>({...proof(),shopId:shop})};
  f.window=async({mode='qualification',ms=1800000,maxReads=1,maxRefreshes=1}={})=>{const id=randomUUID();await db.query("insert into private.r11_etsy_read_windows(id,business_id,owner_id,auth_session_id,connection_id,connection_revision,setup_grant_id,credential_fingerprint,approval_hash,purpose_hash,mode,max_reads,max_refreshes,min_refresh_seconds,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8,repeat('a',64),repeat('b',64),$9,$10,$11,3000,clock_timestamp()+($12::integer*interval '1 millisecond'))",[id,b,user,authSession,setupAttempt,revision,g,fp,mode,maxReads,maxRefreshes,ms]);return id;};
  f.rpc=(op,payload,authority=key)=>value('select public.r11_etsy_read_owner($1,$2,$3,$4) result',[b,op,payload,authority]);
  f.begin=(windowId,id=randomUUID())=>f.rpc('begin',{windowId,operationId:id,credentialFingerprint:fp});
  f.step=(op,id,extra={})=>f.rpc(op,{operationId:id,credentialFingerprint:fp,...extra});
  f.rotate=id=>f.step('rotate',id,{envelope,tokenExpiresAt:new Date(Date.now()+3300000).toISOString(),userId:100,scopes:['shops_r','listings_r']});
  f.workspace=()=>value('select public.r11_etsy_read_workspace($1) result',[b]);
  f.custody=()=>value('select to_jsonb(s) result from private.r11_etsy_token_custody s where connection_id=$1',[setupAttempt]);return f;
 }
 await t.test('R11 refresh storage is closed and no operation authority is seeded',async()=>{
  for(const table of ['r11_etsy_read_windows','r11_etsy_read_revocations','r11_etsy_read_attempts','r11_etsy_token_custody']){assert.equal(await value(`select count(*)::int result from private.${table}`),0);await db.exec('set role authenticated');await assert.rejects(db.query(`select * from private.${table}`),/permission denied/);await db.exec('reset role');}
 });
 await t.test('R11 forced refresh saves candidate before GET, imports once, rotates generation and replays without dispatch',async()=>{
  const f=await fixture({tokenMs:600}),w=await f.window(),a=await f.begin(w);assert.equal(a.needsRefresh,true);assert.equal(a.format,'setup');assert.equal(await value('select envelope result from private.r11_etsy_secrets where connection_id=$1',[f.connectionId]),null);
  const duplicate=await f.begin(w,a.operationId);assert.equal(duplicate.shouldDispatch,false);assert.equal('envelope' in duplicate,false);
  await f.step('mark_refresh',a.operationId);await assert.rejects(f.step('mark_refresh',a.operationId),/not_dispatchable/);assert.equal((await f.custody()).state,'frozen');
  await f.rotate(a.operationId);assert.equal((await f.custody()).state,'candidate');assert.equal((await f.custody()).generation_id,a.operationId);
  await f.step('mark_read',a.operationId);await f.step('complete',a.operationId,{proof:f.proof()});assert.equal((await f.custody()).state,'ready');
  const done=await f.begin(w,a.operationId);assert.equal(done.status,'succeeded');assert.equal(done.shouldDispatch,false);assert.equal(done.proof.totalDrafts,0);
  await new Promise(r=>setTimeout(r,700));const view=await f.workspace();assert.equal(view.connections.find(c=>c.provider==='etsy').status,'connected');assert.equal(view.readWindows[0].state,'exhausted');assert.ok(!JSON.stringify(view).includes(envelope));
  await assert.rejects(db.query('update private.r11_etsy_read_attempts set refresh_marked_at=null where id=$1',[a.operationId]),/immutable/);
 });
 await t.test('R11 fresh-token lazy read has zero refresh markers and consumes its GET exactly once',async()=>{
  const f=await fixture(),w=await f.window({mode:'lazy'}),a=await f.begin(w);assert.equal(a.needsRefresh,false);await assert.rejects(f.step('mark_refresh',a.operationId),/not_dispatchable/);await f.step('mark_read',a.operationId);await f.step('complete',a.operationId,{proof:f.proof()});assert.equal(await value('select count(*)::int result from private.r11_etsy_read_attempts where window_id=$1 and refresh_marked_at is not null',[w]),0);assert.equal((await f.begin(w)).status,'exhausted');
 });
 await t.test('R11 new read authority does not inherit the expired historical setup deadline',async()=>{
  const f=await fixture({setupMs:400}),w=await f.window({mode:'lazy'});await new Promise(r=>setTimeout(r,500));const a=await f.begin(w);assert.equal(a.shouldDispatch,true);await f.step('mark_read',a.operationId);await f.step('complete',a.operationId,{proof:f.proof()});
 });
 await t.test('R11 uncertain POST freezes the generation across operation IDs and new windows',async()=>{
  const f=await fixture(),w=await f.window(),a=await f.begin(w);await f.step('mark_refresh',a.operationId);await f.rpc('fail',{operationId:a.operationId});const w2=await f.window();assert.equal((await f.begin(w2)).status,'refresh_unverified');assert.equal((await f.custody()).state,'frozen');assert.equal(await value('select count(*)::int result from private.r11_etsy_read_attempts where connection_id=$1 and refresh_marked_at is not null',[f.connectionId]),1);
 });
 await t.test('R11 failed verification GET retains rotated candidate and never restores its predecessor',async()=>{
  const f=await fixture(),w=await f.window(),a=await f.begin(w);await f.step('mark_refresh',a.operationId);await f.rotate(a.operationId);await f.step('mark_read',a.operationId);await f.rpc('fail',{operationId:a.operationId});const s=await f.custody();assert.equal(s.state,'candidate');assert.equal(s.generation_id,a.operationId);assert.equal(s.envelope,envelope);assert.equal((await f.begin(await f.window())).status,'refresh_unverified');assert.equal((await f.workspace()).connections.find(c=>c.provider==='etsy').status,'refresh_unverified');
 });
 await t.test('R11 expired pre-POST reservation is releasable; expired post-POST reservation is not',async()=>{
  for(const dispatched of [false,true]){const f=await fixture(),w=await f.window({ms:250}),a=await f.begin(w);if(dispatched)await f.step('mark_refresh',a.operationId);await new Promise(r=>setTimeout(r,350));const next=await f.begin(await f.window());assert.equal(next.shouldDispatch,!dispatched);if(dispatched)assert.equal(next.status,'refresh_unverified');}
 });
 await t.test('R11 concurrent windows share a connection slot and operation identity cannot change windows',async()=>{
  const f=await fixture(),w1=await f.window(),w2=await f.window(),a=await f.begin(w1);assert.equal((await f.begin(w2)).status,'busy');await assert.rejects(f.begin(w2,a.operationId),/identity_conflict/);assert.equal(await value("select count(*)::int result from private.r11_etsy_read_attempts where connection_id=$1 and status='reserved'",[f.connectionId]),1);
 });
 await t.test('R11 setup/window revocation and local disconnect prevent late rotation/promotion',async()=>{
  for(const action of ['setup-revoke','window-revoke','disconnect']){const f=await fixture(),w=await f.window(),a=await f.begin(w);await f.step('mark_refresh',a.operationId);if(action==='setup-revoke')await db.query('insert into private.r11_connection_revocations(grant_id) values($1)',[f.g]);else if(action==='window-revoke')await f.rpc('revoke_window',{windowId:w},'');else await f.setup('disconnect',{connectionId:f.connectionId,revision:f.revision});await assert.rejects(f.rotate(a.operationId));if(action!=='setup-revoke')assert.equal((await f.custody()).envelope,null);if(action==='disconnect')assert.equal((await f.workspace()).connections.find(c=>c.provider==='etsy').status,'revoked');}
 });
 await t.test('R11 foreign owner/session, changed credential and overlong window cannot resolve tokens',async()=>{
  const f=await fixture(),w=await f.window();for(const p of [{windowId:w,operationId:randomUUID(),credentialFingerprint:'f'.repeat(64)}])await assert.rejects(f.rpc('begin',p),/authority_inactive/);
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:user,session_id:randomUUID()})]);await assert.rejects(f.begin(w),/session_required/);await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:user,session_id:authSession})]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[randomUUID()]);await assert.rejects(f.begin(w),/owner_required/);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);await assert.rejects(f.begin(await f.window({ms:172800000})),/authority_inactive/);
 });
 await t.test('R11 hard local cutoff prevents both read and refresh without extending custody',async()=>{
  const f=await fixture({setupMs:200,cutoffMs:800}),w=await f.window({ms:600});await new Promise(r=>setTimeout(r,900));await assert.rejects(f.begin(w),/authority_inactive/);assert.equal(await value('select count(*)::int result from private.r11_etsy_read_attempts where connection_id=$1',[f.connectionId]),0);
 });
 await t.test('R11 a new authenticated owner session can stop the old window without execution authority',async()=>{
  const f=await fixture(),w=await f.window(),newSession=randomUUID();await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[newSession,user]);await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:user,session_id:newSession})]);
  try{await assert.rejects(f.begin(w),/window_unavailable/);assert.equal((await f.rpc('revoke_window',{windowId:w},'')).revoked,true);}finally{await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:user,session_id:authSession})]);}
 });
 await t.test('R11 canonical account identity drift clears custody and cannot inherit setup shop proof',async()=>{
  const f=await fixture(),w=await f.window(),a=await f.begin(w);await f.step('mark_refresh',a.operationId);await f.rotate(a.operationId);await db.query("update private.connected_accounts set provider_account_id='999999999' where id=$1",[f.connectionId]);assert.equal((await f.custody()).envelope,null);await assert.rejects(f.step('mark_read',a.operationId));await assert.rejects(f.begin(await f.window()),/identity_unverified/);
 });
 await t.test('R11 refresh minimum interval spans new windows and counts dispatch rather than success',async()=>{
  const f=await fixture(),w=await f.window(),a=await f.begin(w);await f.step('mark_refresh',a.operationId);await f.rotate(a.operationId);await f.step('mark_read',a.operationId);await f.step('complete',a.operationId,{proof:f.proof()});const w2=await f.window(),a2=await f.begin(w2);await assert.rejects(f.step('mark_refresh',a2.operationId),/budget_or_rate/);assert.equal(await value('select refresh_marked_at result from private.r11_etsy_read_attempts where id=$1',[a2.operationId]),null);assert.equal((await f.custody()).state,'ready');
 });
 if(Client){
  const client=async()=>{const c=new Client({connectionString:process.env.R11_POSTGRES_URL});await c.connect();await c.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[user,JSON.stringify({sub:user,session_id:authSession})]);return c;};
  const waiting=async(c)=>{for(let n=0;n<100;n++){if((await db.query('select cardinality(pg_blocking_pids($1)) n',[c.processID])).rows[0].n>0)return;await new Promise(r=>setTimeout(r,20));}assert.fail('Expected real PostgreSQL lock wait');};
  await t.test('R11 observed PostgreSQL concurrent windows admit exactly one single-flight operation',async()=>{const f=await fixture(),w1=await f.window(),w2=await f.window(),locker=await client(),r1=await client(),r2=await client();try{await locker.query('begin');await locker.query('select id from public.businesses where id=$1 for update',[f.b]);const run=(c,w)=>c.query('select public.r11_etsy_read_owner($1,$2,$3,$4) result',[f.b,'begin',{windowId:w,operationId:randomUUID(),credentialFingerprint:fp},key]);const p1=run(r1,w1),p2=run(r2,w2);await waiting(r1);await waiting(r2);await locker.query('commit');const results=(await Promise.all([p1,p2])).map(x=>x.rows[0].result);assert.equal(results.filter(x=>x.shouldDispatch).length,1);assert.equal(results.filter(x=>x.status==='busy').length,1);}finally{await locker.query('rollback');await locker.end();await r1.end();await r2.end();}});
  await t.test('R11 observed PostgreSQL session expiry during a window lock wait denies refresh dispatch',async()=>{const f=await fixture(),w=await f.window(),a=await f.begin(w),locker=await client(),runner=await client();try{await db.query("update auth.sessions set not_after=clock_timestamp()+interval '400 milliseconds' where id=$1",[authSession]);await locker.query('begin');await locker.query('select id from private.r11_etsy_read_windows where id=$1 for update',[w]);const pending=runner.query('select public.r11_etsy_read_owner($1,$2,$3,$4)',[f.b,'mark_refresh',{operationId:a.operationId,credentialFingerprint:fp},key]).catch(e=>e);await waiting(runner);await new Promise(r=>setTimeout(r,600));await locker.query('commit');assert.match((await pending).message,/authority_inactive|session_required|dispatch_expired/);assert.equal(await value('select refresh_marked_at result from private.r11_etsy_read_attempts where id=$1',[a.operationId]),null);}finally{await locker.query('rollback');await locker.end();await runner.end();await db.query('update auth.sessions set not_after=null where id=$1',[authSession]);}});
  await t.test('R11 observed PostgreSQL window revocation beats a waiting refresh marker',async()=>{const f=await fixture(),w=await f.window(),a=await f.begin(w),locker=await client(),runner=await client();try{await locker.query('begin');await locker.query('insert into private.r11_etsy_read_revocations(window_id) values($1)',[w]);const pending=runner.query('select public.r11_etsy_read_owner($1,$2,$3,$4)',[f.b,'mark_refresh',{operationId:a.operationId,credentialFingerprint:fp},key]).catch(e=>e);await waiting(runner);await locker.query('commit');assert.match((await pending).message,/authority_inactive/);assert.equal(await value('select refresh_marked_at result from private.r11_etsy_read_attempts where id=$1',[a.operationId]),null);}finally{await locker.query('rollback');await locker.end();await runner.end();}});
 }
}
