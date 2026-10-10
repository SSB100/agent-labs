import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {recoverySendFenceParts} from './helpers/r12-recovery-send-freshness.mjs';
const sql=readFileSync(new URL('../supabase/migrations/20261007192502_r12_recovery_send_freshness.sql',import.meta.url),'utf8');
const runtimeSql=readFileSync(new URL('../supabase/migrations/20261007232026_r12_recovery_runtime_deadlines.sql',import.meta.url),'utf8');
test('the recovery send fence follows the final claim/key check and leaves generic controls unchanged',()=>{
 assert.match(sql,/pg_get_functiondef\('public\.r12_discovery_server\(uuid,uuid,text,jsonb,text\)'::regprocedure\)/);
 assert.match(sql,/scope_id=w.scope_id and business_id=p_business_id/);
 assert.match(sql,/marker.lease_epoch=head.lease_epoch/);
 assert.match(sql,/head.lease_expires_at>clock_timestamp\(\)/);
 for(const path of ["authority.valid_until>clock_timestamp()","authority.receipt_until>clock_timestamp()","(p.content->>'deadline')::timestamptz>clock_timestamp()","(p.content->>'expiresAt')::timestamptz>clock_timestamp()","(s.amendment->>'expiresAt')::timestamptz>clock_timestamp()","(w.binding->'quote'->>'verifiedAt')::timestamptz<=clock_timestamp()","(w.binding->'quote'->>'validUntil')::timestamptz>clock_timestamp()"] )assert.ok(sql.includes(path),path);
 assert.match(sql,/replacement:=\$new\$ perform private\.r12_discovery_key\(key_hash\)/);
 assert.match(sql,/r12_recovery_send_definition_drift/);
 assert.doesNotMatch(sql,/grant\s|revoke\s|statement_timeout|lock_timeout|set_config|create function|create or replace function/i);
 assert.equal(sql.match(/execute replace\(d,old,replacement\)/g)?.length,1);
});
test('the final-send fixture reapplies only the exact explicit terminal fence patch',()=>{
 const parts=recoverySendFenceParts(sql,runtimeSql);
 for(const version of ['r12.focused-pilot-unsent-recovery-authorization.1','r12.focused-pilot-terminal-qualification-authorization.1'])assert.ok(parts.currentFence.includes(version));
 assert.equal(parts.currentFence.split(parts.anchor).length,2);
 assert.ok(parts.currentFence.endsWith("return jsonb_build_object('shouldDispatch',true,'reason','claimed_once');"));
 assert.match(parts.reapplyTerminal,/r12_recovery_send_fence_definition_drift/);
 assert.doesNotMatch(parts.reapplyTerminal,/r12_recovery_dispatch|create function|grant execute|statement_timeout/);
 assert.throws(()=>recoverySendFenceParts(sql,runtimeSql+runtimeSql),/Exactly one runtime send patch/);
 assert.throws(()=>recoverySendFenceParts(sql,runtimeSql.replaceAll('r12.focused-pilot-terminal-qualification-authorization.1','unrecognized-authorization')),/assert|false/i);
});

import {resolveRecoverySendImplementation,retargetRecoverySendLookup} from './helpers/r12-recovery-send-freshness.mjs';
test('native fault fixture follows only exact private delegation and retains the real final fence',async()=>{
 const fence=recoverySendFenceParts(sql,runtimeSql).currentFence;
 const publicSignature='public.r12_discovery_server(uuid,uuid,text,jsonb,text)',privateSignature='private.r12_discovery_server_before_funding_proof(uuid,uuid,text,jsonb,text)';
 const wrapper='result:=private.r12_discovery_server_before_funding_proof(p_business_id,p_attempt_id,p_operation,p_payload,p_server_key);',original=`create function exact() returns void as $$ ${fence} $$ language plpgsql`;
 const db={query:async(query,args)=>({rows:[query.includes('has_function_privilege')?{anon:false,authenticated:false,service_role:false}:{definition:args[0]===publicSignature?wrapper:original,proowner:1,proacl:['owner=X/owner'],proconfig:['search_path='],provolatile:'v',prosecdef:true}]})};
 const found=await resolveRecoverySendImplementation(db,fence);assert.equal(found.signature,privateSignature);assert.equal(found.chain.length,2);assert.equal(found.before.definition,original);
 const migrated=retargetRecoverySendLookup(sql,found.signature);assert.equal(migrated.replace(privateSignature,publicSignature),sql);
 assert.throws(()=>retargetRecoverySendLookup(sql,'private.unrelated(uuid,uuid,text,jsonb,text)'));
 for(const definition of [wrapper.replace('p_payload','tampered_payload'),wrapper+wrapper,wrapper.replace('r12_discovery_server_before_funding_proof','other_function')]){
  await assert.rejects(resolveRecoverySendImplementation({query:async()=>({rows:[{definition}]})},fence),/Exactly one unchanged-argument/);
 }
 await assert.rejects(resolveRecoverySendImplementation({query:async(query,args)=>({rows:[query.includes('has_function_privilege')?{anon:true,authenticated:false,service_role:false}:{definition:args[0]===publicSignature?wrapper:original}]})},fence),/alternate RPC/);
});
test('original unwrapped native fence stays supported without a wrapper shortcut',async()=>{
 const fence=recoverySendFenceParts(sql,runtimeSql).currentFence;
 const found=await resolveRecoverySendImplementation({query:async()=>({rows:[{definition:fence,proconfig:['search_path=']}]})},fence);
 assert.equal(found.signature,'public.r12_discovery_server(uuid,uuid,text,jsonb,text)');assert.equal(found.chain.length,1);
 assert.throws(()=>retargetRecoverySendLookup(sql+sql,found.signature),/Exactly one reviewed function lookup/);
});

test('native fault fixture rejects duplicate fences, cycles and excessive wrapper depth',async()=>{
 const fence=recoverySendFenceParts(sql,runtimeSql).currentFence;
 await assert.rejects(resolveRecoverySendImplementation({query:async()=>({rows:[{definition:fence+fence}]})},fence),/Exactly one current final-send fence/);
 const db=cycle=>({query:async(query,args)=>{
  if(query.includes('has_function_privilege'))return{rows:[{anon:false,authenticated:false,service_role:false}]};
  const match=args[0].match(/before_([a-z]+)\(/),name=cycle?'a':match?String.fromCharCode(match[1].charCodeAt(0)+1):'a';
  return{rows:[{definition:`result:=private.r12_discovery_server_before_${name}(p_business_id,p_attempt_id,p_operation,p_payload,p_server_key);`}]};
 }});
 await assert.rejects(resolveRecoverySendImplementation(db(true),fence),/wrapper cycle/);
 await assert.rejects(resolveRecoverySendImplementation(db(false),fence),/wrapper depth/);
});


test('HTTP inputs delay follows the same exact private chain and still calls public RPCs',async()=>{
 const anchor="if p_operation='inputs' then",wrapper='result:=private.r12_discovery_server_before_funding_proof(p_business_id,p_attempt_id,p_operation,p_payload,p_server_key);';
 const db={query:async(query,args)=>({rows:[query.includes('has_function_privilege')?{anon:false,authenticated:false,service_role:false}:{definition:args[0].startsWith('public.')?wrapper:anchor+' return original_inputs;',proowner:1,proacl:['owner=X/owner'],proconfig:['search_path='],provolatile:'v',prosecdef:true}]})};
 const found=await resolveRecoverySendImplementation(db,anchor);assert.equal(found.signature,'private.r12_discovery_server_before_funding_proof(uuid,uuid,text,jsonb,text)');assert.equal(found.chain.length,2);
 const http=readFileSync(new URL('./r12-recovery-postgrest-http.test.mjs',import.meta.url),'utf8');
 assert.match(http,/resolveRecoverySendImplementation\(db,anchor\)/);assert.match(http,/rpc\('r12_discovery_server',ordinaryArgs\)/);assert.match(http,/rpc\('r12_recovery_server',runtimeArgs\)/);
 assert.match(http,/assert.deepEqual\(after,before,/);assert.doesNotMatch(http,/rpc\('private\./);
});
