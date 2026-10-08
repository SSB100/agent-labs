/** Real owner preparation/confirmation/Stop source against isolated SQL only. */
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url)),require=createRequire(import.meta.url),ts=require('typescript');
// Owner-source preparation runs inside the fixture boundary process as well as
// the separately configured Next child. It must never inherit host credentials.
const inertProcess=Object.freeze({env:Object.freeze({VERCEL_ENV:'production',R05_ADMISSION_SERVER_KEY:'inert-r12-owner-root-configuration-0123456789',OPENROUTER_API_KEY:'inert-r12-provider-placeholder'})});
export function pilotOwnerSqlApi(db,businessId,ownerId){
 const signatures={r05_admission_read:['p_business_id','p_policy_id','p_limit','p_offset'],r04_quest_transition:['p_business_id','p_operation','p_payload','p_submission_id'],r04_quest_read:['p_business_id','p_goal_id','p_limit','p_offset'],r12_discovery_owner_read:['p_business_id','p_scope_id','p_activation'],r12_discovery_result_read:['p_business_id','p_scope_id'],r12_review_owner_read:['p_business_id','p_scope_id'],r12_review_owner_confirm:['p_business_id','p_scope_id','p_proposal_hash'],r05_policy_owner:['p_business_id','p_operation','p_payload','p_submission_id']};
 const calls=[],context={userId:ownerId,businesses:[{id:businessId,name:'Isolated R12 owner'}],supabase:{auth:{getClaims:async()=>({data:{claims:{sub:ownerId}},error:null})},rpc:async(name,args)=>{
  assert.ok(Object.hasOwn(signatures,name),name);calls.push({name,args});await db.exec('savepoint pilot_source_owner');
  try{await db.exec('set role authenticated');const params=signatures[name].map(key=>args[key]??null);return{data:(await db.query(`select public.${name}(${params.map((_,i)=>`$${i+1}`).join(',')}) result`,params)).rows[0].result,error:null};}
  catch(error){await db.exec('rollback to savepoint pilot_source_owner');return{data:null,error};}
  finally{await db.exec('reset role');await db.exec('release savepoint pilot_source_owner');}
 }}};
 const cache=new Map();
 const source=file=>{
  if(cache.has(file))return cache.get(file);
  const loaded={exports:{}};cache.set(file,loaded.exports);
  new Function('require','module','exports','process',ts.transpileModule(readFileSync(path.join(root,'src',file+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{
   if(name==='server-only')return{};if(name.startsWith('node:'))return require(name);
   if(name==='./discovery-r12-server-dependencies')return{discoveryR12ServerDependencies:()=>{throw Error('Owner preparation and Stop must never load provider dependencies');}};
   assert.ok(name.startsWith('.'),name);const target=path.posix.normalize(path.posix.join(path.posix.dirname(file),name)),compiled=path.join(root,'.core-tests',target+'.js');
   return existsSync(compiled)?require(compiled):source(target);
  },loaded,loaded.exports,inertProcess);cache.set(file,loaded.exports);return loaded.exports;
 };
 return{context,calls,preparation:source('products/discovery-r12-pilot-preparation-server'),confirmation:source('products/discovery-r12-review-preparation-server'),server:source('products/discovery-r12-server')};
}
