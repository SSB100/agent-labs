/** One explicitly approved terminal technical qualification Goal. Frozen original recipe strings remain
 * unchanged; the exact immutable sidecar is staged atomically before them.
 * No import effects, provider calls, secrets, retries or implicit authority. */
import {STAGING_SQL as ORIGINAL_STAGE,ACTIVATION_SQL as ORIGINAL_ACTIVATE,CLOSE_SQL as ORIGINAL_CLOSE} from './r12-focused-pilot-bootstrap.mjs';

const prefix=(kind)=>`DO $recovery$ DECLARE x jsonb;v jsonb;e jsonb;s private.r12_discovery_scopes;a private.r12_pilot_technical_qualification_authorizations;closed jsonb;BEGIN
 select payload into strict x from pg_temp.r12_bootstrap_input;
 if current_user in ('anon','authenticated','service_role') then raise exception 'r12_terminal_qualification_operator_required';end if;
 ${kind==='stage'?`
 perform private.r04_keys(x,array['envelope','proposal','quote','executionReviewHash','eligibilityReviewHash','terminalAuthorization']);
 v:=x->'terminalAuthorization';e:=x->'envelope';
 s:=jsonb_populate_record(null::private.r12_discovery_scopes,jsonb_build_object('id',e->>'id','business_id',e->>'businessId','goal_id',e->>'goalId','budget_authority_root_id',e->>'budgetAuthorityRootId','prior_round_id',e->>'priorRoundId','amendment',e,'amendment_hash',private.stage14_hash(e)));
 perform 1 from public.businesses where id=s.business_id and owner_user_id=(v->>'ownerId')::uuid for update;
 if not found then raise exception 'r12_terminal_qualification_owner_required';end if;
 perform 1 from public.product_experiments where id=s.budget_authority_root_id and business_id=s.business_id for update;
 if not found then raise exception 'r12_terminal_qualification_root_required';end if;
 closed:=private.r12_pilot_terminal_validate(s,v);
 if exists(select 1 from private.r12_discovery_authorities prior where prior.scope_id=(closed->>'scopeId')::uuid
 and prior.execution_review_hash=x->>'executionReviewHash')
 or exists(select 1 from private.r05_operations op where op.operation_key in('research.r12.'||(closed->>'scopeId')||'.strategy','research.r12.'||(closed->>'scopeId')||'.review')
 and op.eligibility_hash=x->>'eligibilityReviewHash')
 then raise exception 'r12_terminal_qualification_fresh_execution_review_required';end if;

 if x->'proposal'->'operatingPolicy'->>'businessLifetimeLimitMicrounits' is distinct from
 (select payload->'after'->>'businessCapMicrousd' from private.r07_events where id=(closed->>'reconciliationEventId')::bigint)
 or x->'proposal'->'operatingPolicy'->>'businessLifetimeLimitMicrounits' is distinct from
 (select maximum_microunits::text from private.r05_cap_versions where business_id=s.business_id and currency='USD' order by revision desc limit 1)
 then raise exception 'r12_terminal_qualification_unchanged_business_cap_required';end if;
 if x->'proposal'->>'interpretationHash' is distinct from private.stage14_hash(v) then raise exception 'r12_terminal_qualification_owner_proof_required';end if;
 insert into private.r12_pilot_technical_qualification_authorizations(scope_id,business_id,failed_recovery_scope_id,budget_authority_root_id,reconciliation_event_id,authorization_data,authorization_hash)
 values(s.id,s.business_id,(closed->>'scopeId')::uuid,s.budget_authority_root_id,(closed->>'reconciliationEventId')::bigint,v,private.stage14_hash(v));
 update pg_temp.r12_bootstrap_input set payload=x-'terminalAuthorization';
 `:`
 perform private.r04_keys(x,array[${kind==='activate'?"'businessId','scopeId','scopeHash','proposalHash','policyId','policyHash','quote','executionReviewHash','eligibilityReviewHash','controllerKeyHash','admissionKeyHash'":"'businessId','scopeId','scopeHash','policyId','policyHash','planHash'"},'terminalAuthorizationHash']);
 select * into s from private.r12_discovery_scopes where id=(x->>'scopeId')::uuid and business_id=(x->>'businessId')::uuid;
 perform 1 from public.businesses where id=s.business_id for update;
 select * into a from private.r12_pilot_technical_qualification_authorizations where scope_id=s.id and business_id=s.business_id;
 if a.scope_id is null or a.authorization_hash is distinct from x->>'terminalAuthorizationHash' or a.authorization_hash is distinct from private.stage14_hash(a.authorization_data)
 then raise exception 'r12_terminal_qualification_exact_authorization_required';end if;
 ${kind==='activate'?`closed:=private.r12_pilot_terminal_validate(s,a.authorization_data);
 if exists(select 1 from private.r12_discovery_authorities prior where prior.scope_id=(closed->>'scopeId')::uuid
 and prior.execution_review_hash=x->>'executionReviewHash')
 or exists(select 1 from private.r05_operations op where op.operation_key in('research.r12.'||(closed->>'scopeId')||'.strategy','research.r12.'||(closed->>'scopeId')||'.review')
 and op.eligibility_hash=x->>'eligibilityReviewHash')
 then raise exception 'r12_terminal_qualification_fresh_execution_review_required';end if;

 if not exists(select 1 from private.r12_review_owner_proposals p where p.scope_id=s.id and p.proposal->>'interpretationHash'=a.authorization_hash and p.proposal_hash=x->>'proposalHash'
 and p.proposal->'operatingPolicy'->>'businessLifetimeLimitMicrounits'=(select payload->'after'->>'businessCapMicrousd' from private.r07_events where id=a.reconciliation_event_id))
 then raise exception 'r12_terminal_qualification_owner_proof_required';end if;
 -- Original activation additionally compares the exact immutable proposal,
 -- confirmed policy, current cap revision/exposure and cap amount. No cap change.`:''}
 update pg_temp.r12_bootstrap_input set payload=x-'terminalAuthorizationHash';
 `}
 END $recovery$;`;
export const STAGING_SQL=prefix('stage')+ORIGINAL_STAGE;
export const ACTIVATION_SQL=prefix('activate')+ORIGINAL_ACTIVATE;
export const CLOSE_SQL=prefix('close')+ORIGINAL_CLOSE+`
DO $recovery_cleanup$ DECLARE x jsonb;closed jsonb;BEGIN
 select payload into strict x from pg_temp.r12_bootstrap_input;
 BEGIN
  closed:=private.r12_pilot_terminal_release((x->>'businessId')::uuid,(x->>'scopeId')::uuid)||jsonb_build_object('cleanupVerified',true);
 EXCEPTION WHEN query_canceled THEN
  closed:=jsonb_build_object('cleanupVerified',false,'cleanupBlocked',true,'cleanupErrorCode',SQLSTATE,'liabilityReadbackRequired',true);
 WHEN OTHERS THEN
  -- Only cleanup rolls back. Exact policy/key closure above stays committed;
  -- refusal never implies zero liability or permission to send again.
  closed:=jsonb_build_object('cleanupVerified',false,'cleanupBlocked',true,'cleanupErrorCode',SQLSTATE,'liabilityReadbackRequired',true);
 END;
 update pg_temp.r12_bootstrap_result set payload=payload||closed;
END $recovery_cleanup$;`;

export const RECONCILIATION_SQL=`DO $pretransport$ DECLARE x jsonb;s private.r12_discovery_scopes;q private.r12_discovery_authorities;r private.r05_requests;BEGIN
 select payload into strict x from pg_temp.r12_bootstrap_input;
 if current_user in ('anon','authenticated','service_role') then raise exception 'r12_pretransport_operator_required';end if;
 perform private.r04_keys(x,array['businessId','scopeId','scopeHash','planHash','requestId','recoveryAuthorizationHash','markedRequestHash','ownerApprovalEvidenceHash','independentReviewHash']);
 select * into strict s from private.r12_discovery_scopes where id=(x->>'scopeId')::uuid and business_id=(x->>'businessId')::uuid;
 select * into strict q from private.r12_discovery_authorities where scope_id=s.id and business_id=s.business_id;
 select * into strict r from private.r05_requests where id=(x->>'requestId')::uuid and business_id=s.business_id;
 if s.amendment_hash is distinct from x->>'scopeHash' or q.plan_hash is distinct from x->>'planHash'
 or not exists(select 1 from private.r12_pilot_unsent_recovery_authorizations where scope_id=s.id and business_id=s.business_id and authorization_hash=x->>'recoveryAuthorizationHash')
 or not exists(select 1 from private.r07_attempts a join private.r07_plans p on p.id=a.plan_id where a.id=r.workflow_run_id and a.business_id=s.business_id and p.goal_id=s.goal_id and p.content_hash=q.plan_hash)
 then raise exception 'r12_pretransport_exact_operator_target_required';end if;
 insert into pg_temp.r12_bootstrap_result(payload) values(private.r12_pilot_marked_pretransport_reconcile(s.business_id,s.id,x->>'markedRequestHash',x->>'ownerApprovalEvidenceHash',x->>'independentReviewHash'));
 END $pretransport$;`;

/** Uncertain commit is read back, never repeated by this module. */
export async function runOperatorRecipe(client,kind,input){
 if(!['reconcile','stage','activate','close'].includes(kind))throw Error('Unknown terminal technical qualification recipe');
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Focused successor object required');
 const encoded=JSON.stringify(input);if(Buffer.byteLength(encoded,'utf8')>147456)throw Error('Focused successor input too large');
 await client.query('begin');
 try{
  await client.query("set local timezone='UTC'; set local lock_timeout='5s'; set local statement_timeout='30s'");
  await client.query('create temporary table r12_bootstrap_input(payload jsonb not null) on commit drop; create temporary table r12_bootstrap_result(payload jsonb not null) on commit drop');
  await client.query('insert into pg_temp.r12_bootstrap_input(payload) values($1::jsonb)',[encoded]);
  await client.query(kind==='reconcile'?RECONCILIATION_SQL:kind==='stage'?STAGING_SQL:kind==='activate'?ACTIVATION_SQL:CLOSE_SQL);
  const rows=(await client.query('select payload from pg_temp.r12_bootstrap_result')).rows;
  if(rows.length!==1)throw Error('Unexpected terminal technical qualification recipe result');
  await client.query('commit');return rows[0].payload;
 }catch(error){await client.query('rollback').catch(()=>{});throw error;}
}
