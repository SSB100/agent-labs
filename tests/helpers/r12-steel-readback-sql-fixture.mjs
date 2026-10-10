/** Inert metadata-only SQL/TypeScript qualification. This fixture deliberately
 * creates no reviewed route, grant, browser operation, or create authority. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {r04SqlBootstrap} from './r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './r10-sql-fixture.mjs';
import {validateOwnerInitialRaceEnvironment} from './r12-owner-initial-postgres-races.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),require=createRequire(import.meta.url);
export const READBACK_CUTOFF='20261010121400';
export const READBACK_MIGRATION='20261010121400_r12_steel_existing_session_readback.sql';
export const INERT_READBACK_ROOT='inert-readback-existing-root-no-live-access-0123456789';
export const INERT_READBACK_KEY='inert-provider-key-never-transmitted-to-provider';
export const INERT_READBACK_DEPLOYMENT={environment:'production',deploymentId:'dpl_inert_metadata_21400',releaseCommitSha:'1'.repeat(40)};
export const one=async(db,sql,args=[])=>(await db.query(sql,args)).rows[0];
export const sha=x=>createHash('sha256').update(x).digest('hex');
export const readbackMigrations=files=>files.filter(f=>/^\d{14}_.+\.sql$/.test(f)&&f.slice(0,14)<=READBACK_CUTOFF).sort();
/** Load actual current TS, not stale shared .core-tests. Only server-only's
 * bundler marker is inert. All behavior imports execute their real source. */
export function readbackSource(){
 const ts=require('typescript'),cache=new Map();
 const load=file=>{file=resolve(root,file);if(cache.has(file))return cache.get(file).exports;
  assert.ok(file.startsWith(root+'/src/'),'Only application source can be loaded');
  const unit={exports:{}};cache.set(file,unit);
  const compiled=ts.transpileModule(readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','module','exports',compiled)(name=>name==='server-only'?{}:name.startsWith('.')?load(resolve(dirname(file),name+'.ts')):require(name),unit,unit.exports);return unit.exports;};
 return{load,loaded:cache};
}
export const hash=readbackSource().load('src/products/discovery-v2-hash.ts').discoveryV2Hash;
export async function bootstrapReadback(db){
 await db.exec(r04SqlBootstrap+sessionBootstrap);
 const files=readbackMigrations(readdirSync(root+'/supabase/migrations'));
 assert.ok(files.includes(READBACK_MIGRATION),'Final named 21400 migration is required; drafts cannot qualify');
 for(const file of files){try{await db.exec(readFileSync(root+'/supabase/migrations/'+file,'utf8'));}catch(e){e.message=file+': '+e.message+' '+JSON.stringify({where:e.where,position:e.position});throw e;}}
 // Represents the pre-existing deployed R05 root; no metadata-specific key is enrolled.
 await db.query("insert into private.r05_server_keys(key_hash,expires_at) values($1,clock_timestamp()+interval '1 day')",[sha(INERT_READBACK_ROOT)]);
}
export async function steelReadbackDatabase(){
 assert.ok(process.env.R12_SQL_TEST_HOST,'Pinned SQL host required');
 const req=createRequire(resolve(process.env.R12_SQL_TEST_HOST,'package.json'));let db;
 if(process.env.R12_REQUIRE_POSTGRES||process.env.R12_POSTGRES_URL){
  const target=validateOwnerInitialRaceEnvironment(process.env),{Client}=req('pg');db=new Client({connectionString:target.url,ssl:false});await db.connect();db.exec=sql=>db.query(sql);db.close=()=>db.end();
  assert.deepEqual(await one(db,'select current_user actor,current_database() db,host(inet_server_addr()) address'),{actor:'r12_test',db:'r12_test',address:target.address});
  assert.equal((await one(db,"select count(*)::int n from pg_tables where schemaname in ('public','private')")).n,0,'Fresh isolated database required');
 }else{const{PGlite}=req('@electric-sql/pglite'),{pgcrypto}=req('@electric-sql/pglite/contrib/pgcrypto');db=new PGlite({extensions:{pgcrypto}});}
 try{await bootstrapReadback(db);return db;}catch(error){await db.close();throw error;}
}
export const readbackKey=()=>INERT_READBACK_ROOT;
export async function readbackOwner(db){
 const ownerId=randomUUID(),businessId=randomUUID(),providerProjectId=randomUUID();
 await db.query('insert into auth.users(id,email) values($1,$2)',[ownerId,ownerId+'@example.invalid']);
 await db.query('insert into public.businesses(id,owner_user_id,name) values($1,$2,$3)',[businessId,ownerId,'Inert existing metadata read only']);
 return{ownerId,businessId,providerProjectId,key:readbackKey(businessId,ownerId)};
}
export function readbackTarget(f,changes={}){
 const now=Date.now(),configuration={version:'r12.steel-runtime-configuration.1',provider:'steel',baseUrl:'https://api.steel.dev',region:null,providerProjectId:f.providerProjectId,...INERT_READBACK_DEPLOYMENT};
 const body={version:'r12.steel-config-readback-target.1',businessId:f.businessId,ownerId:f.ownerId,providerProjectId:f.providerProjectId,knownSessionId:randomUUID(),knownBefore:new Date(now-30000).toISOString(),observedTerminalState:'Completed',expectedCreatedAt:new Date(now-60000).toISOString(),expectedProviderStatus:'released',configuration,configurationHash:hash(configuration),deploymentEvidenceHash:hash('inert deployment review'),routeReviewHash:hash('inert prospective route review'),tariffEvidenceHash:hash('inert tariff review'),validFrom:new Date(now-1000).toISOString(),expiresAt:new Date(now+600000).toISOString(),...changes};
 delete body.targetHash;return{...body,targetHash:hash(body)};
}
export async function publishReadback(db,target){return(await one(db,'select private.r12_steel_publish_readback_target($1) result',[target])).result;}
export async function readbackFixture(db,changes={}){const f=await readbackOwner(db),target=readbackTarget(f,changes);await publishReadback(db,target);return{...f,target};}
export async function readbackRpc(db,f,name,args,{role='authenticated',ownerId=f.ownerId}={}){
 assert.ok(['authenticated','anon','service_role'].includes(role));assert.ok(['r12_steel_config_readback_server','r12_owner_steel_config_readback'].includes(name));
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ownerId??'']);await db.exec('set role '+role);
 try{return(await one(db,`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).result;}finally{await db.exec('reset role');}
}
export const readbackStatus=(db,f,targetHash=f.target?.targetHash)=>readbackRpc(db,f,'r12_owner_steel_config_readback',[f.businessId,targetHash??null]);
export const readbackServer=(db,f,operation,payload,key=f.key,options)=>readbackRpc(db,f,'r12_steel_config_readback_server',[f.businessId,operation,payload,key],options);
export const claimReadback=(db,f,submissionId=randomUUID())=>readbackServer(db,f,'claim',{targetHash:f.target.targetHash,submissionId});
export function readbackProof(f,claim,changes={}){return{version:'r12.steel-existing-session-readback.1',method:'GET',endpoint:'https://api.steel.dev/v1/sessions/'+f.target.knownSessionId,requestedSessionId:f.target.knownSessionId,returnedSessionId:f.target.knownSessionId,returnedProjectId:f.providerProjectId,providerStatus:'released',sessionCreatedAt:f.target.expectedCreatedAt??new Date(Date.parse(f.target.knownBefore)-1000).toISOString(),observedAt:new Date().toISOString(),responseHash:hash('inert response'),credentialBindingHash:hash('inert credential binding'),configurationHash:f.target.configurationHash,...changes};}
export const proofPayload=(f,claim,proof=readbackProof(f,claim))=>({targetHash:f.target.targetHash,claimId:claim.claim.id,claimHash:claim.claim.hash,proof});
export const readbackCounts=db=>one(db,`select
 (select count(*)::int from private.r12_steel_readback_targets) targets,
 (select count(*)::int from private.r12_steel_readback_claims) claims,
 (select count(*)::int from private.r12_steel_readback_results) results,
 (select count(*)::int from private.r12_steel_config_attestations) attestations,
 (select count(*)::int from private.r12_steel_create_config_permits) permits,
 (select count(*)::int from private.r12_steel_create_config_uses) uses,
 (select count(*)::int from private.r12_direct_browser_routes) routes,
 (select count(*)::int from private.r12_owner_bootstrap_grants) grants,
 (select count(*)::int from private.r12_direct_browser_operations) operations`);
export function readbackOwnerRuntime(db,f,{afterRpc,claimsOwner=f.ownerId,directory=true}={}){
 const source=readbackSource(),server=source.load('src/accounts/etsy-steel-readback-owner-server.ts'),calls=[],sqlErrors=[];
 const context={userId:f.ownerId,businesses:directory?[{id:f.businessId,name:'Inert metadata owner'}]:[],supabase:{auth:{getClaims:async()=>({data:{claims:{sub:claimsOwner}},error:null})},rpc:async(name,args)=>{
  calls.push({name,args:structuredClone(args)});
  try{const data=await readbackRpc(db,f,name,name==='r12_owner_steel_config_readback'?[args.p_business_id,args.p_target_hash]:[args.p_business_id,args.p_operation,args.p_payload,args.p_server_key]);await afterRpc?.({name,args,data});return{data,error:null};}
  catch(error){sqlErrors.push(error.message);return{data:null,error};}
 }}};
 return{server,context,calls,sqlErrors,loaded:source.loaded};
}
export function withReadbackEnvironment(){
 const values={R05_ADMISSION_SERVER_KEY:INERT_READBACK_ROOT,STEEL_API_KEY:INERT_READBACK_KEY,STEEL_API_BASE_URL:'https://api.steel.dev',STEEL_REGION:'',VERCEL_ENV:'production',VERCEL_DEPLOYMENT_ID:INERT_READBACK_DEPLOYMENT.deploymentId,VERCEL_GIT_COMMIT_SHA:INERT_READBACK_DEPLOYMENT.releaseCommitSha};
 const prior=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));Object.assign(process.env,values);
 return()=>{for(const[k,v]of Object.entries(prior))if(v===undefined)delete process.env[k];else process.env[k]=v;};
}
export function cannedReadback(f,requests,{payload,fetcher}={}){return async(url,init)=>{
 requests.push({url,init});assert.equal(url,'https://api.steel.dev/v1/sessions/'+f.target.knownSessionId);assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');assert.equal(init.headers['steel-api-key'],INERT_READBACK_KEY);
 return fetcher?fetcher(url,init):Response.json({id:f.target.knownSessionId,projectId:f.providerProjectId,status:'released',createdAt:f.target.expectedCreatedAt??new Date(Date.parse(f.target.knownBefore)-1000).toISOString(),debugUrl:'https://private.invalid/do-not-disclose',cookies:[{value:'PRIVATE_SENTINEL'}],...payload});
};}
