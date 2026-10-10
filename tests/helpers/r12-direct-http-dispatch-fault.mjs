/** Test-only rollback fault. Resolves the exact authenticated mode router;
 * provider HTTP still enters the public anonymous RPC. Never production code. */
import assert from 'node:assert/strict';
import {one} from './r12-owner-initial-sql-fixture.mjs';
const normalize=value=>value.trim().replace(/\s+/g,' ');
const router="begin if private.r12_direct_is_repair_scope(p_scope) then return private.r12_direct_repair_dispatch(p_scope,payload);end if;return private.r12_direct_dispatch_v1(p_scope,payload);end";
const predicate="select coalesce((select policy->>'version'='r12.direct-etsy-attempt-policy.2' from private.r12_direct_research_setups where scope_id=p_scope),false)";
const metadata=`select p.oid::text oid,p.proowner::text owner,p.proacl::text acl,p.proconfig config,p.provolatile volatility,p.prosecdef security_definer,p.proisstrict strict,p.proparallel parallel,p.proleakproof leakproof,
 pg_get_function_identity_arguments(p.oid) arguments,pg_get_function_result(p.oid) result,p.prosrc source,pg_get_functiondef(p.oid) definition,
 has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,has_function_privilege('service_role',p.oid,'EXECUTE') service,
 exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') public_execute
 from pg_proc p where p.oid=$1::regprocedure`;
const anchor="return jsonb_build_object('shouldDispatch',true";
export async function installDirectHttpDispatchFault(db,scopeId,expectedPolicyVersion){
 assert.ok(['r12.direct-etsy-attempt-policy.1','r12.direct-etsy-attempt-policy.2'].includes(expectedPolicyVersion));
 const repair=expectedPolicyVersion==='r12.direct-etsy-attempt-policy.2';
 const signatures=['private.r12_direct_dispatch(uuid,jsonb)','private.r12_direct_is_repair_scope(uuid)',repair?'private.r12_direct_repair_dispatch(uuid,jsonb)':'private.r12_direct_dispatch_v1(uuid,jsonb)'];
 const before=await Promise.all(signatures.map(signature=>one(db,metadata,[signature])));
 assert.equal(normalize(before[0].source),router,'Exact mode router, no guessed delegate traversal');
 assert.equal(normalize(before[1].source),predicate,'Exact immutable scope-version predicate');
 assert.deepEqual(await one(db,"select policy->>'version' version,private.r12_direct_is_repair_scope(scope_id) repair from private.r12_direct_research_setups where scope_id=$1",[scopeId]),{version:expectedPolicyVersion,repair});
 for(const [index,row]of before.entries()){
  assert.equal(row.owner,before[0].owner);assert.deepEqual(row.config,['search_path=""']);assert.equal(row.security_definer,false);assert.equal(row.strict,false);
  assert.equal(row.volatility,index===1?'s':'v');assert.equal(row.result,index===1?'boolean':'jsonb');
  for(const key of ['anon','authenticated','service','public_execute'])assert.equal(row[key],false,'Private dispatcher helper must stay inaccessible: '+key);
 }
 assert.equal(before[2].definition.split(anchor).length,2,'Exactly one actual post-marker return');
 const markerIndex=before[2].definition.indexOf('private.r12_direct_mark_phase(a)'),returnIndex=before[2].definition.indexOf(anchor);
 assert.ok(markerIndex>=0&&markerIndex<returnIndex,'Delay follows an actual durable marker, never a missing anchor');
 await db.exec(before[2].definition.replace(anchor,'perform pg_sleep(4);'+anchor));
 let restored=false;
 return{signature:signatures[2],async restore(){
  if(restored)return;await db.exec(before[2].definition);
  for(let i=0;i<signatures.length;i++)assert.deepEqual(await one(db,metadata,[signatures[i]]),before[i],'Restore exact OID/body/owner/ACL/config and retain router: '+signatures[i]);
  restored=true;
 }};
}
