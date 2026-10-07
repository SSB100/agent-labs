/** Isolated PostgreSQL-only dispatch benchmark. Never reads private operator files. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const migration='20261007093053_r12_successor_source_reuse.sql';
export function originalSuccessorDefinitions(){
 const released=readFileSync(path.join(root,'supabase/migrations/20261007071106_r12_focused_pilot_successor.sql'),'utf8');
 return ['closure','validate','source'].map(name=>{
  const pattern=new RegExp(`create function private\\.r12_pilot_successor_${name}\\([\\s\\S]*?\\nend \\$\\$;`);
  const match=released.match(pattern);assert.ok(match,`Frozen ${name} definition required`);
  return match[0].replace('create function','create or replace function');
 }).join('\n');
}
function candidateSql(){return readFileSync(path.join(root,'supabase/migrations',migration),'utf8').replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'');}
export async function exerciseFullShapeDispatch({db,metadata,command,payload}){
 assert.equal(process.env.R12_REQUIRE_POSTGRES,'1','Full-shape deadline needs actual PostgreSQL');
 const target=new URL(process.env.R12_POSTGRES_URL);
 assert.equal(target.hostname,'127.0.0.1');assert.equal(target.username,'r12_test');assert.equal(target.pathname,'/r12_test');
 if(process.env.R12_CI_POSTGRES_ADDRESS){assert.equal(process.env.CI,'true');assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(target.port,'5432');assert.equal(target.password,'r12-isolated-fixture');}
 const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
 const sid=metadata.scopeId,predecessor=metadata.closedFocused.scopeId;
 const identity=await one('select current_user, current_database(), host(inet_server_addr()) host, version()');
 assert.equal(identity.current_user,'r12_test');assert.equal(identity.current_database,'r12_test');assert.equal(identity.host,process.env.R12_CI_POSTGRES_ADDRESS??'127.0.0.1');assert.match(identity.version,/PostgreSQL 17\./);
 const report={version:'r12.synthetic-full-shape-dispatch.1',postgres:identity.version,statementTimeoutMs:3000,providerCalls:0,transportCalls:0,trials:[],guards:[]};
 // First invocation means cold function plans after definition replacement,
 // not an unsupported claim that the server or OS page cache was flushed.
 const fingerprint=async()=>one(`select
 (select jsonb_agg(to_jsonb(x) order by x.id) from private.r07_attempts x where x.goal_id=$1) attempts,
 (select to_jsonb(x) from private.r07_heads x where x.goal_id=$1) head,
 (select jsonb_agg(to_jsonb(x) order by x.request_id) from private.r05_markers x) financial_markers,
 (select jsonb_agg(to_jsonb(x) order by x.attempt_id) from private.r07_markers x) controller_markers,
 (select jsonb_agg(to_jsonb(x) order by x.request_id) from private.r12_discovery_transport_claims x) claims,
 (select jsonb_agg(to_jsonb(x) order by x.id) from private.r05_settlements x) settlements,
 private.stage13v2_budget_authority($2,false) budget`,[metadata.goalId,metadata.focusedProfile.budgetAuthorityRootId]);
 await db.exec("set local track_functions='all'");
 const counters=async()=>Object.fromEntries((await db.query("select funcname,calls,total_time from pg_stat_xact_user_functions where schemaname in ('private','public') and (funcname like 'r12_pilot_%' or funcname in ('r12_discovery_scope_current','r07_gate','stage14_hash','stage14_canonical','r04_hash','r04_safe'))")).rows.map(x=>[x.funcname,{calls:Number(x.calls),totalMs:Number(x.total_time)}]));
 const initial=await fingerprint();
 const trial=async(label,mutate=null)=>{
  await db.exec('savepoint full_shape_trial');let outcome;
  try{
   // Claim is outside the measured dispatch. Setup and previous timings must
   // not accidentally consume its original sixty-second controller lease.
   const claim=await command('claim',{seconds:60});
   if(mutate)await mutate();
   await db.exec("set local statement_timeout='3s'");
   const beforeCounters=await counters(),started=performance.now();
   try{const value=await command('dispatch',payload,Number(claim.epoch));outcome={label,elapsedMs:Math.round(performance.now()-started),result:value,timeout:false};}
   catch(error){outcome={label,elapsedMs:Math.round(performance.now()-started),error:error.message,sqlState:error.code??null,timeout:error.code==='57014'};}
   const afterCounters=await counters();outcome.functions=Object.fromEntries(Object.entries(afterCounters).map(([name,row])=>[name,{calls:row.calls-(beforeCounters[name]?.calls??0),totalMs:Math.round((row.totalMs-(beforeCounters[name]?.totalMs??0))*100)/100}]).filter(([,row])=>row.calls));
   if(outcome.result?.shouldDispatch){assert.equal(outcome.functions.r12_discovery_scope_current?.calls,7,'All seven outer scope boundaries remain');assert.equal(outcome.functions.r07_gate?.calls,3,'All three gate boundaries remain');}
  }finally{await db.exec('rollback to savepoint full_shape_trial');await db.exec('release savepoint full_shape_trial');}
  assert.deepEqual(await fingerprint(),initial,'Every trial restores markers, transport claims, attempt state, settlement and cumulative funding');
  report.trials.push(outcome);console.log('R12 full-shape trial:',JSON.stringify(outcome));return outcome;
 };
 const sourceAt=async(at,current=true)=>(await one('select private.r12_pilot_successor_source(s,$2::timestamptz,$3) result from private.r12_discovery_scopes s where id=$1',[sid,at,current])).result;
 const at=new Date().toISOString();
 await db.exec('savepoint full_shape_definitions');
 try{
  await db.exec(originalSuccessorDefinitions());
  await db.exec('discard plans');
  const baselineCold=await trial('baseline_first_call');
  const baselineWarm=await trial('baseline_warm');
  for(const baseline of [baselineCold,baselineWarm]){if(baseline.error)assert.equal(baseline.sqlState,'57014',baseline.error);else assert.equal(baseline.result.shouldDispatch,true);}
  await db.exec("set local statement_timeout='30s'");
  const baselineSource=await sourceAt(at);
  const baselineClosure=(await one('select private.r12_pilot_successor_closure($1) result',[predecessor])).result;
  const shape=await one('select octet_length(amendment::text) scope_bytes,octet_length((amendment->\'profile\')::text) profile_bytes from private.r12_discovery_scopes where id=$1',[sid]);
  const sourceBytes=(await one('select octet_length($1::jsonb::text) bytes',[baselineSource.acceptedReview])).bytes;
  const jsonShape=value=>{const counts={nodes:0,keys:0,strings:0,stringBytes:0,objects:0,arrays:0,scalars:0};const visit=v=>{counts.nodes++;if(Array.isArray(v)){counts.arrays++;v.forEach(visit);}else if(v&&typeof v==='object'){counts.objects++;counts.keys+=Object.keys(v).length;Object.values(v).forEach(visit);}else{counts.scalars++;if(typeof v==='string'){counts.strings++;counts.stringBytes+=Buffer.byteLength(v);}}};visit(value);return counts;};
  report.shape={scopeStructure:jsonShape(metadata.focusedEnvelope),historicalSourceStructure:jsonShape(baselineSource.acceptedReview),completeSourceStructure:jsonShape(baselineSource),scopeBytes:shape.scope_bytes,profileBytes:shape.profile_bytes,historicalSourceBytes:sourceBytes,observations:metadata.focusedProfile.observations.observations.length,classifiedQuestions:metadata.focusedProfile.history.record.priorCandidateUncertainties.reduce((n,c)=>n+c.dimensions.reduce((m,d)=>m+d.uncertainties.length,0),0)};
  const accepted=baselineSource.acceptedReview;
  for(const phase of [...accepted.inputs.dependencies,accepted.current]){assert.deepEqual(Object.keys(phase.binding.request.providerPriceLimit).sort(),['completion','prompt','request'],'Every actual historical request includes its three-key provider price limit');}
  report.shape.requestStructures=Object.fromEntries([...accepted.inputs.dependencies,accepted.current].map(phase=>[phase.stepKey,{keys:Object.keys(phase.binding.request).sort(),providerPriceLimit:jsonShape(phase.binding.request.providerPriceLimit)}]));
  report.shape.branches={context:jsonShape(accepted.context),current:jsonShape(accepted.current),...Object.fromEntries(accepted.inputs.dependencies.map(dep=>['dependency_'+dep.stepKey,jsonShape(dep)])),...Object.fromEntries(['knowledgeSnapshot','original','amendment','sourceAmendment'].map(key=>[key,jsonShape(accepted.inputs[key])]))};
  report.shape.completeSourceBytes=(await one('select octet_length($1::jsonb::text) bytes',[baselineSource])).bytes;
  console.log('R12 full-shape dimensions:',JSON.stringify(report.shape));
  await db.exec(candidateSql());
  await db.exec('discard plans');
  const candidateCold=await trial('candidate_first_call');
  const candidateWarm=await trial('candidate_warm');
  for(const trial of [candidateCold,candidateWarm]){assert.equal(trial.timeout,false,trial.label);assert.equal(trial.error,undefined,trial.error);assert.equal(trial.result.shouldDispatch,true,JSON.stringify(trial.result));assert.ok(trial.elapsedMs<3000);}
  for(const trial of [baselineCold,baselineWarm])if(!trial.error)assert.deepEqual(trial.result,candidateWarm.result,'Dispatch result is unchanged');
  assert.deepEqual(await sourceAt(at),baselineSource,'Within-call reuse preserves the full source, all original timestamps, normalized history and authorization');
  assert.deepEqual((await one('select private.r12_pilot_successor_closure($1) result',[predecessor])).result,baselineClosure,'Canonical closure and all financial proof hashes remain identical');
  report.guards.push('source_and_closure_exact_equality','trial_financial_rollback');
  // Rebind only the validator's local predecessor argument in a savepoint.
  // The exact original validator must reject a future creation at closure's
  // wall clock, and a creation after a caller's historical effective time.
  // No persisted proof, hash chain, scope, timestamp or production code changes.
  const originalProfileDefinition=(await one("select pg_get_functiondef('private.r12_pilot_profile_validate(private.r12_discovery_scopes,timestamptz,boolean)'::regprocedure) definition")).definition;
  const probeClock=async(kind)=>{
   await db.exec('savepoint full_shape_clock_probe');
   try{
    await db.exec(originalProfileDefinition.replace('FUNCTION private.r12_pilot_profile_validate(', 'FUNCTION private.r12_full_shape_profile_validate_original('));
    const now=Date.now(),target=new Date(now+(kind==='closure_clock'?60000:-1000)).toISOString();
    const syntheticCreated=new Date(now+(kind==='closure_clock'?30000:-500)).toISOString();
    await db.exec(`create or replace function private.r12_pilot_profile_validate(s private.r12_discovery_scopes,effective_at timestamptz,p_current boolean default true) returns void language plpgsql stable set search_path='' as $$ begin
     if s.id='${predecessor}'::uuid then
      s.amendment:=jsonb_set(jsonb_set(s.amendment,'{createdAt}',to_jsonb('${syntheticCreated}'::text)),'{profile,createdAt}',to_jsonb('${syntheticCreated}'::text));
      s.amendment:=jsonb_set(s.amendment,'{profileHash}',to_jsonb(private.stage14_hash(s.amendment->'profile')));
      s.amendment_hash:=private.stage14_hash(s.amendment);
     end if;
     perform private.r12_full_shape_profile_validate_original(s,effective_at,p_current);
    end $$;`);
    await assert.rejects(()=>sourceAt(target,false),/r12_pilot_window/);
    report.guards.push(kind+'_window_guard');
   }finally{await db.exec('rollback to savepoint full_shape_clock_probe');await db.exec('release savepoint full_shape_clock_probe');}
  };
  await probeClock('closure_clock');await probeClock('caller_effective_time');
  for(const role of ['anon','authenticated','service_role'])for(const fn of ['private.r12_pilot_successor_closure_context(uuid)','private.r12_pilot_successor_validate_context(private.r12_discovery_scopes,jsonb)']){
   const acl=await one('select has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,fn]);assert.equal(acl.allowed,false);
  }
  const properties=await db.query("select proname,provolatile,prosecdef,proconfig from pg_proc where oid in ('private.r12_pilot_successor_closure_context(uuid)'::regprocedure,'private.r12_pilot_successor_validate_context(private.r12_discovery_scopes,jsonb)'::regprocedure)");
  assert.equal(properties.rows.length,2);for(const row of properties.rows){assert.equal(row.provolatile,'s');assert.equal(row.prosecdef,false);assert.ok(row.proconfig.some(x=>x==='search_path=""'));}
  report.guards.push('private_invoker_stable_acl');
  const rejected=async(name,action,pattern)=>{
   await db.exec('savepoint full_shape_rejection');try{await assert.rejects(action,pattern);}finally{await db.exec('rollback to savepoint full_shape_rejection');await db.exec('release savepoint full_shape_rejection');}report.guards.push(name);
  };
  const expired=new Date(Date.parse(metadata.focusedEnvelope.expiresAt)+1000).toISOString();
  await rejected('current_timestamp_expiry',()=>sourceAt(expired,true),/r12_pilot_window/);
  assert.deepEqual(await sourceAt(expired,false),baselineSource,'Historical inspection never redates source/profile/observation timestamps');report.guards.push('historical_timestamps_unchanged');
  await rejected('effective_timestamp_before_creation',()=>sourceAt(new Date(Date.parse(metadata.focusedEnvelope.createdAt)-1000).toISOString(),false),/r12_pilot_window/);
  await rejected('credential_scan',()=>db.query(`select private.r12_pilot_profile_validate((jsonb_populate_record(null::private.r12_discovery_scopes,to_jsonb(s)||jsonb_build_object('amendment',jsonb_set(amendment,'{profile,history,scopeChangeExplanation}',to_jsonb('Bearer syntheticcredentialfixture1234'::text))))),$2::timestamptz,true) from private.r12_discovery_scopes s where id=$1`,[sid,at]),/r04_credential_content_rejected/);
  await rejected('profile_hash_binding',()=>db.query(`select private.r12_pilot_profile_validate((jsonb_populate_record(null::private.r12_discovery_scopes,to_jsonb(s)||jsonb_build_object('amendment_hash',repeat('0',64)))),$2::timestamptz,true) from private.r12_discovery_scopes s where id=$1`,[sid,at]),/r12_pilot_profile_identity/);
  // A successful source read grants no authority to a later statement. Mutate
  // trusted synthetic fixture state between read and dispatch to test TOCTOU.
  await sourceAt(at);
  const changedOwner=await trial('owner_changed_after_source_read',()=>db.query('update public.businesses set owner_user_id=$1 where id=$2',['95050000-0000-4000-8000-000000000002',metadata.businessId]));
  assert.equal(changedOwner.timeout,false);assert.match(changedOwner.error??JSON.stringify(changedOwner.result),/owner|authority|scope/i);report.guards.push('owner_toctou');
  await sourceAt(at);
  await rejected('settlement_toctou',async()=>{
   await db.exec('alter table private.r05_settlements disable trigger all');
   await db.query('delete from private.r05_settlements where request_id=$1',[baselineClosure.phases[1].requestId]);
   await sourceAt(at);
  },/r12_successor_predecessor_settlement_required/);
  assert.deepEqual(await fingerprint(),initial);
  report.passed=false;
  const writeReport=()=>{if(process.env.R12_FULL_SHAPE_REPORT){const dest=path.resolve(process.env.R12_FULL_SHAPE_REPORT);assert.ok(dest.startsWith('/tmp/r12-full-shape-'),'Report must use a designated synthetic /tmp path');writeFileSync(dest,JSON.stringify(report,null,2)+'\n');}};
  writeReport();console.log('R12 full-shape measured:',JSON.stringify(report));
  assert.ok(shape.scope_bytes>=30000&&shape.scope_bytes<=38000,`Expected a realistic approximately 32KB scope, got ${shape.scope_bytes}`);
  // The production-size reference is approximately 212KB, but prose/model
  // metadata can legitimately differ. Require the measured validation fan-out
  // and a 200KB anti-tiny-fixture floor, rather than padding to an exact size.
  assert.ok(report.shape.completeSourceBytes>=200000&&report.shape.completeSourceBytes<=230000,`Expected an approximately 212KB complete historical source, got ${report.shape.completeSourceBytes}`);
  assert.deepEqual(accepted.inputs.dependencies.map(phase=>phase.stepKey),['plan','search1','select1','strategy']);
  assert.equal(accepted.current.stepKey,'review');
  assert.equal(accepted.inputs.sourceAmendment.allowedDomains.length,2);
  assert.equal(accepted.inputs.sourceAmendment.sourceReviews.length,2);
  assert.equal(metadata.focusedProfile.history.record.sourceHistory.sources.length,3);
  assert.equal(report.shape.observations,5);assert.equal(report.shape.classifiedQuestions,27);
  const historicalStrategy=accepted.inputs.dependencies.find(phase=>phase.stepKey==='strategy').candidate.output;
  assert.equal(historicalStrategy.candidates.length,3);
  assert.ok(historicalStrategy.candidates.every(candidate=>candidate.dimensions.length===9));
  assert.equal(historicalStrategy.candidates.flatMap(candidate=>candidate.dimensions).reduce((n,dimension)=>n+dimension.facts.length,0),9);
  assert.equal(accepted.current.candidate.output.additionalUncertainties.length,9);
  report.passed=true;writeReport();
  console.log('R12 full-shape passed:',JSON.stringify(report));
  return report;
 }finally{await db.exec('rollback to savepoint full_shape_definitions');await db.exec('release savepoint full_shape_definitions');}
}
