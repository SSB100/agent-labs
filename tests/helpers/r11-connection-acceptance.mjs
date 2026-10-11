import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');
const C=require('../../.core-tests/connections/contracts.js'),V=require('../../.core-tests/accounts/vault.js'),E=require('../../.core-tests/connections/etsy-read.js'),R=require('../../.core-tests/connections/etsy-refresh.js');
const {etsyConnectionReadiness}=require('../../.core-tests/connections/readiness.js');
/** Actual encrypted OAuth/server/SQL/readiness journey. Only official provider
 * responses are inert; there is no real grant, token or network transport. */
export async function r11ConnectionAcceptance(t,{db,user,authSession,key}){
 await t.test('R11 integrated connect, verify, bounded read, compatible redeploy, interrupted GET, Stop and reconcile',async()=>{
  const businessId=randomUUID(),grantId=randomUUID(),windowId=randomUUID(),shopId=909090,shopName='InertAcceptanceShop',calls=[];
  const env={VERCEL_ENV:'production',VERCEL_GIT_COMMIT_SHA:'a'.repeat(40),VERCEL_DEPLOYMENT_ID:'dpl_inert_acceptance_a',ACCOUNTS_SERVER_KEY:key,ACCOUNTS_VAULT_KEY:'1'.repeat(64),ETSY_KEYSTRING:'inert-acceptance-key',ETSY_SHARED_SECRET:'inert-acceptance-secret'};
  const fp=C.fingerprint(`${env.ETSY_KEYSTRING}\0${env.ETSY_SHARED_SECRET}`);let failGet=false,currentAccess='100.inert-initial-access';
  const fetcher=async(url,init)=>{
   const u=String(url),method=init.method;assert.equal(new URL(u).origin,'https://api.etsy.com');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');
   const headers=new Headers(init.headers);assert.equal(headers.get('x-api-key'),`${env.ETSY_KEYSTRING}:${env.ETSY_SHARED_SECRET}`);
   let body;
   if(u==='https://api.etsy.com/v3/public/oauth/token'){
    assert.equal(method,'POST');const type=new URLSearchParams(init.body).get('grant_type');assert.ok(['authorization_code','refresh_token'].includes(type));calls.push(type);
    if(type==='refresh_token'){assert.equal(new URLSearchParams(init.body).get('refresh_token'),'100.inert-initial-refresh');currentAccess='100.inert-refreshed-access';}
    body={token_type:'Bearer',access_token:currentAccess,refresh_token:type==='authorization_code'?'100.inert-initial-refresh':'100.inert-refreshed-refresh',scope:'shops_r listings_r',expires_in:type==='authorization_code'?60:3600};
   }else if(u==='https://api.etsy.com/v3/application/users/100/shops'){assert.equal(method,'GET');calls.push('shop');body={user_id:100,shop_id:shopId,shop_name:shopName,currency_code:'NZD'};}
   else{assert.equal(u,`https://api.etsy.com/v3/application/shops/${shopId}/listings?state=draft&limit=1&offset=0`);assert.equal(method,'GET');calls.push('drafts');if(failGet)throw Error('inert interrupted GET');body={count:0,results:[]};}
   if(method==='GET')assert.equal(headers.get('authorization'),`Bearer ${currentAccess}`);
   return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
  };
  const context={userId:user,businesses:[{id:businessId}],supabase:{auth:{getClaims:async()=>({data:{claims:{sub:user,session_id:authSession}}})},rpc:async(name,args)=>{
   try{const result=name==='r11_etsy_read_workspace'?await db.query('select public.r11_etsy_read_workspace($1) result',[args.p_business_id]):await db.query(`select public.${name==='r11_connection_owner'?'r11_connection_owner':'r11_etsy_read_owner'}($1,$2,$3,$4) result`,[args.p_business_id,args.p_operation,args.p_payload,args.p_server_key]);return{data:result.rows[0].result};}
   catch(error){return{error:{message:error.message}};}
  }}};
  const deps={'server-only':{},'node:crypto':require('node:crypto'),'../lib/core-ui/owner-business':{verifyOwnerBusiness:async(c,b)=>c.userId===user&&b===businessId},'../accounts/vault':V,'./contracts':C,'./printful-read':{},
   './etsy-read':{...E,exchangeReadOAuth:(...args)=>E.exchangeReadOAuth(...args,fetcher),verifyEtsyReadConnection:(...args)=>E.verifyEtsyReadConnection(...args,fetcher)},
   './etsy-refresh':{refreshReadOAuth:(...args)=>R.refreshReadOAuth(...args,fetcher),readExactDraftStatus:(...args)=>R.readExactDraftStatus(...args,fetcher)},
   './execution-release':{ownShopExecutionRelease:()=>require('../../.core-tests/connections/execution-release.js').ownShopExecutionRelease(env)}};
  const load=file=>{const m={exports:{}},src=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;runInNewContext(`(function(require,module,exports){${src}\n})`,{process:{env},Buffer,Date,URLSearchParams})(n=>{assert.ok(n in deps,n);return deps[n];},m,m.exports);return m.exports;};
  const server=load('src/connections/server.ts');deps['./server']=server;const runtime=load('src/connections/refresh-server.ts');
  await db.query('insert into public.businesses(id,owner_user_id,name) values($1,$2,$3)',[businessId,user,'Inert integrated connection']);
  await db.query("insert into private.r11_connection_grants(id,business_id,owner_id,auth_session_id,approved_credential_fingerprint,provider,application_id,expected_account,purpose_hash,approval_hash,provider_scopes,provider_scope_mode,expires_at,connection_expires_at) values($1,$2,$3,$4,$5,'etsy',$6,$7,repeat('1',64),repeat('2',64),'[\"shops_r\",\"listings_r\"]','exact',clock_timestamp()+interval '30 minutes',clock_timestamp()+interval '1 day')",[grantId,businessId,user,authSession,fp,env.ETSY_KEYSTRING,shopName]);
  assert.equal(etsyConnectionReadiness(await server.readConnectionQualification(context,businessId)).status,'not_connected');assert.deepEqual(calls,[]);
  const flow=await server.beginEtsyReadConnection(context,businessId,grantId),url=new URL(flow.url);assert.deepEqual(url.searchParams.get('scope').split(' ').sort(),['listings_r','shops_r']);assert.deepEqual(calls,[]);
  await server.completeEtsyReadConnection(context,flow.cookie,new URLSearchParams({state:url.searchParams.get('state'),code:'inert-approved-oauth-code'}));
  const view=await server.readConnectionQualification(context,businessId),connection=view.connections[0];assert.equal(view.unavailable,false);assert.equal(connection.externalAccountId,String(shopId));assert.equal(connection.custody,'encrypted_oauth');assert.equal(etsyConnectionReadiness(view).canCheck,false);
  await db.query("insert into private.r11_etsy_read_windows(id,business_id,owner_id,auth_session_id,connection_id,connection_revision,setup_grant_id,credential_fingerprint,approval_hash,purpose_hash,mode,max_reads,max_refreshes,min_refresh_seconds,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8,repeat('a',64),repeat('b',64),'lazy',4,2,3000,clock_timestamp()+interval '30 minutes')",[windowId,businessId,user,authSession,connection.id,connection.revision,grantId,fp]);
  const snapshot=async()=>(await db.query("select jsonb_build_object('grant',to_jsonb(g),'window',to_jsonb(w),'connection',to_jsonb(c)) result from private.r11_connection_grants g join private.r11_etsy_read_windows w on w.setup_grant_id=g.id join private.connected_accounts c on c.id=w.connection_id where w.id=$1",[windowId])).rows[0].result;
  const before=await snapshot(),first=randomUUID();assert.equal((await runtime.performEtsyDraftStatusRead(context,businessId,windowId,first)).status,'succeeded');assert.deepEqual(calls,['authorization_code','shop','drafts','refresh_token','drafts']);
  const verified=etsyConnectionReadiness(await server.readConnectionQualification(context,businessId));assert.equal(verified.status,'connected');assert.equal(verified.draftCount,0);assert.ok(verified.checkedAt);
  env.VERCEL_GIT_COMMIT_SHA='b'.repeat(40);env.VERCEL_DEPLOYMENT_ID='dpl_inert_acceptance_b';
  assert.equal((await runtime.performEtsyDraftStatusRead(context,businessId,windowId,first)).status,'succeeded');assert.equal(calls.length,5);
  const second=randomUUID();assert.equal((await runtime.performEtsyDraftStatusRead(context,businessId,windowId,second)).status,'succeeded');assert.equal(calls.length,6);assert.deepEqual(await snapshot(),before);
  const receipts=(await server.readConnectionQualification(context,businessId)).readAttempts;assert.ok(receipts.find(a=>a.id===first).executionReceipts.every(r=>r.release.commitSha==='a'.repeat(40)));assert.ok(receipts.find(a=>a.id===second).executionReceipts.every(r=>r.release.commitSha==='b'.repeat(40)));
  failGet=true;const interrupted=randomUUID();await assert.rejects(runtime.performEtsyDraftStatusRead(context,businessId,windowId,interrupted),/unverified/);const dispatched=calls.length;assert.equal((await runtime.reconcileEtsyDraftStatusRead(context,businessId,interrupted)).status,'failed');assert.equal((await runtime.performEtsyDraftStatusRead(context,businessId,windowId,interrupted)).status,'failed');assert.equal(calls.length,dispatched);
  failGet=false;assert.equal((await runtime.performEtsyDraftStatusRead(context,businessId,windowId,randomUUID())).status,'succeeded');
  await runtime.revokeEtsyReadWindow(context,businessId,windowId);const stoppedCalls=calls.length;await assert.rejects(runtime.performEtsyDraftStatusRead(context,businessId,windowId,randomUUID()));assert.equal((await runtime.reconcileEtsyDraftStatusRead(context,businessId,second)).status,'succeeded');assert.equal(calls.length,stoppedCalls);assert.equal((await server.readConnectionQualification(context,businessId)).readWindows[0].state,'revoked');
  assert.equal(calls.filter(c=>c==='authorization_code').length,1);assert.equal(calls.filter(c=>c==='refresh_token').length,1);
 });
}
