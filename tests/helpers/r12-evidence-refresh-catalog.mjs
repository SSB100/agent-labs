/** Apply the one definition migration while proving the existing API/ACL catalog is unchanged. */
import assert from 'node:assert/strict';
export async function applyR12EvidenceRefreshWithCatalogCheck(db,sql){
 const functions=async()=>(await db.query("select p.oid,p.oid::regprocedure::text signature,n.nspname schema,pg_get_functiondef(p.oid) definition,p.proowner,p.proacl,p.proconfig,p.provolatile,p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') order by p.oid")).rows;
 const tables=async()=>(await db.query("select c.oid,c.relname,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind in ('r','p','v','m') order by c.oid")).rows;
 const before=await functions(),beforeTables=await tables();await db.exec(sql);const after=await functions(),oldIds=new Set(before.map(f=>f.oid));
 const changed=[];for(const old of before){const current=after.find(f=>f.oid===old.oid);assert.ok(current,old.signature);const left={...old},right={...current};delete left.definition;delete right.definition;assert.deepEqual(right,left,`Existing function permissions/configuration remain exact: ${old.signature}`);if(old.definition!==current.definition)changed.push(old.signature);}
 assert.deepEqual(changed,['private.r12_pilot_unsent_recovery_validate_context(private.r12_discovery_scopes,jsonb)']);
 const added=after.filter(f=>!oldIds.has(f.oid));assert.equal(added.length,1);assert.equal(added[0].signature,'private.r12_pilot_recovery_refresh_validate(private.r12_discovery_scopes,private.r12_discovery_scopes,jsonb)');assert.equal(added[0].prosecdef,false);assert.equal(added[0].provolatile,'s');assert.deepEqual(added[0].proconfig,['search_path=""']);
 for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query("select has_function_privilege($1,$2::oid,'EXECUTE') allowed",[role,added[0].oid])).rows[0].allowed,false);
 assert.equal((await db.query("select exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=$1 and a.grantee=0 and a.privilege_type='EXECUTE') public_execute",[added[0].oid])).rows[0].public_execute,false);
 assert.deepEqual(await tables(),beforeTables);console.log('R12 refresh catalog: one existing private body changed, one nonexposed helper, all old API/ACL/owner/configuration/table policies unchanged.');
}
