/** One explicitly approved proven-unsent recovery Goal. Frozen original recipe strings remain
 * unchanged; the exact immutable sidecar is staged atomically before them.
 * No import effects, provider calls, secrets, retries or implicit authority. */
import {STAGING_SQL as ORIGINAL_STAGE,ACTIVATION_SQL as ORIGINAL_ACTIVATE,CLOSE_SQL as ORIGINAL_CLOSE} from './r12-focused-pilot-bootstrap.mjs';

const prefix=(kind)=>`DO $recovery$ DECLARE x jsonb;v jsonb;e jsonb;s private.r12_discovery_scopes;a private.r12_pilot_unsent_recovery_authorizations;closed jsonb;BEGIN
 select payload into strict x from pg_temp.r12_bootstrap_input;
 if current_user in ('anon','authenticated','service_role') then raise exception 'r12_unsent_recovery_operator_required';end if;
 ${kind==='stage'?`
 perform private.r04_keys(x,array['envelope','proposal','quote','executionReviewHash','eligibilityReviewHash','recoveryAuthorization']);
 v:=x->'recoveryAuthorization';e:=x->'envelope';
 s:=jsonb_populate_record(null::private.r12_discovery_scopes,jsonb_build_object('id',e->>'id','business_id',e->>'businessId','goal_id',e->>'goalId','budget_authority_root_id',e->>'budgetAuthorityRootId','prior_round_id',e->>'priorRoundId','amendment',e,'amendment_hash',private.stage14_hash(e)));
 perform 1 from public.businesses where id=s.business_id and owner_user_id=(v->>'ownerId')::uuid for update;
 if not found then raise exception 'r12_unsent_recovery_owner_required';end if;
 perform 1 from public.product_experiments where id=s.budget_authority_root_id and business_id=s.business_id for update;
 if not found then raise exception 'r12_unsent_recovery_root_required';end if;
 closed:=private.r12_pilot_unsent_recovery_validate(s,v);
 if x->'proposal'->>'interpretationHash' is distinct from private.stage14_hash(v) then raise exception 'r12_unsent_recovery_owner_proof_required';end if;
 insert into private.r12_pilot_unsent_recovery_authorizations(scope_id,business_id,abandoned_scope_id,budget_authority_root_id,authorization_data,authorization_hash)
 values(s.id,s.business_id,(closed->>'scopeId')::uuid,s.budget_authority_root_id,v,private.stage14_hash(v));
 update pg_temp.r12_bootstrap_input set payload=x-'recoveryAuthorization';
 `:`
 perform private.r04_keys(x,array[${kind==='activate'?"'businessId','scopeId','scopeHash','proposalHash','policyId','policyHash','quote','executionReviewHash','eligibilityReviewHash','controllerKeyHash','admissionKeyHash'":"'businessId','scopeId','scopeHash','policyId','policyHash','planHash'"},'recoveryAuthorizationHash']);
 select * into s from private.r12_discovery_scopes where id=(x->>'scopeId')::uuid and business_id=(x->>'businessId')::uuid;
 perform 1 from public.businesses where id=s.business_id for update;
 select * into a from private.r12_pilot_unsent_recovery_authorizations where scope_id=s.id and business_id=s.business_id;
 if a.scope_id is null or a.authorization_hash is distinct from x->>'recoveryAuthorizationHash' or a.authorization_hash is distinct from private.stage14_hash(a.authorization_data)
 then raise exception 'r12_unsent_recovery_exact_authorization_required';end if;
 ${kind==='activate'?`closed:=private.r12_pilot_unsent_recovery_validate(s,a.authorization_data);
 if not exists(select 1 from private.r12_review_owner_proposals p where p.scope_id=s.id and p.proposal->>'interpretationHash'=a.authorization_hash and p.proposal_hash=x->>'proposalHash') then raise exception 'r12_unsent_recovery_owner_proof_required';end if;`:''}
 update pg_temp.r12_bootstrap_input set payload=x-'recoveryAuthorizationHash';
 `}
 END $recovery$;`;
export const STAGING_SQL=prefix('stage')+ORIGINAL_STAGE;
export const ACTIVATION_SQL=prefix('activate')+ORIGINAL_ACTIVATE;
export const CLOSE_SQL=prefix('close')+ORIGINAL_CLOSE+`
DO $recovery_cleanup$ DECLARE x jsonb;closed jsonb;BEGIN
 select payload into strict x from pg_temp.r12_bootstrap_input;
 BEGIN
  closed:=private.r12_pilot_unsent_recovery_release((x->>'businessId')::uuid,(x->>'scopeId')::uuid)||jsonb_build_object('cleanupVerified',true);
 EXCEPTION WHEN query_canceled THEN
  closed:=jsonb_build_object('cleanupVerified',false,'cleanupBlocked',true,'cleanupErrorCode',SQLSTATE,'liabilityReadbackRequired',true);
 WHEN OTHERS THEN
  -- Only cleanup rolls back. Exact policy/key closure above stays committed;
  -- refusal never implies zero liability or permission to send again.
  closed:=jsonb_build_object('cleanupVerified',false,'cleanupBlocked',true,'cleanupErrorCode',SQLSTATE,'liabilityReadbackRequired',true);
 END;
 update pg_temp.r12_bootstrap_result set payload=payload||closed;
END $recovery_cleanup$;`;

/** Uncertain commit is read back, never repeated by this module. */
export async function runOperatorRecipe(client,kind,input){
 if(!['stage','activate','close'].includes(kind))throw Error('Unknown focused unsent recovery recipe');
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Focused successor object required');
 const encoded=JSON.stringify(input);if(Buffer.byteLength(encoded,'utf8')>147456)throw Error('Focused successor input too large');
 await client.query('begin');
 try{
  await client.query("set local timezone='UTC'; set local lock_timeout='5s'; set local statement_timeout='30s'");
  await client.query('create temporary table r12_bootstrap_input(payload jsonb not null) on commit drop; create temporary table r12_bootstrap_result(payload jsonb not null) on commit drop');
  await client.query('insert into pg_temp.r12_bootstrap_input(payload) values($1::jsonb)',[encoded]);
  await client.query(kind==='stage'?STAGING_SQL:kind==='activate'?ACTIVATION_SQL:CLOSE_SQL);
  const rows=(await client.query('select payload from pg_temp.r12_bootstrap_result')).rows;
  if(rows.length!==1)throw Error('Unexpected focused unsent recovery recipe result');
  await client.query('commit');return rows[0].payload;
 }catch(error){await client.query('rollback').catch(()=>{});throw error;}
}
