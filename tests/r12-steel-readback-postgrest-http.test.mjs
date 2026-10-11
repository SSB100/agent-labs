/** Real PostgREST/role proof only in permitted native CI; no local socket
 * fallback, hosted endpoint, source substitution or provider traffic. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {steelReadbackDatabase,readbackSource,withReadbackEnvironment,cannedReadback,one,proofPayload} from './helpers/r12-steel-readback-sql-fixture.mjs';
import {authorizedReadbackFixture,readbackPaidCounts} from './helpers/r12-steel-readback-authorization-fixture.mjs';
import {configureR12HttpRoles,startR12Postgrest} from './helpers/r12-postgrest-http.mjs';
const enabled=process.env.R12_REQUIRE_POSTGREST==='1';
function token(role,sub){const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),data=enc({alg:'HS256',typ:'JWT'})+'.'+enc({role,...(sub?{sub}:{}),exp:Math.floor(Date.now()/1000)+600});return data+'.'+createHmac('sha256','inert-r12-http-qualification-secret-only-0123456789').update(data).digest('base64url');}
test('native PostgREST qualifies one-shot expired-R11 metadata and actual TypeScript action under unchanged role ACLs',{
 skip:enabled?false:'Actual loopback PostgREST requires the permitted native CI environment',timeout:240000,
},async()=>{
 const savedFetch=globalThis.fetch,restore=withReadbackEnvironment(),report={version:'r12.steel-readback-authorization-http.1',trials:[],metadataGets:0,externalProviderCalls:0,passed:false};let db,server,restoreRoles;
 try{
  db=await steelReadbackDatabase();const f=await authorizedReadbackFixture(db),baseline=await readbackPaidCounts(db);process.env.R05_ADMISSION_SERVER_KEY=f.key;
  restoreRoles=await configureR12HttpRoles(db);server=await startR12Postgrest({binary:process.env.R12_POSTGREST_BINARY,databaseUrl:process.env.R12_POSTGRES_URL});
  const request=async(name,args,{role='authenticated',owner=f.ownerId,profile='public'}={})=>{
   const response=await savedFetch(server.base+'/rpc/'+name,{method:'POST',headers:{'content-type':'application/json','content-profile':profile,...(role?{authorization:'Bearer '+token(role,owner)}:{})},body:JSON.stringify(args),signal:AbortSignal.timeout(12000)}),data=await response.json();
   report.trials.push({rpc:name,role:role??'anon',operation:args.p_operation??null,status:response.status,code:response.ok?null:data.code??null});return{data,error:response.ok?null:data,status:response.status};
  };
  const args={p_business_id:f.businessId,p_operation:'claim',p_payload:{targetHash:f.target.targetHash,submissionId:randomUUID()},p_server_key:f.key};
  for(const role of [null,'service_role']){const denied=await request('r12_steel_config_readback_server',args,{role});assert.ok(denied.error);assert.notEqual(denied.status,200);}
  assert.match((await request('r12_steel_config_readback_server',args,{owner:randomUUID()})).error.message,/owner_required/);
  for(const role of [null,'authenticated','service_role']){
   assert.notEqual((await request('r12_steel_publish_readback_authorization',{body:f.authorization},{role})).status,200);
   assert.notEqual((await request('r12_steel_publish_readback_authorization',{body:f.authorization},{role,profile:'private'})).status,200);
   const r=await savedFetch(server.base+'/r12_steel_readback_authorizations',{headers:{authorization:'Bearer '+token(role??'anon',f.ownerId),'accept-profile':'private'}});assert.notEqual(r.status,200);
  }
  const requests=[],provider=cannedReadback(f,requests);globalThis.fetch=async(url,init)=>{assert.equal(new URL(url).origin,'https://api.steel.dev');return provider(url,init);};
  const source=readbackSource(),action=source.load('src/accounts/etsy-steel-readback-owner-server.ts'),context={userId:f.ownerId,businesses:[{id:f.businessId,name:'Inert HTTP metadata Business'}],supabase:{auth:{getClaims:async()=>({data:{claims:{sub:f.ownerId}},error:null})},rpc:async(name,a)=>request(name,a)}};
  const result=await action.runSteelConfigReadback(context,f.businessId,f.target.targetHash);assert.equal(result.status,'verified');assert.equal(requests.length,1);
  assert.deepEqual(Object.keys(result).sort(),['version','businessId','targetHash','status','observedAt','proofHash'].sort());assert.doesNotMatch(JSON.stringify(result),/authorization|approval|credential|serverKey|r11Policy|PRIVATE_SENTINEL/);
  assert.deepEqual(await action.runSteelConfigReadback(context,f.businessId,f.target.targetHash),result);assert.deepEqual(await action.readSteelConfigReadback(context,f.businessId,f.target.targetHash),result);assert.equal(requests.length,1);report.metadataGets=1;
  const claim=await one(db,'select id,claim_hash hash,expires_at from private.r12_steel_readback_claims where target_hash=$1',[f.target.targetHash]);
  const wrong=await request('r12_steel_config_readback_server',{...args,p_operation:'record',p_payload:proofPayload(f,{claim},{version:'wrong'})});assert.ok(wrong.error);
  assert.deepEqual(await readbackPaidCounts(db),baseline);assert.equal((await one(db,'select count(*)::int n from private.r12_steel_readback_claims where target_hash=$1',[f.target.targetHash])).n,1);
  assert.ok(report.trials.some(x=>x.rpc==='r12_steel_config_readback_server'&&x.operation==='record'&&x.status===200));report.passed=true;
 }finally{
  globalThis.fetch=savedFetch;try{await server?.close();await restoreRoles?.();await db?.close();}finally{restore();}
  if(process.env.R12_HTTP_REPORT){const path=resolve(process.env.R12_HTTP_REPORT);assert.ok(path.startsWith('/tmp/r12-http-'));writeFileSync(path,JSON.stringify(report,null,2)+'\n');}
  console.log('One-shot metadata HTTP qualification:',JSON.stringify(report));
 }
});
