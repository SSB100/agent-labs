import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../supabase/migrations/20261007111110_r12_proven_unsent_recovery.sql',import.meta.url),'utf8');

test('proven-unsent recovery preserves permanent successor slots and creates only one separate bounded slot',()=>{
 assert.match(sql,/abandoned_scope_id uuid not null unique references private\.r12_discovery_scopes/);
 assert.match(sql,/budget_authority_root_id uuid not null unique references public\.product_experiments/);
 assert.match(sql,/octet_length\(authorization_data::text\)<=16384/);
 assert.match(sql,/enable row level security/);
 assert.match(sql,/before insert or update or delete/);
 assert.doesNotMatch(sql,/alter table private\.r12_pilot_successor_authorizations|drop (?:constraint|index)|create policy|grant\s|security definer/i);
 assert.doesNotMatch(sql,/insert into private\.r12_discovery_(?:scopes|authorities)|insert into private\.r05_server_keys|insert into private\.r07_server_keys/);
});

test('exact unsent proof reads both markers and every provider, receipt and output store',()=>{
 for(const table of ['r05_markers','r07_markers','r12_discovery_transport_claims','r12_discovery_candidates','r12_discovery_response_observations','r12_discovery_receipt_checks','r12_discovery_receipt_observations','r05_settlements','r05_receipt_claims','r05_legacy_attestations','r07_responses','artifacts','model_invocations'])assert.ok(sql.includes(`from ${['artifacts','model_invocations'].includes(table)?'public':'private'}.${table}`),table);
 assert.match(sql,/task_contract_id=private\.stage4_deterministic_uuid\('r07:task:'/);
 assert.match(sql,/worker_run_id=private\.stage4_deterministic_uuid\('r07:worker:'/);
 assert.match(sql,/private\.r05_legacy_exposure\(r.business_id\).*le.workflow_id=a.id or le.source_key=r.source_key/);
 assert.match(sql,/a.status<>'reserved' or a.reason<>'admitted'/);
 assert.match(sql,/h.dispatches<>0 or h.children_created<>1/);
 assert.match(sql,/d.decision='allowed' and d.reason='released_unsent'/);
 assert.match(sql,/exists\(select 1 from private.r12_pilot_unsent_recovery_authorizations where scope_id=s.id\)/);
 assert.doesNotMatch(sql,/insert into private\.r05_settlements|update private\.r07_attempts|update private\.r07_heads|delete from/i);
});

test('recovery reuses one paid provenance reconstruction while keeping each original time boundary',()=>{
 assert.match(sql,/context:=private\.r12_pilot_successor_validate_context\(s,authz.authorization_data\)/);
 assert.match(sql,/context:=private\.r12_pilot_unsent_closure_context/);
 assert.match(sql,/perform private\.r12_pilot_profile_validate\(s,clock_timestamp\(\),false\)/);
 assert.match(sql,/perform private\.r12_pilot_profile_validate\(s,effective_at,p_current\)/);
 assert.match(sql,/perform private\.r12_pilot_profile_validate\(old_scope,effective_at,false\)/);
 assert.match(sql,/perform private\.r12_pilot_profile_validate\(charged_scope,effective_at,false\)/);
 assert.doesNotMatch(sql,/private\.r12_pilot_successor_source\(old_scope/);
 assert.match(sql,/where scope_id=p_scope_id and business_id=p_business_id\n union all select/);
});

test('recovery inherits every successor stop, wire, observation and owner guard via exact guarded edits',()=>{
 for(const signature of ['private.r07_gate','private.r12_review_owner_proposal_validate','private.r12_discovery_wire_validate','public.r12_discovery_server','public.r12_discovery_owner_read','public.r12_review_owner_read'])assert.ok(sql.includes(`('${signature}(`),signature);
 assert.match(sql,/r12_recovery_runtime_definition_drift/);
 assert.match(sql,/"maximumSuccessors":1,"maximumRecoveries":1,"maximumPaidCalls":2/);
 assert.match(sql,/private\.r12_pilot_unsent_owner_eligibility\(source_scope.id,p_business_id\)/);
 assert.match(sql,/private\.r12_pilot_unsent_recovery_release\(uuid,uuid\)\n from public,anon,authenticated,service_role/);
});

test('recovery cleanup is append-only after permanent revocations and retains all known cost',()=>{
 const release=sql.slice(sql.indexOf('create function private.r12_pilot_unsent_recovery_release'));
 assert.match(release,/current_user in \('anon','authenticated','service_role'\)/);
 for(const table of ['r05_revocations','r07_server_revocations','r05_server_revocations'])assert.ok(release.includes(`from private.${table}`));
 assert.ok(release.indexOf('from public.businesses')<release.indexOf('from public.product_experiments'));
 assert.ok(release.indexOf('from public.product_experiments')<release.indexOf('from private.r07_server_keys'));
 assert.match(release,/proof:=private\.r12_pilot_unsent_request\(s.id,a.id\)/);
 assert.match(release,/insert into private\.r05_releases/);
 assert.match(release,/private\.r05_result\(s.business_id,r.id,'allowed','released_unsent',false\)/);
 assert.match(release,/budget_after->'knownActualMicrousd' is distinct from budget_before->'knownActualMicrousd'/);
 assert.doesNotMatch(release,/on conflict|statement_timeout|set_config|delete|update public\./i);
});
