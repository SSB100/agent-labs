/** Native, inert verification of the final recovery-only send-time fence.
 * The supplied command must use this same SQL connection/transaction, never HTTP.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

export async function exerciseRecoverySendFreshness({db,metadata,command,payload,controller}){
 assert.equal(process.env.R12_REQUIRE_POSTGRES,'1');
 const target=new URL(process.env.R12_POSTGRES_URL);
 assert.ok(target.protocol==='postgresql:'&&target.hostname==='127.0.0.1'&&target.username==='r12_test'&&target.pathname==='/r12_test'&&!target.search&&!target.hash);
 assert.equal(metadata.authorization.version,'r12.focused-pilot-unsent-recovery-authorization.1');
 const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
 const signature='public.r12_discovery_server(uuid,uuid,text,jsonb,text)';
 const before=await one('select pg_get_functiondef($1::regprocedure) definition,proowner,proacl,proconfig,provolatile,prosecdef from pg_proc where oid=$1::regprocedure',[signature]);
 const migration=readFileSync(new URL('../../supabase/migrations/20261007192502_r12_recovery_send_freshness.sql',import.meta.url),'utf8');
 const old=migration.match(/old:=\$old\$([\s\S]*?)\$old\$;/)[1],replacement=migration.match(/replacement:=\$new\$([\s\S]*?)\$new\$;/)[1];
 assert.equal(before.definition.split(replacement).length,2);
 const catalog=async()=>(await db.query("select p.oid,pg_get_functiondef(p.oid) definition,p.proowner,p.proacl,p.proconfig,p.provolatile,p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') order by p.oid")).rows;
 const migrated=await catalog();
 await db.exec('savepoint recovery_send_catalog');
 try{
  await db.exec(before.definition.replace(replacement,()=>old));
  const original=await catalog();
  assert.equal(original.filter((row,index)=>row.definition!==migrated[index].definition).length,1);
  for(const [index,row]of original.entries()){const left={...row},right={...migrated[index]};delete left.definition;delete right.definition;assert.deepEqual(left,right);}
  await db.exec(migration.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,''));
  assert.deepEqual(await catalog(),migrated,'The guarded migration changes only the intended function body, with all original ACLs/configuration intact');
 }finally{await db.exec('rollback to savepoint recovery_send_catalog');await db.exec('release savepoint recovery_send_catalog');}
 const anchor=' if exists(select 1 from private.r12_pilot_unsent_recovery_authorizations where scope_id=w.scope_id and business_id=p_business_id) then';
 assert.equal(before.definition.split(anchor).length,2);
 const claims=()=>one('select count(*)::int count from private.r12_discovery_transport_claims where request_id=(select request_id from private.r07_bindings where attempt_id=$1)',[payload.attemptId]);
 const financial=()=>one(`select
  (select to_jsonb(m) from private.r05_markers m where m.request_id=r.id) admission_marker,
  (select to_jsonb(m) from private.r07_markers m where m.attempt_id=$1) controller_marker,
  (select jsonb_agg(to_jsonb(z) order by z.id) from private.r05_settlements z where z.request_id=r.id) settlements,
  (select to_jsonb(z) from private.r05_releases z where z.request_id=r.id) released,
  (select to_jsonb(ex) from private.r05_exposure(r.business_id) ex where ex.source_key=r.source_key) exposure
  from private.r05_requests r join private.r07_bindings b on b.request_id=r.id where b.attempt_id=$1`,[payload.attemptId]);
 const send=async()=>{
  await db.exec('savepoint recovery_send_rpc');
  try{await db.exec('set role anon');return(await one('select public.r12_discovery_server($1,$2,$3,$4,$5) result',[metadata.businessId,payload.attemptId,'send',{wireHash:payload.wireHash},controller])).result;}
  catch(error){await db.exec('rollback to savepoint recovery_send_rpc');throw error;}
  finally{await db.exec('reset role');await db.exec('release savepoint recovery_send_rpc');}
 };
 const faults=[
  ['lease_expired_after_full_validation',"update private.r07_heads set lease_expires_at=clock_timestamp()-interval '1 microsecond' where business_id=p_business_id and goal_id=a.goal_id;"],
  ['quote_expired_after_full_validation',"w.binding:=jsonb_set(w.binding,'{quote,validUntil}',to_jsonb((clock_timestamp()-interval '1 microsecond')::text));"],
  ['quote_not_yet_valid_at_return',"w.binding:=jsonb_set(w.binding,'{quote,verifiedAt}',to_jsonb((clock_timestamp()+interval '1 minute')::text));"],
  ['scope_expired_after_full_validation',"s.amendment:=jsonb_set(s.amendment,'{expiresAt}',to_jsonb((clock_timestamp()-interval '1 microsecond')::text));"],
  ['authority_expired_after_full_validation',"alter table private.r12_discovery_authorities disable trigger all; update private.r12_discovery_authorities authority set valid_until=cut.deadline,receipt_until=cut.deadline+interval '30 minutes' from (select clock_timestamp()-interval '1 microsecond' deadline) cut where authority.scope_id=w.scope_id and authority.business_id=p_business_id; alter table private.r12_discovery_authorities enable trigger all;"],
 ];
 const result={providerCalls:0,transportCalls:0,statementTimeoutMs:3000,sendMs:null,guards:[]};
 await db.exec('savepoint recovery_send_freshness');
 try{
  const lease=await command('claim',{seconds:60});
  const dispatched=await command('dispatch',payload,Number(lease.epoch));assert.equal(dispatched.shouldDispatch,true);
  assert.deepEqual(await claims(),{count:0});
  const held=await financial();assert.ok(held.admission_marker&&held.controller_marker&&held.exposure);assert.equal(held.released,null);
  await db.exec('savepoint recovery_send_happy');
  try{
   await db.exec("set local statement_timeout='3s'");const start=performance.now();
   assert.deepEqual(await send(),{shouldDispatch:true,reason:'claimed_once'});
   result.sendMs=Math.round(performance.now()-start);assert.ok(result.sendMs<3000);
   assert.deepEqual(await claims(),{count:1});
   assert.deepEqual(await financial(),held);
  }finally{await db.exec('rollback to savepoint recovery_send_happy');await db.exec('release savepoint recovery_send_happy');}
  for(const [name,fault]of faults){
   await db.exec('savepoint recovery_send_expiry');
   try{
    await command('claim',{seconds:60});
    // Deliberate faults execute only after every original send validation and
    // after the tentative claim. Each rejected RPC must roll all of it back.
    await db.exec(before.definition.replace(anchor,()=>` ${fault}\n${anchor}`));
    await db.exec("set local statement_timeout='3s'");
    await assert.rejects(send(),/r12_recovery_send_window_changed/);
    assert.deepEqual(await claims(),{count:0});assert.deepEqual(await financial(),held,'Send rejection retains both committed dispatch markers and the full unresolved financial exposure');result.guards.push(name);
   }finally{await db.exec('rollback to savepoint recovery_send_expiry');await db.exec('release savepoint recovery_send_expiry');}
  }
 }finally{await db.exec('rollback to savepoint recovery_send_freshness');await db.exec('release savepoint recovery_send_freshness');}
 assert.deepEqual(await one('select pg_get_functiondef($1::regprocedure) definition,proowner,proacl,proconfig,provolatile,prosecdef from pg_proc where oid=$1::regprocedure',[signature]),before);
 assert.deepEqual(await claims(),{count:0});
 console.log('R12 final recovery send freshness:',JSON.stringify(result));return result;
}
