-- Explicit direct .4 policy/state/input .2: genuine same-cycle model repair.
-- No enrollment, activation, provider call, new allocation or .1 scope upgrade.
begin;

-- Existing R07 row shapes are deliberately unchanged: predecessor snapshots
-- hash their entire rows. New private metadata cannot rewrite frozen history.
alter table private.r12_direct_phase_attempts add column repair_ordinal integer not null default 0 check(repair_ordinal between 0 and 31);
alter table private.r12_direct_phase_attempts drop constraint r12_direct_phase_attempts_scope_id_ordinal_phase_key;
create unique index r12_direct_repaired_phase_ordinal on private.r12_direct_phase_attempts(scope_id,ordinal,phase,repair_ordinal);
drop index private.r12_direct_phase_ordinal;
alter table private.r07_attempts drop constraint r07_attempts_attempt_check;
alter table private.r07_attempts add constraint r07_attempts_attempt_check check(
 (direct_cycle_ordinal is null and ((adaptive_action_ordinal is null and adaptive_action_hash is null and attempt between 1 and 4) or
 (adaptive_action_ordinal between 0 and 10 and adaptive_action_hash~'^[a-f0-9]{64}$' and attempt between 1 and 47))) or
 (direct_cycle_ordinal between 1 and 32 and adaptive_action_ordinal is null and adaptive_action_hash is null and attempt between 1 and 32));

create table private.r12_direct_counted_units(
 scope_id uuid not null references private.r12_direct_research_activations(scope_id),ordinal integer not null check(ordinal between 1 and 32),
 logical_cycle_id uuid not null references private.r12_direct_research_cycles(id),phase_attempt_id uuid not null unique references private.r12_direct_phase_attempts(attempt_id) deferrable initially deferred,
 content jsonb not null,content_hash text not null check(content_hash=private.stage14_hash(content)),created_at timestamptz not null default clock_timestamp(),primary key(scope_id,ordinal));
create table private.r12_direct_repair_phase_metadata(
 attempt_id uuid primary key references private.r12_direct_phase_attempts(attempt_id) deferrable initially deferred,
 scope_id uuid not null references private.r12_direct_research_activations(scope_id),sequence integer not null check(sequence between 1 and 64),
 logical_cycle_id uuid not null references private.r12_direct_research_cycles(id),counted_unit_ordinal integer not null,
 replaces_attempt_id uuid references private.r12_direct_phase_attempts(attempt_id),dependency_selection jsonb not null,
 dependency_selection_hash text not null check(dependency_selection_hash=private.stage14_hash(dependency_selection-'selectionHash') and dependency_selection_hash=dependency_selection->>'selectionHash'),
 source_reuse jsonb,source_reuse_hash text check(source_reuse_hash=private.stage14_hash(source_reuse)),
 created_at timestamptz not null default clock_timestamp(),unique(scope_id,sequence),
 foreign key(scope_id,counted_unit_ordinal) references private.r12_direct_counted_units(scope_id,ordinal) deferrable initially deferred,
 check((source_reuse is null)=(source_reuse_hash is null)));
do $$ declare n text;begin foreach n in array array['r12_direct_counted_units','r12_direct_repair_phase_metadata'] loop
 execute format('alter table private.%I enable row level security',n);execute format('revoke all on private.%I from public,anon,authenticated,service_role',n);
 execute format('create trigger direct_repair_immutable before insert or update or delete on private.%I for each row execute function private.r05_guard()',n);end loop;end $$;

create function private.r12_direct_is_repair_scope(p_scope uuid) returns boolean language sql stable set search_path='' as $$
 select coalesce((select policy->>'version'='r12.direct-etsy-attempt-policy.2' from private.r12_direct_research_setups where scope_id=p_scope),false)
$$;

create or replace function private.r12_direct_attempt_guard() returns trigger language plpgsql set search_path='' as $$
declare p private.r07_plans;a private.r12_direct_phase_attempts;s private.r12_direct_research_setups;m private.r12_direct_repair_phase_metadata;begin
 select * into p from private.r07_plans where id=new.plan_id;
 if p.content->>'format'<>'r12.discovery-direct.1' then if new.direct_cycle_ordinal is not null then raise exception 'r12_direct_old_format_ordinal_spoof';end if;return new;end if;
 select * into a from private.r12_direct_phase_attempts where attempt_id=new.id;select * into s from private.r12_direct_research_setups where plan_id=new.plan_id;
 select * into m from private.r12_direct_repair_phase_metadata where attempt_id=new.id;
 if a.attempt_id is null or s.id is null or a.scope_id<>s.scope_id or a.ordinal<>new.direct_cycle_ordinal or a.phase<>new.step_key or new.input_hash<>private.r04_hash(a.semantic_input) or new.dependency_pins is distinct from a.dependency_pins
 or not exists(select 1 from private.r07_children c where c.id=new.child_id and c.plan_id=s.plan_id and c.step_key=a.phase) then raise exception 'r12_direct_actual_attempt_required';end if;
 if s.policy->>'version'='r12.direct-etsy-attempt-policy.1' then
 if m.attempt_id is not null or a.repair_ordinal<>0 or a.ordinal<>new.attempt then raise exception 'r12_direct_legacy_attempt_immutable';end if;
 elsif s.policy->>'version'='r12.direct-etsy-attempt-policy.2' then
 if m.attempt_id is null or m.scope_id<>a.scope_id or new.attempt<>m.counted_unit_ordinal or not exists(select 1 from private.r12_direct_research_cycles c where c.id=m.logical_cycle_id and c.scope_id=a.scope_id and c.ordinal=a.ordinal)
 or (a.repair_ordinal=0) is distinct from (m.replaces_attempt_id is null) then raise exception 'r12_direct_repair_actual_unit_required';end if;
 else raise exception 'r12_direct_repair_policy_required';end if;return new;
end $$;

-- New preparation is explicit and independently hash-bound. Calling it can
-- never turn a saved .1 setup or scope into .2 through an idempotency collision.
do $repair_prepare$ declare d text;begin
 d:=pg_get_functiondef('private.r12_direct_prepare_research(uuid,jsonb,text)'::regprocedure);
 d:=replace(d,'FUNCTION private.r12_direct_prepare_research(', 'FUNCTION private.r12_direct_prepare_research_v2(');
 if position($a$h:=private.stage14_hash(payload);$a$ in d)=0 or position($a$'maximumDispatchesPerAttempt',4$a$ in d)=0 then raise exception 'r12_direct_repair_prepare_drift';end if;
 d:=replace(d,$a$h:=private.stage14_hash(payload);$a$,$b$h:=private.stage14_hash(jsonb_build_object('version','r12.direct-repair-preparation.1','payload',payload));$b$);
 d:=replace(d,$a$'cumulativeDispatchesCeiling',(closure->>'baseDispatches')::integer+4*n$a$,$b$'cumulativeDispatchesCeiling',least(64,(closure->>'baseDispatches')::integer+4*n)$b$);
 d:=replace(d,$a$'version','r12.direct-etsy-attempt-policy.1'$a$,$b$'version','r12.direct-etsy-attempt-policy.2'$b$);
 d:=replace(d,$a$'maximumDispatchesPerAttempt',4$a$,$b$'maximumPhasesPerInitialCycle',4,'unitAccounting',jsonb_build_object('version','r12.direct-etsy-attempt-units.1','maximumUnitsInWindow',n,'baseUnitsConsumed',0,'baseLogicalCyclesStarted',0,'previousWindowStateHash',null)$b$);
 execute d;
end $repair_prepare$;

create function private.r12_direct_repair_dependencies(p_scope uuid,cycle_id uuid,phase_name text,before_sequence integer default 2147483647) returns jsonb language plpgsql stable set search_path='' as $$
declare body jsonb:=jsonb_build_object('version','r12.direct-accepted-dependencies.1','logicalCycleId',cycle_id,'plan',null,'source',null,'strategy',null);k text;a private.r12_direct_phase_attempts;r private.r12_direct_phase_receipts;begin
 foreach k in array array['plan','source','strategy'] loop
 if array_position(array['plan','source','strategy','review'],k)>=array_position(array['plan','source','strategy','review'],phase_name) then continue;end if;
 select x.* into a from private.r12_direct_phase_attempts x join private.r12_direct_repair_phase_metadata m on m.attempt_id=x.attempt_id where m.scope_id=p_scope and m.logical_cycle_id=cycle_id and x.phase=k and m.sequence<before_sequence order by m.sequence desc limit 1;
 select * into r from private.r12_direct_phase_receipts where attempt_id=a.attempt_id;
 if a.attempt_id is null or r.attempt_id is null or r.failure is not null then raise exception 'r12_direct_repair_dependency_unaccepted';end if;
 body:=body||jsonb_build_object(k,jsonb_build_object('phaseAttemptId',a.attempt_id,'receiptHash',r.receipt_hash));end loop;
 return body||jsonb_build_object('selectionHash',private.stage14_hash(body));
end $$;
create function private.r12_direct_repair_source_reuse(s private.r12_direct_research_setups,cycle_id uuid,p_attempt uuid,replaced uuid,phase_name text) returns jsonb language plpgsql stable set search_path='' as $$
declare proof jsonb;begin
 if phase_name not in ('strategy','review') then return null;end if;
 select r.source_proof into proof from private.r12_direct_phase_attempts a join private.r12_direct_phase_receipts r on r.attempt_id=a.attempt_id join private.r12_direct_research_cycles c on c.scope_id=a.scope_id and c.ordinal=a.ordinal where c.id=cycle_id and c.scope_id=s.scope_id and a.phase='source' and a.repair_ordinal=0 and r.failure is null;
 if proof is null then raise exception 'r12_direct_repair_source_missing';end if;
 return jsonb_build_object('version','r12.direct-source-reuse.1','policyHash',s.policy->>'policyHash','logicalCycleId',cycle_id,'replacesPhaseAttemptId',replaced,'newPhaseAttemptId',p_attempt,'phase',phase_name,'reason','settled_model_phase_failure','sourceScopeId',proof->>'scopeId','sourceScopeHash',proof->>'scopeHash','sourceAttemptId',proof->>'sourceAttemptId','operationId',proof->>'operationId','receiptHash',proof->>'receiptHash','sourceProofHash',private.stage14_hash(proof),'accountingRecordHash',proof->'accounting'->>'recordHash','quoteHash',proof->>'quoteHash','executionQuoteHash',proof->>'executionQuoteHash','executionQuoteProofHash',proof->>'executionQuoteProofHash');
end $$;

create function private.r12_direct_repair_source_failure(a private.r12_direct_phase_attempts) returns jsonb language plpgsql stable set search_path='' as $$
declare r private.r12_direct_browser_receipts;q private.r12_direct_browser_accounting;phase_failure jsonb;body jsonb;begin
 select * into r from private.r12_direct_browser_receipts where operation_id=(a.source_scope->>'operationId')::uuid;
 select failure into phase_failure from private.r12_direct_phase_receipts where attempt_id=a.attempt_id;
 if r.operation_id is null or (r.content->>'status'='completed' and phase_failure is null) then return null;end if;
 select * into q from private.r12_direct_browser_accounting where operation_id=r.operation_id and content->>'operationReceiptHash'=r.receipt_hash order by revision desc limit 1;
 if exists(select 1 from private.r12_direct_browser_anomalies where operation_id=r.operation_id) then q:=null;end if;
 body:=jsonb_build_object('version','r12.direct-source-failure.1','operationId',r.operation_id,'sourceAttemptId',a.attempt_id,'requestHash',private.stage14_hash(a.source_scope),'receiptHash',r.receipt_hash,'sourceReceiptVersion',r.content->>'version','status',r.content->>'status','reason',coalesce(phase_failure->>'diagnostic',r.content->>'reason'),'releaseState',r.content->>'releaseState','liabilityState',r.content->>'liabilityState','accounting',q.content);
 return body||jsonb_build_object('failureHash',private.stage14_hash(body));
end $$;

create function private.r12_direct_repair_state(p_scope uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare s private.r12_direct_research_setups;c private.r12_direct_research_cycles;a private.r12_direct_phase_attempts;m private.r12_direct_repair_phase_metadata;r private.r12_direct_phase_receipts;z private.r12_direct_cycle_closures;
 history jsonb;cycles jsonb:='[]';calls jsonb:='[]';units jsonb;sp jsonb;failure jsonb;call_status text;last_status text;last_phase text;last_outcome text;terminal text;next_action text:='initial_cycle';next_phase text:='plan';next_kind text:='initial';command jsonb;criteria jsonb:='[]';epoch_hash text;epoch integer:=0;nme integer:=0;repairs integer;pivots integer;initial_unit integer;n integer:=0;reserved integer;consumed integer;models integer:=0;sources integer:=0;model_sent integer:=0;source_sent integer:=0;exhausted boolean:=false;body jsonb;actual text;receipt_hash text;begin
 select * into strict s from private.r12_direct_research_setups where scope_id=p_scope;
 if s.policy->>'version' is distinct from 'r12.direct-etsy-attempt-policy.2' then raise exception 'r12_direct_repair_policy_required';end if;
 history:=s.content->'inherited';command:=s.initial_command;repairs:=(s.policy->>'baseRepairs')::integer;pivots:=(s.policy->>'basePivots')::integer;
 select coalesce(jsonb_agg(content order by ordinal),'[]'),count(*) into units,reserved from private.r12_direct_counted_units where scope_id=p_scope;
 select count(*) into consumed from private.r12_direct_counted_units u join private.r12_direct_phase_attempts x on x.attempt_id=u.phase_attempt_id where u.scope_id=p_scope and exists(select 1 from private.r05_markers k where k.request_id=x.request_id);
 for c in select * from private.r12_direct_research_cycles where scope_id=p_scope order by ordinal loop
 n:=n+1;sp:=null;select * into z from private.r12_direct_cycle_closures where scope_id=p_scope and ordinal=c.ordinal;
 select ordinal into strict initial_unit from private.r12_direct_counted_units where scope_id=p_scope and logical_cycle_id=c.id and content->>'kind'='initial_cycle';
 if c.kind='initial' then epoch_hash:=c.command->>'criteriaHash';criteria:=jsonb_build_array(epoch_hash);
 elsif c.kind='pivot' then epoch:=epoch+1;epoch_hash:=c.command->>'criteriaHash';nme:=0;pivots:=pivots+1;criteria:=private.r12_direct_origin_set(criteria||jsonb_build_array(epoch_hash));end if;
 for a in select x.* from private.r12_direct_phase_attempts x join private.r12_direct_repair_phase_metadata meta on meta.attempt_id=x.attempt_id where x.scope_id=p_scope and x.ordinal=c.ordinal order by meta.sequence loop
 select * into strict m from private.r12_direct_repair_phase_metadata where attempt_id=a.attempt_id;select * into r from private.r12_direct_phase_receipts where attempt_id=a.attempt_id;
 failure:=null;actual:=null;receipt_hash:=r.receipt_hash;
 if a.phase='source' then failure:=private.r12_direct_repair_source_failure(a);end if;
 if failure is not null then call_status:='source_failed';receipt_hash:=failure->>'receiptHash';actual:=failure->'accounting'->>'actualMicrounits';
 elsif r.attempt_id is not null then
 if r.failure is not null then call_status:='failed_settled';failure:=r.failure;actual:=r.failure->>'actualMicrounits';else call_status:='accepted';if a.phase='source' then sp:=r.source_proof;actual:=sp->'accounting'->>'actualMicrounits';else actual:=r.candidate->>'reportedMicrousd';end if;end if;
 elsif exists(select 1 from private.r05_markers where request_id=a.request_id) then call_status:='dispatched';else call_status:='scheduled';end if;
 if a.repair_ordinal>0 and call_status<>'scheduled' then repairs:=repairs+1;end if;
 if a.phase='source' then sources:=sources+1;if call_status<>'scheduled' then source_sent:=source_sent+1;end if;else models:=models+1;if call_status<>'scheduled' then model_sent:=model_sent+1;end if;end if;
 if failure is not null then history:=history||jsonb_build_object('consecutiveNonprogress',(history->>'consecutiveNonprogress')::integer+1,'usedDiagnosticHashes',private.r12_direct_origin_set(history->'usedDiagnosticHashes'||jsonb_build_array(private.stage14_hash(failure))));last_outcome:=case when call_status='source_failed' then 'RESEARCH_PAUSED_ACCESS' else 'INVALID_RESEARCH' end;end if;
 calls:=calls||jsonb_build_array(jsonb_build_object('sequence',m.sequence,'phase',a.phase,'phaseAttemptId',a.attempt_id,'requestId',a.request_id,'logicalCycleId',c.id,'logicalCycleOrdinal',c.ordinal,'repairOrdinal',a.repair_ordinal,'countedUnitOrdinal',m.counted_unit_ordinal,'replacesAttemptId',m.replaces_attempt_id,'dependencySelectionHash',m.dependency_selection_hash,'sourceReuseHash',m.source_reuse_hash,'requestHash',private.r12_direct_phase_request_hash(a),'executionQuoteHash',a.quote->>'quoteHash','executionQuoteProofHash',a.execution_quote_proof->>'compatibilityHash','maximumMicrounits',s.policy->'phaseMaximumMicrounits'->>a.phase,'status',call_status,'receiptHash',receipt_hash,'actualMicrounits',actual,'failure',failure));last_status:=call_status;last_phase:=a.phase;
 end loop;
 if sp is not null then history:=history||jsonb_build_object('seenEvidenceIdentityHashes',private.r12_direct_origin_set(history->'seenEvidenceIdentityHashes'||coalesce((select jsonb_agg(x->'evidenceIdentityHash') from jsonb_array_elements(sp->'witnesses') x),'[]')),'seenFactIdentityHashes',private.r12_direct_origin_set(history->'seenFactIdentityHashes'||coalesce((select jsonb_agg(x->'factIdentityHash') from jsonb_array_elements(sp->'witnesses') x),'[]')));end if;
 history:=history||jsonb_build_object('seenQuestionHashes',private.r12_direct_origin_set(history->'seenQuestionHashes'||jsonb_build_array(c.command->>'questionHash')));
 next_kind:=null;command:=null;
 next_phase:=case when last_status='accepted' then (array['plan','source','strategy','review'])[array_position(array['plan','source','strategy','review'],last_phase)+1] else last_phase end;
 next_action:=case last_status when 'scheduled' then 'dispatch_scheduled' when 'dispatched' then 'receipt_only' when 'failed_settled' then 'repair_model' when 'source_failed' then 'source_paused' else case when last_phase='review' then 'accept_review' else 'next_phase' end end;
 if z.status='completed' then
 if z.review->>'outcome'<>'NME' then terminal:=z.review->>'terminal';history:=history||jsonb_build_object('consecutiveNonprogress',0);last_outcome:=terminal;next_action:='research_stage_complete';next_phase:=null;
 else nme:=nme+1;history:=history||jsonb_build_object('consecutiveNonprogress',(history->>'consecutiveNonprogress')::integer+1);last_outcome:=case when z.review->'quality'->'passed'='true'::jsonb then 'INSUFFICIENT_EVIDENCE' else 'RESEARCH_FAILED_QUALITY' end;command:=z.review->'proposedCommand';next_kind:=case when nme=4 then 'pivot' else 'targeted' end;next_action:='next_cycle';next_phase:='plan';end if;end if;
 cycles:=cycles||jsonb_build_array(jsonb_build_object('ordinal',c.ordinal,'windowAttemptOrdinal',c.ordinal,'logicalCycleId',c.id,'initialCountedUnitOrdinal',initial_unit,'kind',c.kind,'epochOrdinal',c.epoch_ordinal,'command',c.command,'sourceProof',sp,'status',case when z.status='completed' then 'completed' else 'running' end,'review',z.review));
 end loop;
 exhausted:=reserved=(s.policy->'unitAccounting'->>'maximumUnitsInWindow')::integer and next_action in ('initial_cycle','next_cycle','repair_model') and terminal is null;
 if exhausted then terminal:='RESEARCH_INSUFFICIENT_AT_WINDOW_LIMIT';next_action:='window_limit';end if;
 body:=jsonb_build_object('version','r12.direct-etsy-attempt-state.2','policyHash',s.policy->>'policyHash','inherited',s.content->'inherited','history',history,'windowId',s.policy->'window'->>'windowId','windowOrdinal',1,'maximumUnitsInWindow',s.policy->'unitAccounting'->'maximumUnitsInWindow','logicalCycles',cycles,'actualPhaseCalls',calls,'countedUnits',units,'logicalCyclesStarted',n,'totalLogicalCyclesStarted',n,'unitsReserved',reserved,'unitsConsumed',consumed,'totalUnitsReserved',reserved,'totalUnitsConsumed',consumed,'modelDispatchSlotsReserved',models,'sourceOperationSlotsReserved',sources,'modelDispatchesUsed',model_sent,'sourceOperationsStarted',source_sent,'cumulativeChildrenUsed',s.policy->'cumulativeChildrenCeiling','cumulativeDispatchSlotsReserved',(s.policy->>'baseDispatches')::integer+models+sources,'cumulativeDispatchesUsed',(s.policy->>'baseDispatches')::integer+model_sent+source_sent,'repairs',repairs,'pivots',pivots,'epochOrdinal',epoch,'epochCriteriaHash',epoch_hash,'nmeCountInEpoch',nme,'seenCriteriaHashes',criteria,'nextCycleKind',next_kind,'pendingCommand',command,'nextPhase',next_phase,'nextAction',next_action,'questComplete',false,'researchWindowComplete',terminal is not null,'researchStageOutcome',case when terminal is null then null else last_outcome end,'requiresReviewedRenewal',exhausted,'terminal',terminal);
 return body||jsonb_build_object('stateHash',private.stage14_hash(body));
end $$;

create function private.r12_direct_repair_schedule(p_scope uuid,payload jsonb) returns jsonb language plpgsql set search_path='' as $$
declare s private.r12_direct_research_setups;e private.r12_direct_test_envelopes;state jsonb;c private.r12_direct_research_cycles;prior private.r12_direct_phase_attempts;r private.r12_direct_phase_receipts;step jsonb;deps jsonb:='[]';semantic jsonb;source jsonb;aid uuid;child uuid;phase text;ordinal integer;h private.r07_heads;q jsonb;fresh jsonb;
 selection jsonb;reuse jsonb;unit_content jsonb;unit_ordinal integer;repair_ordinal integer:=0;replaced uuid;seq integer;new_cycle boolean;new_unit boolean;suffix text[];required bigint;begin
 perform private.r04_keys(payload,array['phase','attemptId','runtimeCapability','expectedStateHash']||case when payload ? 'executionQuote' then array['executionQuote'] else array[]::text[] end);s:=private.r12_direct_research_current(p_scope);
 select * into strict e from private.r12_direct_test_envelopes where id=s.envelope_id;q:=coalesce(payload->'executionQuote',s.quote);perform private.r12_direct_research_quote(e,q,s.quote);
 state:=private.r12_direct_repair_state(p_scope);phase:=payload->>'phase';aid:=(payload->>'attemptId')::uuid;
 if state->>'stateHash' is distinct from payload->>'expectedStateHash' or state->'terminal'<>'null'::jsonb or phase is distinct from state->>'nextPhase' or state->>'nextAction' not in ('initial_cycle','next_cycle','next_phase','repair_model') or aid is null
 or jsonb_typeof(payload->'runtimeCapability') is distinct from 'string' or length(payload->>'runtimeCapability') not between 32 and 200 then raise exception 'r12_direct_repair_phase_not_admitted';end if;
 select * into strict h from private.r07_heads where goal_id=s.goal_id and plan_id=s.plan_id for update;
 new_cycle:=state->>'nextAction' in ('initial_cycle','next_cycle');new_unit:=state->>'nextAction'<>'next_phase';seq:=jsonb_array_length(state->'actualPhaseCalls')+1;
 if new_unit and (state->>'unitsReserved')::integer>=(s.policy->'unitAccounting'->>'maximumUnitsInWindow')::integer then raise exception 'r12_direct_repair_unit_limit';end if;
 suffix:=(array['plan','source','strategy','review'])[array_position(array['plan','source','strategy','review'],phase):4];
 if (state->>'cumulativeDispatchSlotsReserved')::integer+cardinality(suffix)>least(64,(s.policy->>'cumulativeDispatchesCeiling')::integer)
 or (state->>'modelDispatchSlotsReserved')::integer+(select count(*) from unnest(suffix) x where x<>'source')>(s.policy->>'maximumModelDispatches')::integer
 or (state->>'sourceOperationSlotsReserved')::integer+(case when 'source'=any(suffix) then 1 else 0 end)>(s.policy->>'maximumSourceOperations')::integer then raise exception 'r12_direct_repair_dispatch_limit';end if;
 select sum((s.policy->'phaseMaximumMicrounits'->>x)::bigint) into required from unnest(suffix) x;perform private.r12_direct_financial_check(e.id,required);
 if new_cycle then
 if phase<>'plan' or state->'pendingCommand'='null'::jsonb or state->>'nextCycleKind' not in ('initial','targeted','pivot') then raise exception 'r12_direct_repair_cycle_not_admitted';end if;
 ordinal:=(state->>'logicalCyclesStarted')::integer+1;c.id:=gen_random_uuid();c.kind:=state->>'nextCycleKind';c.command:=state->'pendingCommand';c.epoch_ordinal:=(state->>'epochOrdinal')::integer+case when c.kind='pivot' then 1 else 0 end;
 perform private.r12_direct_command_check(c.command);
 insert into private.r12_direct_research_cycles(scope_id,ordinal,id,kind,epoch_ordinal,command,command_hash) values(p_scope,ordinal,c.id,c.kind,c.epoch_ordinal,c.command,private.stage14_hash(c.command)) returning * into c;
 else
 select * into strict c from private.r12_direct_research_cycles x where x.scope_id=p_scope order by x.ordinal desc limit 1;ordinal:=c.ordinal;
 if exists(select 1 from private.r12_direct_cycle_closures z where z.scope_id=p_scope and z.ordinal=c.ordinal) then raise exception 'r12_direct_repair_cycle_closed';end if;
 if state->>'nextAction'='repair_model' then
 select x.* into strict prior from private.r12_direct_phase_attempts x join private.r12_direct_repair_phase_metadata m on m.attempt_id=x.attempt_id where x.scope_id=p_scope order by m.sequence desc limit 1;
 select * into strict r from private.r12_direct_phase_receipts where attempt_id=prior.attempt_id;
 if prior.phase='source' or prior.phase<>phase or prior.ordinal<>ordinal or r.failure is null or r.candidate is null or r.route_proof is null or not exists(select 1 from private.r05_settlements z where z.request_id=prior.request_id and z.receipt_hash=r.receipt_hash and z.actual_microunits=(r.failure->>'actualMicrounits')::bigint) then raise exception 'r12_direct_repair_settled_model_required';end if;
 replaced:=prior.attempt_id;repair_ordinal:=prior.repair_ordinal+1;end if;
 end if;
 selection:=private.r12_direct_repair_dependencies(p_scope,c.id,phase,seq);reuse:=case when replaced is not null then private.r12_direct_repair_source_reuse(s,c.id,aid,replaced,phase) else null end;
 for prior in select a.* from jsonb_each(selection-array['version','logicalCycleId','selectionHash']) x join private.r12_direct_phase_attempts a on a.attempt_id=(x.value->>'phaseAttemptId')::uuid order by array_position(array['plan','source','strategy','review'],a.phase) loop
 select * into strict r from private.r12_direct_phase_receipts where attempt_id=prior.attempt_id;
 deps:=deps||jsonb_build_array(jsonb_build_object('stepKey',prior.phase,'attemptId',prior.attempt_id,'resultHash',(select content_hash from private.r07_responses where attempt_id=prior.attempt_id),'receiptHash',r.receipt_hash));end loop;
 if new_unit then
 unit_ordinal:=(state->>'unitsReserved')::integer+1;unit_content:=jsonb_build_object('ordinal',unit_ordinal,'windowUnitOrdinal',unit_ordinal,'kind',case when new_cycle then 'initial_cycle' else 'phase_repair' end,'logicalCycleId',c.id,'phaseAttemptId',aid,'phase',phase,'repairOrdinal',repair_ordinal);
 insert into private.r12_direct_counted_units values(p_scope,unit_ordinal,c.id,aid,unit_content,private.stage14_hash(unit_content),clock_timestamp());
 else select u.ordinal into strict unit_ordinal from private.r12_direct_counted_units u where u.scope_id=p_scope and u.logical_cycle_id=c.id and u.content->>'kind'='initial_cycle';end if;
 insert into private.r12_direct_repair_phase_metadata values(aid,p_scope,seq,c.id,unit_ordinal,replaced,selection,selection->>'selectionHash',reuse,case when reuse is null then null else private.stage14_hash(reuse) end,clock_timestamp());
 fresh:=private.r12_direct_execution_quote(s,aid,ordinal,phase,q);
 select value into strict step from jsonb_array_elements(s.plan->'steps') x where x->>'key'=phase;
 select id into strict child from private.r07_children where plan_id=s.plan_id and step_key=phase;
 semantic:=jsonb_build_object('version','r12.direct-phase-semantic-input.1','scopeId',p_scope,'scopeHash',s.scope_hash,'policyHash',s.policy->>'policyHash','phase',phase,'phaseAttemptId',aid,'ordinal',ordinal,'commandHash',c.command_hash,'dependencies',deps,'logicalCycleId',c.id,'repairOrdinal',repair_ordinal,'countedUnitOrdinal',unit_ordinal,'replacesAttemptId',replaced,'dependencySelectionHash',selection->>'selectionHash','sourceReuseHash',case when reuse is null then null else private.stage14_hash(reuse) end);
 if phase='source' then source:=jsonb_build_object('version','r12.etsy-insights-source-scope.1','operationId',private.stage4_deterministic_uuid('r12:direct-source:'||aid),'sourceAttemptId',aid,'businessId',s.business_id,'goalId',s.goal_id,'authorityRootId',e.authority_root_id,'scopeId',p_scope,'scopeHash',s.scope_hash,'originDirectRunId',e.origin_direct_run_id,'providerProjectId',s.source_access->'accountBinding'->>'providerProjectId','window',s.policy->'window','attemptOrdinal',ordinal,'windowAttemptOrdinal',ordinal,'criteriaHash',c.command->>'criteriaHash','questionHash',c.command->>'questionHash','quoteHash',s.policy->>'quoteHash','executionQuoteHash',q->>'quoteHash','executionQuoteProofHash',fresh->'proof'->>'compatibilityHash','sourcePolicyHash',s.policy->>'sourcePolicyHash','accountBinding',s.source_access->'accountBinding','capturePolicyHash',s.source_access->>'capturePolicyHash','query',c.command->>'query','expiresAt',private.r12_direct_time(least(s.expires_at,(q->>'validUntil')::timestamptz)),'maximumBrowserMicrounits',s.policy->'phaseMaximumMicrounits'->>'source','limits',jsonb_build_object('maximumSessionMs',least(120000,(select maximum_session_ms from private.r12_direct_browser_routes where route_hash=s.quote->'browser'->>'routeHash')),'maximumActions',8,'maximumTextBytes',32000,'maximumScreenshotBytes',2000000,'maximumTotalCaptureBytes',2032000));end if;
 insert into private.r07_core_admissions values(txid_current(),aid);
 insert into public.workflow_runs(id,business_id,goal_id,workflow_definition_id,idempotency_key,status,input,state,runtime_capability_hash,pack_installation_id,pack_snapshot)
 select aid,s.business_id,s.goal_id,(step->>'workflowDefinitionId')::uuid,'r07:'||aid,'queued',semantic,jsonb_build_object('r07PlanId',s.plan_id,'r07ChildId',child,'r07StepKey',phase,'directCycleOrdinal',ordinal),encode(extensions.digest(payload->>'runtimeCapability','sha256'),'hex'),i.id,i.snapshot from public.installed_packs i where i.id=(step->>'installationId')::uuid;
 insert into private.r12_direct_phase_attempts(attempt_id,scope_id,ordinal,phase,request_id,quote,dependency_pins,semantic_input,semantic_hash,source_scope,execution_quote_proof,execution_authority,repair_ordinal)
 values(aid,p_scope,ordinal,phase,gen_random_uuid(),q,deps,semantic,private.stage14_hash(semantic),source,fresh->'proof',fresh->'authority',repair_ordinal);
 insert into private.r07_attempts(id,business_id,goal_id,plan_id,child_id,step_key,attempt,input_hash,dependency_pins,status,reason,repair_evidence_hash,direct_cycle_ordinal)
 values(aid,s.business_id,s.goal_id,s.plan_id,child,phase,unit_ordinal,private.r04_hash(semantic),deps,'scheduled','direct_phase_scheduled',c.command_hash,ordinal);
 insert into public.workflow_stage_runs(id,business_id,workflow_run_id,stage_key,sequence,attempt,status) values(private.stage4_deterministic_uuid('r07:stage:'||aid),s.business_id,aid,'bounded',1,1,'pending');
 insert into public.task_contracts(id,business_id,workflow_run_id,workflow_stage_run_id,worker_definition_id,status,objective,input_artifact_ids,permitted_capabilities,completion_criteria,non_goals,escalation_rules)
 values(private.stage4_deterministic_uuid('r07:task:'||aid),s.business_id,aid,private.stage4_deterministic_uuid('r07:stage:'||aid),(step->>'workerDefinitionId')::uuid,'ready',step->>'objective',array(select o.artifact_id from jsonb_array_elements(deps) x join private.r07_responses o on o.attempt_id=(x->>'attemptId')::uuid),array[step->>'operationKey'],jsonb_build_object('planHash',private.r04_hash(s.plan),'expectedArtifactType',step->>'expectedArtifactType','inputHash',private.r04_hash(semantic)),array['Broaden authority','Mint a new allowance','Claim measured commercial success'],jsonb_build_object('maximumAttempts',1,'directCycleOrdinal',ordinal));
 insert into public.worker_runs(id,business_id,workflow_run_id,task_contract_id,worker_definition_id,status) values(private.stage4_deterministic_uuid('r07:worker:'||aid),s.business_id,aid,private.stage4_deterministic_uuid('r07:task:'||aid),(step->>'workerDefinitionId')::uuid,'queued');
 update private.r07_heads set revision=revision+1,state='running',reason='direct_phase_scheduled',pivots_used=pivots_used+case when new_cycle and c.kind='pivot' then 1 else 0 end where goal_id=s.goal_id;
 delete from private.r07_core_admissions where transaction_id=txid_current() and workflow_run_id=aid;
 return jsonb_build_object('attemptId',aid,'requestId',(select request_id from private.r12_direct_phase_attempts where attempt_id=aid),'cycleId',c.id,'ordinal',ordinal,'logicalCycleId',c.id,'repairOrdinal',repair_ordinal,'countedUnitOrdinal',unit_ordinal,'phase',phase,'status','scheduled','shouldDispatch',false,'dependencyPins',deps,'inputs',private.r12_direct_inputs(aid),'state',private.r12_direct_state(p_scope));
end $$;

create function private.r12_direct_repair_phase_binding(p_attempt uuid,state jsonb) returns jsonb language plpgsql stable set search_path='' as $$
declare a private.r12_direct_phase_attempts;m private.r12_direct_repair_phase_metadata;s private.r12_direct_research_setups;body jsonb;begin
 select * into strict a from private.r12_direct_phase_attempts where attempt_id=p_attempt;select * into strict m from private.r12_direct_repair_phase_metadata where attempt_id=p_attempt;select * into strict s from private.r12_direct_research_setups where scope_id=a.scope_id;
 body:=jsonb_build_object('version','r12.public-research-phase-binding.2','policyHash',s.policy->>'policyHash','stateHash',state->>'stateHash','logicalCycleId',m.logical_cycle_id,'logicalCycleOrdinal',a.ordinal,'windowAttemptOrdinal',a.ordinal,'phase',a.phase,'phaseAttemptId',a.attempt_id,'requestId',a.request_id,'repairOrdinal',a.repair_ordinal,'countedUnitOrdinal',m.counted_unit_ordinal,'replacesAttemptId',m.replaces_attempt_id,'dependencies',m.dependency_selection,'sourceReuseHash',m.source_reuse_hash,'semanticProgress',false);
 return body||jsonb_build_object('bindingHash',private.stage14_hash(body));
end $$;
create function private.r12_direct_repair_inputs(p_attempt uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare a private.r12_direct_phase_attempts;m private.r12_direct_repair_phase_metadata;s private.r12_direct_research_setups;body jsonb;state jsonb;sources jsonb;deps jsonb:='{"plan":null,"strategy":null}';k text;qualification jsonb;begin
 select input into body from private.r12_direct_phase_input_snapshots where attempt_id=p_attempt;if found then return body;end if;
 select * into strict a from private.r12_direct_phase_attempts where attempt_id=p_attempt;select * into strict s from private.r12_direct_research_setups where scope_id=a.scope_id;select * into strict m from private.r12_direct_repair_phase_metadata where attempt_id=p_attempt;
 if a.phase='source' then return a.source_scope;end if;
 foreach k in array array['plan','strategy'] loop if m.dependency_selection->k<>'null'::jsonb then deps:=deps||jsonb_build_object(k,private.r12_direct_completed((m.dependency_selection->k->>'phaseAttemptId')::uuid));end if;end loop;
 select coalesce(jsonb_agg(jsonb_build_object('scope',x.source_scope,'receipt',b.content,'accounting',r.source_proof->'accounting') order by x.ordinal),'[]') into sources from private.r12_direct_phase_attempts x join private.r12_direct_phase_receipts r on r.attempt_id=x.attempt_id and r.source_proof is not null join private.r12_direct_browser_receipts b on b.operation_id=(x.source_scope->>'operationId')::uuid where x.scope_id=a.scope_id;
 select content into qualification from private.r12_direct_review_qualifications where scope_id=a.scope_id and ordinal=a.ordinal;state:=private.r12_direct_repair_state(a.scope_id);
 body:=jsonb_build_object('version','r12.public-research-phase-inputs.2','format','r12.discovery-direct.1','phase',a.phase,'phaseAttemptId',p_attempt,'validationAt',floor(extract(epoch from (a.execution_quote_proof->>'verifiedAt')::timestamptz)*1000)::bigint,'planHash',private.r04_hash(s.plan),'policy',s.policy,'approvedQuote',s.quote,'quote',a.quote,'executionQuoteProof',a.execution_quote_proof,'profile',s.content->'profile','state',state,'originHistory',s.content->'originHistory','sourcePackets',sources,'dependencies',deps,'reviewQualification',coalesce(qualification,private.r12_direct_default_qualification(s)),'repair',private.r12_direct_repair_phase_binding(p_attempt,state));
 return body||jsonb_build_object('inputHash',private.stage14_hash(body));
end $$;

create function private.r12_direct_repair_wire_metadata(p_attempt uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('inputVersion','r12.public-research-phase-inputs.2','logicalCycleId',m.logical_cycle_id,'repairOrdinal',a.repair_ordinal,'countedUnitOrdinal',m.counted_unit_ordinal,'replacesAttemptId',m.replaces_attempt_id,'dependencySelectionHash',m.dependency_selection_hash,'sourceReuseHash',m.source_reuse_hash) from private.r12_direct_phase_attempts a join private.r12_direct_repair_phase_metadata m on m.attempt_id=a.attempt_id where a.attempt_id=p_attempt
$$;
create function private.r12_direct_repair_wire_context(i jsonb) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('version','r12.direct-repair-context.1','logicalCycleId',i->'repair'->'logicalCycleId','logicalCycleOrdinal',i->'repair'->'logicalCycleOrdinal','windowAttemptOrdinal',i->'repair'->'windowAttemptOrdinal','repairOrdinal',i->'repair'->'repairOrdinal','countedUnitOrdinal',i->'repair'->'countedUnitOrdinal','replacesAttemptId',i->'repair'->'replacesAttemptId','dependencySelectionHash',i->'repair'->'dependencies'->'selectionHash','sourceReuseHash',i->'repair'->'sourceReuseHash','reusedSourceIsNewEvidence',false,'semanticProgress',false,'units',jsonb_build_object('maximum',i->'state'->'maximumUnitsInWindow','reserved',i->'state'->'unitsReserved','consumedBeforeCurrentDispatch',(i->'state'->>'unitsConsumed')::integer-case when i->'state'->'actualPhaseCalls'->-1->>'status'='dispatched' and exists(select 1 from jsonb_array_elements(i->'state'->'countedUnits') u where u->>'phaseAttemptId'=i->>'phaseAttemptId') then 1 else 0 end,'logicalCyclesStarted',i->'state'->'logicalCyclesStarted'),'failures',coalesce((select jsonb_agg(jsonb_build_object('logicalCycleId',c->'logicalCycleId','logicalCycleOrdinal',c->'logicalCycleOrdinal','phaseAttemptId',c->'phaseAttemptId','phase',c->'phase','repairOrdinal',c->'repairOrdinal','countedUnitOrdinal',c->'countedUnitOrdinal','receiptHash',c->'receiptHash','diagnostic',coalesce(c->'failure'->'diagnostic',c->'failure'->'reason'),'actualMicrounits',c->'actualMicrounits','maximumMicrounits',c->'maximumMicrounits')) from jsonb_array_elements(i->'state'->'actualPhaseCalls') c where c->'failure'<>'null'::jsonb),'[]'::jsonb))
$$;


create function private.r12_direct_repair_local_history(state jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare a jsonb;r jsonb;q jsonb;history jsonb:='[]';rationales jsonb;supporting jsonb;contrary jsonb;missing jsonb;review jsonb;begin
 for a in select value from jsonb_array_elements(state->'logicalCycles') with ordinality x(value,ord) where ord<jsonb_array_length(state->'logicalCycles') order by ord loop
 r:=a->'review';review:='null';if r is not null and r<>'null'::jsonb then
 rationales:='[]';supporting:=r->'conclusionEvidenceRefs';contrary:=r->'contraryEvidenceRefs';missing:=r->'missingCriticalRequirements';
 for q in select value from jsonb_each(r->'quality'->'quality') loop rationales:=rationales||jsonb_build_array(q->>'rationale');supporting:=supporting||(q->'evidenceRefs');contrary:=contrary||(q->'contraryRefs');missing:=missing||(q->'missingFacts');end loop;
 review:=jsonb_build_object('reviewHash',r->>'reviewHash','outcome',r->>'outcome','hypothesisFinding',r->>'hypothesisFinding','conclusion',r->>'conclusion','qualityBasisPoints',r->'quality'->'qualityBasisPoints','findingRationales',private.r12_direct_origin_set(rationales),'supportingEvidenceRefs',private.r12_direct_origin_set(supporting),'contraryEvidenceRefs',private.r12_direct_origin_set(contrary),'missingFacts',private.r12_direct_origin_set(missing));end if;
 history:=history||jsonb_build_array(jsonb_build_object('attemptOrdinal',a->'ordinal','logicalCycleId',a->'logicalCycleId','kind',a->>'kind','status',a->>'status','command',a->'command','review',review));end loop;return history;
end $$;

create function private.r12_direct_repair_local_history_wire(state jsonb,evidence jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare a jsonb;r jsonb;history jsonb:='[]';begin
 for a in select value from jsonb_array_elements(private.r12_direct_repair_local_history(state)) loop
 r:=a->'review';if r is not null and r<>'null'::jsonb then r:=r||jsonb_build_object('supportingEvidenceRefs',private.r12_direct_wire_refs(r->'supportingEvidenceRefs',evidence),'contraryEvidenceRefs',private.r12_direct_wire_refs(r->'contraryEvidenceRefs',evidence));end if;
 history:=history||jsonb_build_array(a||jsonb_build_object('command',(a->'command')-array['criteriaHash','questionHash'],'review',r));end loop;return history;
end $$;

create function private.r12_direct_repair_model_semantic(p_attempt uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare i jsonb:=private.r12_direct_inputs(p_attempt);a jsonb;projection jsonb;body jsonb;begin
 a:=i->'state'->'logicalCycles'->-1;projection:=private.r12_direct_model_projection(i);
 body:=jsonb_build_object('profile',jsonb_build_object('publicGoal',i->'profile'->>'publicGoal','productFormat',i->'profile'->>'productFormat','category',i->'profile'->>'category','markets',i->'profile'->'markets','audience',i->'profile'->>'audience'),'command',a->'command','sourceEvidence',coalesce((select jsonb_agg(x-'captureHash') from jsonb_array_elements(projection->'evidence') x),'[]'::jsonb),'sourceContexts',coalesce((select jsonb_agg((x-array['sourceReceiptHash','factsHash'])||jsonb_build_object('facts',coalesce((select jsonb_agg(f) from jsonb_array_elements(x->'facts') f where f->>'kind'<>'query'),'[]'::jsonb))) from jsonb_array_elements(projection->'sourceContexts') x),'[]'::jsonb),'evidenceSelection',projection->'disclosure','history',jsonb_build_object('originHistoryHash',i->'originHistory'->>'historyHash','materialHistory',coalesce((select jsonb_agg(jsonb_build_object('kind',x->>'kind','recordHash',x->>'recordHash','statement',x->>'statement')) from jsonb_array_elements(i->'originHistory'->'materialHistory') x),'[]'),'seenQuestions',jsonb_build_object('count',jsonb_array_length(i->'state'->'history'->'seenQuestionHashes'),'hash',private.stage14_hash(i->'state'->'history'->'seenQuestionHashes')),'seenQuoteIdentities',jsonb_build_object('count',jsonb_array_length(i->'state'->'history'->'seenEvidenceIdentityHashes'),'hash',private.stage14_hash(i->'state'->'history'->'seenEvidenceIdentityHashes')),'seenFactIdentities',jsonb_build_object('count',jsonb_array_length(i->'state'->'history'->'seenFactIdentityHashes'),'hash',private.stage14_hash(i->'state'->'history'->'seenFactIdentityHashes')),'nonprogress',i->'state'->'history'->'consecutiveNonprogress','localAttempts',private.r12_direct_repair_local_history_wire(i->'state',projection->'evidence'),'continuityHash',private.stage14_hash(i->'state'->'history')),'plan',i->'dependencies'->'plan'->'candidate'->'output','strategy',i->'dependencies'->'strategy'->'candidate'->'output','requirements',i->'reviewQualification','proposalHash',i->'dependencies'->'strategy'->'response'->'result'->>'proposalHash','window',jsonb_build_object('maximumAttemptsInWindow',i->'policy'->'window'->'maximumAttemptsInWindow','windowAttemptOrdinal',a->'windowAttemptOrdinal','attemptOrdinal',a->'ordinal','nmeCountInEpoch',i->'state'->'nmeCountInEpoch','epochOrdinal',a->'epochOrdinal'));
 if i->>'phase'='review' then body:=body||jsonb_build_object('rubric',private.r12_direct_quality_rubric());end if;
 return body||jsonb_build_object('repair',private.r12_direct_repair_wire_context(i));
end $$;

create function private.r12_direct_repair_wire_check(a private.r12_direct_phase_attempts,v jsonb) returns void language plpgsql set search_path='' as $$
declare s private.r12_direct_research_setups;e private.r12_direct_test_envelopes;j jsonb;b jsonb;static jsonb;semantic jsonb;route jsonb;metadata jsonb;c private.r12_direct_research_cycles;begin
 select * into strict s from private.r12_direct_research_setups where scope_id=a.scope_id;select * into strict e from private.r12_direct_test_envelopes where id=s.envelope_id;
 if a.phase='source' then raise exception 'r12_direct_source_is_not_a_model';end if;perform private.r12_direct_research_quote(e,a.quote,s.quote);
 perform private.r04_keys(v,array['version','scopeId','scopeHash','attemptId','requestId','phase','requestJson','requestHash','wireBody','wireHash','quote','dependencyPins']);
 if v->>'version' is distinct from 'r12.discovery-wire.1' or v->>'scopeId' is distinct from a.scope_id::text or v->>'scopeHash' is distinct from s.scope_hash or v->>'attemptId' is distinct from a.attempt_id::text or v->>'requestId' is distinct from a.request_id::text or v->>'phase' is distinct from a.phase or v->'dependencyPins' is distinct from a.dependency_pins or v->'quote' is distinct from a.quote then raise exception 'r12_direct_wire_scope_mismatch';end if;
 j:=(v->>'requestJson')::jsonb;b:=(v->>'wireBody')::jsonb;static:=private.r12_direct_model_static(a.phase);semantic:=private.r12_direct_model_semantic(a.attempt_id);route:=a.quote->'inference'->case when a.phase='review' then 'reviewer' else 'luna' end;
 select * into strict c from private.r12_direct_research_cycles where scope_id=a.scope_id and ordinal=a.ordinal;
 metadata:=jsonb_build_object('format','r12.discovery-direct.1','policyHash',s.policy->>'policyHash','scopeHash',s.scope_hash,'originDirectRunId',s.policy->>'originDirectRunId','windowId',s.policy->'window'->>'windowId','windowOrdinal',1,'windowAttemptOrdinal',a.ordinal,'attemptOrdinal',a.ordinal,'criteriaHash',c.command->>'criteriaHash','questionHash',c.command->>'questionHash','semanticContextHash',private.stage14_hash(semantic),'evidenceSelectionHash',semantic->'evidenceSelection'->>'selectionHash','executionQuoteHash',a.quote->>'quoteHash','executionQuoteProofHash',a.execution_quote_proof->>'compatibilityHash');
 metadata:=metadata||private.r12_direct_repair_wire_metadata(a.attempt_id);
 perform private.r04_keys(j,array['model','schemaName','outputSchema','messages','requestMetadata','maxOutputTokens','providerOnly','providerDataCollection','providerZdr','providerPriceLimit','requireReturnedModel']);
 perform private.r04_keys(b,array['model','max_tokens','messages','response_format','provider','stream']);
 if v->>'requestHash' is distinct from private.stage14_hash(j) or v->>'wireHash' is distinct from encode(extensions.digest(convert_to(v->>'wireBody','UTF8'),'sha256'),'hex')
 or octet_length(v->>'requestJson')>(private.r12_direct_model_request_bytes(a.quote)->>a.phase)::integer or octet_length(v->>'wireBody')>(private.r12_direct_model_request_bytes(a.quote)->>a.phase)::integer
 or j->'model'->>'providerModelId' is distinct from route->>'modelId' or j->>'schemaName' is distinct from static->>'schemaName' or j->'outputSchema' is distinct from static->'outputSchema'
 or j->'requestMetadata' is distinct from metadata or j->'maxOutputTokens' is distinct from a.quote->'inference'->'outputTokens'->a.phase
 or j->'providerOnly' is distinct from jsonb_build_array(route->>'endpoint') or j->'providerDataCollection' is distinct from '"deny"'::jsonb or j->'providerZdr' is distinct from 'true'::jsonb or j->'providerPriceLimit' is distinct from route->'priceLimit' or j->'requireReturnedModel' is distinct from 'true'::jsonb
 or jsonb_array_length(j->'messages')<>2 or j->'messages'->0 is distinct from jsonb_build_object('role','system','content',static->>'systemInstruction')
 or j->'messages'->1->>'role' is distinct from 'user' or (j->'messages'->1->>'content')::jsonb is distinct from semantic
 or b->>'model' is distinct from route->>'modelId' or b->'max_tokens' is distinct from j->'maxOutputTokens' or b->'messages' is distinct from j->'messages' or b->'stream' is distinct from 'false'::jsonb
 or b->'provider' is distinct from jsonb_build_object('allow_fallbacks',false,'require_parameters',true,'max_price',route->'priceLimit','only',jsonb_build_array(route->>'endpoint'),'data_collection','deny','zdr',true)
 or b->'response_format' is distinct from jsonb_build_object('type','json_schema','json_schema',jsonb_build_object('name',static->>'schemaName','strict',true,'schema',private.r12_direct_provider_schema(static->'outputSchema')))
 then raise exception 'r12_direct_exact_model_wire_required';end if;
 perform private.r04_keys(j->'messages'->1,array['role','content']);
end $$;

create function private.r12_direct_repair_strategy(i jsonb,raw jsonb) returns jsonb language plpgsql stable set search_path='' as $$
declare assessment jsonb:=raw->'assessment';proposal jsonb;candidate jsonb;dim jsonb;selected jsonb;refs jsonb;keys jsonb;nonblocking integer:=0;complete boolean;readiness jsonb;body jsonb;begin
 if not private.r12_direct_schema_valid(raw,private.r12_direct_model_static('strategy')->'outputSchema') then raise exception 'r12_direct_response_schema';end if;
 refs:=coalesce((select jsonb_agg(x->>'ref') from jsonb_array_elements(private.r12_direct_model_semantic((i->>'phaseAttemptId')::uuid)->'sourceEvidence') x),'[]');perform private.r12_direct_citations(raw,refs);
 select jsonb_agg('C'||ord) into keys from jsonb_array_elements(i->'dependencies'->'plan'->'candidate'->'output'->'proposals') with ordinality x(v,ord);
 if private.r12_direct_origin_set(coalesce((select jsonb_agg(x->'candidateKey') from jsonb_array_elements(assessment->'candidates') x),'[]')) is distinct from keys
 or (select jsonb_agg(jsonb_build_object('countryCode',x->>'countryCode','currency',x->>'currency') order by x->>'countryCode') from jsonb_array_elements(assessment->'marketComparisons') x) is distinct from (select jsonb_agg(x order by x->>'countryCode') from jsonb_array_elements(i->'profile'->'markets') x)
 then raise exception 'r12_direct_complete_comparison_required';end if;
 for candidate in select value from jsonb_array_elements(assessment->'candidates') loop
 if (select jsonb_agg(x->>'dimension' order by x->>'dimension') from jsonb_array_elements(candidate->'dimensions') x) is distinct from '["competition","creative_opportunity","demand","differentiation","estimated_margin","marketing_potential","policy_ip_risk","production_complexity","seasonality"]'::jsonb
 or exists(select 1 from jsonb_array_elements(candidate->'dimensions') x where x->>'finding'='supported' and (jsonb_array_length(x->'facts')=0 or x->>'evidenceStrength'='none')) then raise exception 'r12_direct_nine_dimension_required';end if;end loop;
 if exists(select 1 from jsonb_array_elements(assessment->'marketComparisons') x where x->'sellerBankCountry'<>'null'::jsonb or exists(select 1 from jsonb_array_elements(x->'feeScenarios') f where f->'hypothetical'<>'true'::jsonb))
 or (assessment->'recommendation'->'candidateKey'<>'null'::jsonb and not keys ? (assessment->'recommendation'->>'candidateKey'))
 or (assessment->'recommendation'->'marketCountryCode'<>'null'::jsonb and not exists(select 1 from jsonb_array_elements(i->'profile'->'markets') x where x->'countryCode'=assessment->'recommendation'->'marketCountryCode'))
 or (select coalesce(jsonb_agg(x->>'candidateKey' order by x->>'candidateKey'),'[]') from jsonb_array_elements(assessment->'recommendation'->'alternatives') x) is distinct from (select coalesce(jsonb_agg(x order by x),'[]') from jsonb_array_elements_text(keys) x where x is distinct from assessment->'recommendation'->>'candidateKey')
 or (assessment->'testPlan'='null'::jsonb) is distinct from (raw->'measurement'='null'::jsonb) then raise exception 'r12_direct_strategy_boundary_invalid';end if;
 select value into selected from jsonb_array_elements(assessment->'candidates') x where x->'candidateKey'=assessment->'recommendation'->'candidateKey';
 if selected is not null then select count(*) into nonblocking from jsonb_array_elements(selected->'dimensions') x where x->'hardFailure'='false'::jsonb and not exists(select 1 from jsonb_array_elements(x->'uncertainties') u where u->'blockingForTest'='true'::jsonb);end if;
 complete:=assessment->'testPlan'<>'null'::jsonb and raw->'measurement'<>'null'::jsonb and jsonb_array_length(assessment->'testPlan'->'evidence')>0 and assessment->'recommendation'->'candidateKey'<>'null'::jsonb and assessment->'recommendation'->'marketCountryCode'<>'null'::jsonb;
 readiness:=jsonb_build_object('dimensionCount',coalesce(jsonb_array_length(selected->'dimensions'),0),'nonblockingDimensions',nonblocking,'testPlanComplete',complete,'testReadinessPassed',assessment->'recommendation'->>'proposedOutcome'='TEST' and complete and nonblocking=9,'commercialDemandProven',false);
 body:=jsonb_build_object('version','r12.public-strategy.1','policyHash',i->'policy'->>'policyHash','attemptOrdinal',i->'state'->'logicalCycles'->-1->'ordinal','assessment',assessment,'measurement',raw->'measurement','readiness',readiness,'rawResponseHash',private.stage14_hash(raw));
 return body||jsonb_build_object('proposalHash',private.stage14_hash(body));
end $$;

create function private.r12_direct_repair_review(i jsonb,raw jsonb,receipt_hash text,candidate jsonb) returns jsonb language plpgsql stable set search_path='' as $$
declare a jsonb:=i->'state'->'logicalCycles'->-1;p jsonb:=i->'policy';q jsonb:=i->'reviewQualification';strategy jsonb;source jsonb;earlier jsonb;refs jsonb;visible_refs jsonb;quality_context jsonb;context jsonb;quality jsonb;outcome text:='NME';body jsonb;begin
 if not private.r12_direct_schema_valid(raw,private.r12_direct_model_static('review')->'outputSchema') then raise exception 'r12_direct_response_schema';end if;
 strategy:=private.r12_direct_strategy(i,i->'dependencies'->'strategy'->'candidate'->'output');
 if raw->>'proposalHash' is distinct from strategy->>'proposalHash' or i->'dependencies'->'strategy'->'candidate'->>'providerModelId'=candidate->>'providerModelId' then raise exception 'r12_direct_independent_review_required';end if;
 source:=a->'sourceProof';select coalesce(jsonb_agg(x->'sourceProof' order by (x->>'ordinal')::integer),'[]') into earlier from jsonb_array_elements(i->'state'->'logicalCycles') x where (x->>'ordinal')::integer<(a->>'ordinal')::integer and x->'sourceProof'<>'null'::jsonb;
 select jsonb_agg(w->>'ref') into refs from jsonb_array_elements(earlier||jsonb_build_array(source)) x cross join lateral jsonb_array_elements(x->'witnesses') w;
 select jsonb_agg(x->>'ref') into visible_refs from jsonb_array_elements(private.r12_direct_model_semantic((i->>'phaseAttemptId')::uuid)->'sourceEvidence') x;perform private.r12_direct_citations(raw,visible_refs);
 quality_context:=jsonb_build_object('allowedEvidenceRefs',refs,'missingCriticalRequirements',q->'missingCriticalRequirements','comparativeConclusion',q->'comparativeConclusion','materialOpposingExplanation',q->'materialOpposingExplanation','sourceAcquisitionVerified',true,'citationGroundingVerified',true,'independentReviewerVerified',true,'sourceTemporalPrecisionSufficient',q->'sourceTemporalPrecisionSufficient','claimBoundariesRespected',q->'claimBoundariesRespected');
 quality:=private.r12_direct_quality(raw->'quality',quality_context);perform private.r12_direct_command_check(raw->'proposedCommand',true);
 if quality->'passed'='true'::jsonb and jsonb_array_length(raw->'conclusionEvidenceRefs')>0 and raw->>'hypothesisFinding'='supported' and raw->>'learningRecommendation'='TEST' and strategy->'readiness'->'testReadinessPassed'='true'::jsonb and q->'supportingEvidenceVerified'='true'::jsonb then outcome:='TEST';end if;
 if quality->'passed'='true'::jsonb and jsonb_array_length(raw->'conclusionEvidenceRefs')>0 and jsonb_array_length(raw->'contraryEvidenceRefs')>0 and raw->>'hypothesisFinding'='refuted' and raw->>'learningRecommendation'='REJECT' and q->'refutingEvidenceVerified'='true'::jsonb then outcome:='REJECT';end if;
 if outcome<>'NME' and raw->'proposedCommand'->>'kind'<>'finish' then raise exception 'r12_direct_terminal_command_invalid';end if;
 context:=jsonb_build_object('policy',p,'attemptOrdinal',a->'ordinal','criteriaHash',a->'command'->>'criteriaHash','questionHash',a->'command'->>'questionHash','proposalHash',strategy->>'proposalHash','producerModelId',i->'dependencies'->'strategy'->'candidate'->>'providerModelId','reviewerModelId',candidate->>'providerModelId','strategyReceiptHash',i->'dependencies'->'strategy'->'response'->'result'->>'modelReceiptHash','reviewReceiptHash',receipt_hash,'reviewResponseHash',private.stage14_hash(raw),'currentSourceProof',source,'earlierSourceProofs',earlier,'persistedProofsAuthenticated',true,'qualityContext',quality_context,'testReadinessPassed',strategy->'readiness'->'testReadinessPassed','supportingEvidenceVerified',q->'supportingEvidenceVerified','refutingEvidenceVerified',q->'refutingEvidenceVerified');
 body:=jsonb_build_object('version','r12.direct-etsy-reviewed-result.1','businessId',p->>'businessId','goalId',p->>'goalId','scopeId',p->>'scopeId','scopeHash',p->>'scopeHash','originDirectRunId',p->>'originDirectRunId','windowId',p->'window'->>'windowId','windowOrdinal',p->'window'->'windowOrdinal','windowAttemptOrdinal',a->'windowAttemptOrdinal','attemptOrdinal',a->'ordinal','criteriaHash',a->'command'->>'criteriaHash','questionHash',a->'command'->>'questionHash','proposalHash',strategy->>'proposalHash','strategyReceiptHash',context->>'strategyReceiptHash','reviewReceiptHash',receipt_hash,'reviewResponseHash',private.stage14_hash(raw),'quality',quality,'outcome',outcome,'hypothesisFinding',case outcome when 'TEST' then 'supported' when 'REJECT' then 'refuted' else 'undetermined' end,'terminal',case outcome when 'TEST' then 'RESEARCH_PASSED_SUPPORTS_TEST' when 'REJECT' then 'RESEARCH_PASSED_REJECTS_HYPOTHESIS' else null end,'proposedCommand',raw->'proposedCommand','conclusion',raw->>'conclusion','conclusionEvidenceRefs',raw->'conclusionEvidenceRefs','contraryEvidenceRefs',raw->'contraryEvidenceRefs','missingCriticalRequirements',q->'missingCriticalRequirements','rawResponseHash',private.stage14_hash(raw),'contextHash',private.stage14_hash(context),'executionAuthorized',false);
 return body||jsonb_build_object('reviewHash',private.stage14_hash(body));
end $$;

create function private.r12_direct_repair_model_receipt(p_scope uuid,payload jsonb) returns jsonb language plpgsql set search_path='' as $$
declare s private.r12_direct_research_setups;a private.r12_direct_phase_attempts;c jsonb:=payload->'candidate';proof jsonb:=payload->'proof';old private.r12_direct_phase_receipts;w private.r12_direct_phase_wires;candidate_row private.r12_discovery_candidates;i jsonb;normalized jsonb;extra jsonb:='{}';result jsonb;receipt jsonb;rh text;diagnostic text;failure jsonb;mark timestamptz;cost bigint;state jsonb;begin
 perform private.r04_keys(payload,array['attemptId','candidate','proof']);s:=private.r12_direct_research_current(p_scope,true);perform private.r12_direct_candidate(p_scope,payload-'proof');
 select * into a from private.r12_direct_phase_attempts where attempt_id=(payload->>'attemptId')::uuid and scope_id=p_scope and phase in ('plan','strategy','review');
 if a.attempt_id is null then raise exception 'r12_direct_actual_model_phase_required';end if;
 select * into old from private.r12_direct_phase_receipts where attempt_id=a.attempt_id;
 if found then if old.candidate is distinct from c or old.route_proof is distinct from proof then raise exception 'r12_direct_model_receipt_conflict';end if;return jsonb_build_object('recorded',true,'receiptHash',old.receipt_hash,'replayed',true,'state',private.r12_direct_state(p_scope));end if;
 select * into strict w from private.r12_direct_phase_wires where attempt_id=a.attempt_id;select created_at into strict mark from private.r05_markers where request_id=a.request_id;
 perform private.r04_keys(c,array['version','scopeId','attemptId','requestId','phase','requestHash','providerRequestId','providerModelId','receivedAt','reportedMicrousd','output']);
 if c->>'version' is distinct from 'r12.discovery-response.1' or c->>'scopeId' is distinct from p_scope::text or c->>'attemptId' is distinct from a.attempt_id::text or c->>'requestId' is distinct from a.request_id::text or c->>'phase' is distinct from a.phase or c->>'requestHash' is distinct from w.request_hash
 or (c->>'providerRequestId'!~'^gen-[A-Za-z0-9_-]+$' or length(c->>'providerRequestId')>300) or not (a.quote->'inference'->case when a.phase='review' then 'reviewer' else 'luna' end->'acceptedResponseModelIds' ? (c->>'providerModelId'))
 or (c->>'receivedAt')::timestamptz<mark or (c->>'receivedAt')::timestamptz>=mark+interval '60 minutes' or (c->>'receivedAt')::timestamptz>clock_timestamp()+interval '5 seconds'
 or jsonb_typeof(c->'reportedMicrousd') is distinct from 'number' or c->>'reportedMicrousd'!~'^(0|[1-9][0-9]{0,7})$' or (c->>'reportedMicrousd')::bigint>(s.policy->'phaseMaximumMicrounits'->>a.phase)::bigint
 or jsonb_typeof(c->'output') is distinct from 'object' or octet_length(c::text)>(case when a.phase='strategy' then 73728 else 32768 end)
 then raise exception 'r12_direct_qualified_model_candidate_required';end if;
 candidate_row.candidate:=c;perform private.r12_discovery_proof_validate(candidate_row,proof);cost:=(c->>'reportedMicrousd')::bigint;
 perform private.r05_claim_receipt(s.business_id,a.attempt_id,'r12:direct:'||a.attempt_id,c->>'providerRequestId');
 receipt:=jsonb_build_object('version','r12.public-model-receipt-pin.1','phase',a.phase,'scopeId',p_scope,'phaseAttemptId',a.attempt_id,'requestId',a.request_id,'requestHash',w.request_hash,'candidateHash',private.stage14_hash(c),'routeProofHash',proof->>'proofHash');rh:=private.stage14_hash(receipt);
 insert into private.r05_settlements(request_id,business_id,currency,actual_microunits,provider_request_id,receipt_hash) values(a.request_id,s.business_id,'USD',cost,c->>'providerRequestId',rh);
 i:=private.r12_direct_inputs(a.attempt_id);
 begin
 if octet_length(private.stage14_canonical(c))>(case when a.phase='strategy' then 65536 else 16384 end) then raise exception 'r12_direct_response_size';end if;
 if not private.r12_direct_schema_valid(c->'output',private.r12_direct_model_static(a.phase)->'outputSchema') then raise exception 'r12_direct_response_schema';end if;
 if a.phase='plan' then
 if exists(select 1 from jsonb_array_elements(c->'output'->'proposals') x where x->>'audience' is distinct from i->'profile'->>'audience') then raise exception 'r12_direct_plan_audience_changed';end if;
 normalized:=jsonb_build_object('version','r12.public-plan.1','comparisonRationale',c->'output'->>'comparisonRationale','queryFocus','[]'::jsonb,'proposals',(select jsonb_agg(x||jsonb_build_object('candidateKey','C'||ord) order by ord) from jsonb_array_elements(c->'output'->'proposals') with ordinality v(x,ord)),'executionAuthorized',false);extra:=jsonb_build_object('planProposalHash',private.stage14_hash(normalized));
 elsif a.phase='strategy' then normalized:=private.r12_direct_strategy(i,c->'output');extra:=jsonb_build_object('proposalHash',normalized->>'proposalHash','readiness',normalized->'readiness');
 else normalized:=private.r12_direct_review(i,c->'output',rh,c);extra:=jsonb_build_object('reviewHash',normalized->>'reviewHash','outcome',normalized->>'outcome','review',normalized);
 -- The NME command is domain qualification, so a malformed fourth pivot is a
 -- truthful paid failure, not a successful review or an allocation reset.
 if normalized->>'outcome'='NME' then
 perform private.r12_direct_command_check(normalized->'proposedCommand');
 state:=private.r12_direct_state(p_scope);
 if state->'history'->'seenQuestionHashes' ? (normalized->'proposedCommand'->>'questionHash') or exists(select 1 from private.r12_direct_research_cycles x where x.scope_id=p_scope and private.r12_direct_origin_text(x.command->>'query')=private.r12_direct_origin_text(normalized->'proposedCommand'->>'query')) then raise exception 'r12_direct_fresh_target_required';end if;
 if (state->>'nmeCountInEpoch')::integer=3 then if normalized->'proposedCommand'->>'kind'<>'pivot' or state->'seenCriteriaHashes' ? (normalized->'proposedCommand'->>'criteriaHash') then raise exception 'r12_direct_fourth_nme_requires_pivot';end if;
 elsif normalized->'proposedCommand'->>'kind'<>'targeted' or normalized->'proposedCommand'->>'criteriaHash' is distinct from state->>'epochCriteriaHash' then raise exception 'r12_direct_targeted_followup_required';end if;end if;
 end if;
 exception when others then diagnostic:=sqlerrm;if diagnostic not like 'r12_direct_%' then raise;end if;end;
 if diagnostic is not null then
 failure:=jsonb_build_object('version','r12.direct-settled-failure.1','phaseAttemptId',a.attempt_id,'requestId',a.request_id,'candidateHash',private.stage14_hash(c),'routeProofHash',proof->>'proofHash','modelReceiptHash',rh,'diagnostic',diagnostic,'actualMicrounits',cost::text);
 insert into private.r12_direct_phase_receipts values(a.attempt_id,receipt,rh,c,proof,null,failure,clock_timestamp());perform private.r12_direct_finish_phase(a,failure,false);state:=private.r12_direct_close_cycle(p_scope,a.ordinal,null,private.stage14_hash(failure));
 return jsonb_build_object('recorded',true,'accepted',false,'receiptHash',rh,'diagnostic',diagnostic,'state',state);end if;
 result:=jsonb_build_object('version','r12.discovery-call.1','format','r12.discovery-direct.1','phase',a.phase,'scopeId',p_scope,'phaseAttemptId',a.attempt_id,'attemptOrdinal',a.ordinal,'windowAttemptOrdinal',a.ordinal,'windowId',s.policy->'window'->>'windowId','policyHash',s.policy->>'policyHash','inputHash',i->>'inputHash','candidateHash',private.stage14_hash(c),'routeProofHash',proof->>'proofHash','outputHash',private.stage14_hash(c->'output'),'modelReceiptHash',rh,'evidenceSelectionHash',private.r12_direct_model_projection(i)->'selection'->>'selectionHash','knownMicrousd',cost,'normalized',normalized)||extra||private.r12_direct_repair_wire_metadata(a.attempt_id);
 insert into private.r12_direct_phase_receipts values(a.attempt_id,receipt,rh,c,proof,null,null,clock_timestamp());perform private.r12_direct_finish_phase(a,result,true);
 if a.phase='review' then state:=private.r12_direct_close_cycle(p_scope,a.ordinal,normalized);else state:=private.r12_direct_state(p_scope);end if;
 return jsonb_build_object('recorded',true,'accepted',true,'receiptHash',rh,'result',result,'completed',private.r12_direct_completed(a.attempt_id),'state',state);
end $$;

create function private.r12_direct_repair_dispatch(p_scope uuid,payload jsonb) returns jsonb language plpgsql set search_path='' as $$
declare s private.r12_direct_research_setups;a private.r12_direct_phase_attempts;e private.r12_direct_test_envelopes;v jsonb:=payload->'binding';descriptor jsonb;input jsonb;step jsonb;begin
 perform private.r04_keys(payload,array['attemptId','binding']);s:=private.r12_direct_research_current(p_scope);select * into strict e from private.r12_direct_test_envelopes where id=s.envelope_id;
 select * into a from private.r12_direct_phase_attempts where attempt_id=(payload->>'attemptId')::uuid and scope_id=p_scope;
 if a.attempt_id is null or a.phase='source' then raise exception 'r12_direct_actual_model_phase_required';end if;
 if exists(select 1 from private.r05_markers where request_id=a.request_id) then return jsonb_build_object('shouldDispatch',false,'reason','already_marked','attemptId',a.attempt_id,'requestId',a.request_id);end if;
 perform private.r12_direct_wire_check(a,v);perform private.r12_direct_financial_check(e.id,(s.policy->'phaseMaximumMicrounits'->>a.phase)::bigint);
 select value into strict step from jsonb_array_elements(s.plan->'steps') x where x->>'key'=a.phase;
 descriptor:=jsonb_build_object('version','r12.direct-model-request.1','businessId',s.business_id,'workflowRunId',a.attempt_id,'operationKey',step->>'operationKey','accounting',jsonb_build_object('kind','r05'),'idempotencyKey','r07:'||a.attempt_id,'requestHash',v->>'requestHash','wireRequestHash',v->>'wireHash','wireRequestBytes',octet_length(v->>'wireBody'),'maximumOutputTokens',a.quote->'inference'->'outputTokens'->a.phase,'sourceDomains',jsonb_build_array('etsy.com'),'dataClasses',jsonb_build_array('authenticated_aggregate_evidence','research_proposals'),'providerModelId',((v->>'requestJson')::jsonb)->'model'->>'providerModelId','testEnvelopeId',e.id,'testEnvelopeHash',e.content_hash,'directPolicyHash',s.policy->>'policyHash');
 insert into private.r05_requests(id,business_id,workflow_run_id,policy_id,idempotency_key,request_hash,payload,source_key,currency,liability_microunits) values(a.request_id,s.business_id,a.attempt_id,e.policy_id,'r07:'||a.attempt_id,private.r04_hash(descriptor),descriptor,'r12:direct:'||a.attempt_id,'USD',(s.policy->'phaseMaximumMicrounits'->>a.phase)::bigint);
 insert into private.r12_direct_request_bindings values(a.request_id,e.id,'research_model');
 insert into private.r12_direct_phase_wires values(a.attempt_id,a.request_id,v,private.stage14_hash(v),v->>'requestHash',v->>'wireHash',clock_timestamp());
 insert into private.r07_bindings values(a.attempt_id,s.business_id,a.request_id,v->>'wireHash',private.r04_hash(descriptor));
 insert into private.r05_reservations values(a.request_id,s.business_id,clock_timestamp());insert into private.r05_markers values(a.request_id,s.business_id,clock_timestamp());perform private.r12_direct_mark_phase(a);
input:=private.r12_direct_inputs(a.attempt_id);insert into private.r12_direct_phase_input_snapshots values(a.attempt_id,input,input->>'inputHash',clock_timestamp());
 return jsonb_build_object('shouldDispatch',true,'attemptId',a.attempt_id,'requestId',a.request_id,'requestHash',v->>'requestHash','wireHash',v->>'wireHash','inputs',input,'binding',jsonb_build_object('scopeId',p_scope,'attemptId',a.attempt_id,'requestId',a.request_id,'phase',a.phase,'request',(v->>'requestJson')::jsonb,'maximumMicrousd',(s.policy->'phaseMaximumMicrounits'->>a.phase)::bigint,'dispatchedAt',private.r12_direct_time((select created_at from private.r05_markers where request_id=a.request_id)),'receiptExpiresAt',private.r12_direct_time((select created_at+interval '60 minutes' from private.r05_markers where request_id=a.request_id))));
end $$;

create function private.r12_direct_confirm_research_v2(b uuid,payload jsonb,server_key text) returns jsonb language plpgsql set search_path='' as $$
declare s private.r12_direct_research_setups;e private.r12_direct_test_envelopes;c private.r12_direct_test_confirmations;pins jsonb;step jsonb;origin jsonb;h private.r07_heads;controller text;admission text;source text;begin
 perform private.r05_owner(b);perform private.r04_keys(payload,array['setupId','setupHash','submissionId']);
 select * into s from private.r12_direct_research_setups where id=(payload->>'setupId')::uuid and setup_hash=payload->>'setupHash' and business_id=b and owner_id=auth.uid();
 if s.id is null or s.policy->>'version' is distinct from 'r12.direct-etsy-attempt-policy.2' then raise exception 'r12_direct_exact_research_setup_required';end if;
 select * into strict e from private.r12_direct_test_envelopes where id=s.envelope_id;select * into strict c from private.r12_direct_test_confirmations where envelope_id=e.id;
 perform private.r12_direct_grant_check(b,e.goal_id,c.grant_id,server_key);
 if exists(select 1 from private.r12_direct_research_activations where setup_id=s.id) then return private.r12_direct_research_setup_receipt(s);end if;
 perform private.r12_direct_test_current(e.id);origin:=private.r12_direct_origin_frozen_check(b,e.goal_id,c.origin_hash);
 pins:=private.r12_direct_research_pins(e);perform private.r12_direct_account_check(e,s.source_access);perform private.r12_direct_research_quote(e,s.quote);
 perform private.r12_direct_financial_check(e.id,private.r05_money(s.quote->'maximumAttemptMicrounits'));
 select * into strict h from private.r07_heads where goal_id=e.goal_id and business_id=b for update;
 if h.plan_id<>c.predecessor_plan_id or s.expires_at<=clock_timestamp() or h.children_created+4>32 or h.dispatches+4>64
 or h.children_created<>(s.policy->>'baseChildren')::integer or h.dispatches<>(s.policy->>'baseDispatches')::integer then raise exception 'r12_direct_research_origin_changed';end if;
 controller:=encode(extensions.digest(private.r12_direct_key(server_key,b,e.goal_id,e.id,e.content_hash,s.quote->'browser'->>'routeHash','controller'),'sha256'),'hex');
 admission:=encode(extensions.digest(private.r12_direct_key(server_key,b,e.goal_id,e.id,e.content_hash,s.quote->'browser'->>'routeHash','admission'),'sha256'),'hex');
 source:=encode(extensions.digest(private.r12_direct_key(server_key,b,e.goal_id,e.id,e.content_hash,s.quote->'browser'->>'routeHash','source'),'sha256'),'hex');
 insert into private.r12_direct_research_activations values(s.scope_id,s.id,e.id,s.plan_id,controller,admission,source,s.expires_at+interval '30 days',clock_timestamp());
 insert into private.r07_plans(id,business_id,goal_id,version,previous_plan_id,policy_id,owner_id,content,content_hash,reason,evidence_hash)
 values(s.plan_id,b,e.goal_id,(origin->'predecessor'->'closure'->>'predecessorPlanVersion')::integer+1,c.predecessor_plan_id,e.policy_id,e.owner_id,s.plan,private.r04_hash(s.plan),'owner_confirmed_direct_insights',s.setup_hash);
 for step in select value from jsonb_array_elements(s.plan->'steps') loop
 insert into private.r07_children(business_id,goal_id,plan_id,step_key,authority_root_id,policy_id,scope)
 values(b,e.goal_id,s.plan_id,step->>'key',b,e.policy_id,jsonb_build_object('step',step,'originalAuthorityRootId',e.authority_root_id,'testEnvelopeId',e.id,'testEnvelopeHash',e.content_hash,'directPolicyHash',s.policy->>'policyHash','parentPlanHash',private.r04_hash(s.plan)));end loop;
 -- Moving the head preserves original lifetime counters, rather than resetting
 -- them to the four new children or the first ordinal of this finite window.
 update private.r07_heads set plan_id=s.plan_id,revision=revision+1,state='ready',reason='direct_research_confirmed',children_created=children_created+4,lease_hash=null,lease_expires_at=null where goal_id=e.goal_id;
 insert into private.r07_events(business_id,goal_id,plan_id,operation,payload) values(b,e.goal_id,s.plan_id,'direct_confirm',jsonb_build_object('testEnvelopeId',e.id,'setupHash',s.setup_hash,'scopeHash',s.scope_hash));
 return private.r12_direct_research_setup_receipt(s);
end $$;


create function private.r12_direct_repair_close_cycle(p_scope uuid,ordinal integer,review jsonb,failure_hash text default null) returns jsonb language plpgsql set search_path='' as $$
declare s private.r12_direct_research_setups;next_state jsonb;body jsonb;cmd jsonb;a private.r12_direct_phase_attempts;m private.r12_direct_repair_phase_metadata;k text;selection jsonb;begin
 select * into strict s from private.r12_direct_research_setups where scope_id=p_scope;
 next_state:=private.r12_direct_repair_state(p_scope);
 -- Settled failed model calls remain in the same logical cycle. Their paid
 -- unit is retained; only a separately scheduled replacement reserves another.
 if failure_hash is not null then
 perform private.r12_direct_project_closed_head(s,next_state);
 -- The common projector holds the Business/head locks and preserves owner
 -- controls. Only its own exact ready projection may become a source pause.
 if next_state->>'nextAction'='source_paused' then
 update private.r07_heads set state='paused',reason='source_access_reconciliation_required',revision=revision+1
 where business_id=s.business_id and goal_id=s.goal_id and plan_id=s.plan_id and state='ready' and reason='direct_next_attempt_ready';end if;
 return next_state;end if;
 select x.* into a from private.r12_direct_phase_attempts x join private.r12_direct_repair_phase_metadata y on y.attempt_id=x.attempt_id where x.scope_id=p_scope and x.ordinal=r12_direct_repair_close_cycle.ordinal order by y.sequence desc limit 1;
 select * into m from private.r12_direct_repair_phase_metadata where attempt_id=a.attempt_id;
 if a.phase is distinct from 'review' or review is null or not exists(select 1 from private.r12_direct_phase_receipts r where r.attempt_id=a.attempt_id and r.failure is null) then raise exception 'r12_direct_four_real_phases_required';end if;
 selection:=private.r12_direct_repair_dependencies(p_scope,m.logical_cycle_id,'review',m.sequence);
 if selection is distinct from m.dependency_selection then raise exception 'r12_direct_repair_dependency_changed';end if;
 foreach k in array array['plan','source','strategy'] loop
 if not exists(select 1 from private.r12_direct_phase_attempts x join private.r12_direct_phase_receipts r on r.attempt_id=x.attempt_id where x.attempt_id=(selection->k->>'phaseAttemptId')::uuid and r.receipt_hash=selection->k->>'receiptHash' and r.failure is null and x.scope_id=p_scope and x.ordinal=r12_direct_repair_close_cycle.ordinal and x.phase=k) then raise exception 'r12_direct_four_real_phases_required';end if;end loop;
 if review->>'outcome'='NME' then cmd:=review->'proposedCommand';perform private.r12_direct_command_check(cmd);
 if (next_state->>'nmeCountInEpoch')::integer=3 then if cmd->>'kind'<>'pivot' or next_state->'seenCriteriaHashes' ? (cmd->>'criteriaHash') then raise exception 'r12_direct_fourth_nme_requires_pivot';end if;
 elsif cmd->>'kind'<>'targeted' or cmd->>'criteriaHash' is distinct from next_state->>'epochCriteriaHash' then raise exception 'r12_direct_targeted_followup_required';end if;end if;
 body:=jsonb_build_object('scopeId',p_scope,'ordinal',ordinal,'status','completed','review',review,'failureHash',null);
 insert into private.r12_direct_cycle_closures values(p_scope,ordinal,'completed',review,null,body,private.stage14_hash(body),clock_timestamp());
 next_state:=private.r12_direct_repair_state(p_scope);perform private.r12_direct_project_closed_head(s,next_state);return next_state;
end $$;


alter function private.r12_direct_state(uuid) rename to r12_direct_state_v1;
create function private.r12_direct_state(p_scope uuid) returns jsonb language plpgsql stable set search_path='' as $$ begin if private.r12_direct_is_repair_scope(p_scope) then return private.r12_direct_repair_state(p_scope);end if;return private.r12_direct_state_v1(p_scope);end $$;

alter function private.r12_direct_inputs(uuid) rename to r12_direct_inputs_v1;
create function private.r12_direct_inputs(p_attempt uuid) returns jsonb language plpgsql stable set search_path='' as $$ begin if private.r12_direct_is_repair_scope((select scope_id from private.r12_direct_phase_attempts where attempt_id=p_attempt)) then return private.r12_direct_repair_inputs(p_attempt);end if;return private.r12_direct_inputs_v1(p_attempt);end $$;

alter function private.r12_direct_model_semantic(uuid) rename to r12_direct_model_semantic_v1;
create function private.r12_direct_model_semantic(p_attempt uuid) returns jsonb language plpgsql stable set search_path='' as $$ begin if private.r12_direct_is_repair_scope((select scope_id from private.r12_direct_phase_attempts where attempt_id=p_attempt)) then return private.r12_direct_repair_model_semantic(p_attempt);end if;return private.r12_direct_model_semantic_v1(p_attempt);end $$;

alter function private.r12_direct_schedule(uuid,jsonb) rename to r12_direct_schedule_v1;
create function private.r12_direct_schedule(p_scope uuid,payload jsonb) returns jsonb language plpgsql set search_path='' as $$ begin if private.r12_direct_is_repair_scope(p_scope) then return private.r12_direct_repair_schedule(p_scope,payload);end if;return private.r12_direct_schedule_v1(p_scope,payload);end $$;

alter function private.r12_direct_dispatch(uuid,jsonb) rename to r12_direct_dispatch_v1;
create function private.r12_direct_dispatch(p_scope uuid,payload jsonb) returns jsonb language plpgsql set search_path='' as $$ begin if private.r12_direct_is_repair_scope(p_scope) then return private.r12_direct_repair_dispatch(p_scope,payload);end if;return private.r12_direct_dispatch_v1(p_scope,payload);end $$;

alter function private.r12_direct_model_receipt(uuid,jsonb) rename to r12_direct_model_receipt_v1;
create function private.r12_direct_model_receipt(p_scope uuid,payload jsonb) returns jsonb language plpgsql set search_path='' as $$ begin if private.r12_direct_is_repair_scope(p_scope) then return private.r12_direct_repair_model_receipt(p_scope,payload);end if;return private.r12_direct_model_receipt_v1(p_scope,payload);end $$;

alter function private.r12_direct_close_cycle(uuid,integer,jsonb,text) rename to r12_direct_close_cycle_v1;
do $$ begin execute replace(pg_get_functiondef('private.r12_direct_close_cycle_v1(uuid,integer,jsonb,text)'::regprocedure),'r12_direct_close_cycle.ordinal','r12_direct_close_cycle_v1.ordinal');end $$;
create function private.r12_direct_close_cycle(p_scope uuid,ordinal integer,review jsonb,failure_hash text default null) returns jsonb language plpgsql set search_path='' as $$ begin if private.r12_direct_is_repair_scope(p_scope) then return private.r12_direct_repair_close_cycle(p_scope,ordinal,review,failure_hash);end if;return private.r12_direct_close_cycle_v1(p_scope,ordinal,review,failure_hash);end $$;

alter function private.r12_direct_strategy(jsonb,jsonb) rename to r12_direct_strategy_v1;
create function private.r12_direct_strategy(i jsonb,raw jsonb) returns jsonb language plpgsql stable set search_path='' as $$ begin if i->>'version'='r12.public-research-phase-inputs.2' then return private.r12_direct_repair_strategy(i,raw);end if;return private.r12_direct_strategy_v1(i,raw);end $$;

alter function private.r12_direct_review(jsonb,jsonb,text,jsonb) rename to r12_direct_review_v1;
create function private.r12_direct_review(i jsonb,raw jsonb,receipt_hash text,candidate jsonb) returns jsonb language plpgsql stable set search_path='' as $$ begin if i->>'version'='r12.public-research-phase-inputs.2' then return private.r12_direct_repair_review(i,raw,receipt_hash,candidate);end if;return private.r12_direct_review_v1(i,raw,receipt_hash,candidate);end $$;


alter function private.r12_direct_wire_check(private.r12_direct_phase_attempts,jsonb) rename to r12_direct_wire_check_v1;
create function private.r12_direct_wire_check(a private.r12_direct_phase_attempts,v jsonb) returns void language plpgsql set search_path='' as $$ begin if private.r12_direct_is_repair_scope(a.scope_id) then perform private.r12_direct_repair_wire_check(a,v);else perform private.r12_direct_wire_check_v1(a,v);end if;end $$;
alter function private.r12_direct_mark_phase(private.r12_direct_phase_attempts) rename to r12_direct_mark_phase_v1;
create function private.r12_direct_mark_phase(a private.r12_direct_phase_attempts) returns void language plpgsql set search_path='' as $$ begin
 perform private.r12_direct_mark_phase_v1(a);
 if private.r12_direct_is_repair_scope(a.scope_id) and a.repair_ordinal>0 then update private.r07_heads set repairs_used=repairs_used+1 where plan_id=(select plan_id from private.r12_direct_research_setups where scope_id=a.scope_id);end if;
end $$;
alter function private.r12_direct_confirm_research(uuid,jsonb,text) rename to r12_direct_confirm_research_v1;
create function private.r12_direct_confirm_research(b uuid,payload jsonb,server_key text) returns jsonb language plpgsql set search_path='' as $$ begin
 if exists(select 1 from private.r12_direct_research_setups where id=(payload->>'setupId')::uuid and policy->>'version'='r12.direct-etsy-attempt-policy.2') then return private.r12_direct_confirm_research_v2(b,payload,server_key);end if;
 return private.r12_direct_confirm_research_v1(b,payload,server_key);
end $$;
do $$ declare d text;anchor text;begin
 d:=pg_get_functiondef('public.r12_owner_direct_server(uuid,text,jsonb,text)'::regprocedure);anchor:=$a$if p_operation='prepare_research' then$a$;
 if position(anchor in d)=0 then raise exception 'r12_direct_repair_owner_route_drift';end if;
 execute replace(d,anchor,$a$if p_operation='prepare_research_v2' then return private.r12_direct_prepare_research_v2(p_business_id,p_payload,p_server_key);end if;
 if p_operation='prepare_research' then$a$);
end $$;
do $$ declare f record;begin for f in select p.oid::regprocedure name from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'r12_direct_%' loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.name);end loop;end $$;
commit;
