-- Direct .4 origin archive and irreversible predecessor freeze. Definitions only.
-- No grant, credential, provider route or public enrollment is introduced.
begin;

-- A new four-child prospectus. The published five-child closure is immutable.
do $copy$ declare d text;begin
 d:=pg_get_functiondef('private.r12_owner_episode_predecessor(uuid,uuid)'::regprocedure);
 if position('children+5>32 or dispatches+5>64' in d)=0 then raise exception 'r12_direct_legacy_definition_drift';end if;
 d:=replace(d,'FUNCTION private.r12_owner_episode_predecessor(','FUNCTION private.r12_direct_legacy_predecessor(');
 execute replace(d,'children+5>32 or dispatches+5>64','children+4>32 or dispatches+4>64');
end $copy$;

create table private.r12_direct_origin_freezes(
 predecessor_plan_id uuid primary key references private.r07_plans(id),
 business_id uuid not null,goal_id uuid not null,owner_id uuid not null,
 authority_root_id uuid not null,packet jsonb not null,origin_hash text not null,
 history_snapshot jsonb not null,history_snapshot_hash text not null,head_snapshot jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 foreign key(goal_id,business_id) references private.r04_goal_state(goal_id,business_id),
 check(origin_hash=private.stage14_hash(packet)),
 check(history_snapshot_hash=private.stage14_hash(history_snapshot))
);
alter table private.r12_direct_origin_freezes enable row level security;
revoke all on private.r12_direct_origin_freezes from public,anon,authenticated,service_role;
create trigger direct_origin_immutable before insert or update or delete on private.r12_direct_origin_freezes
 for each row execute function private.r12_owner_immutable();

create function private.r12_direct_origin_set(v jsonb) returns jsonb language sql immutable set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(x) order by x collate "C"),'[]'::jsonb)
 from (select distinct value x from jsonb_array_elements_text(v)) q
$$;
create function private.r12_direct_origin_question(v text) returns text language sql immutable set search_path='' as $$
 select private.stage14_hash(jsonb_build_object('version','r12.public-question.1','question',
 translate(btrim(regexp_replace(normalize(v,NFC),E'[ \\t\\n\\v\\f\\r]+',' ','g')),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')))
$$;
create function private.r12_direct_origin_quote(v text) returns text language sql immutable set search_path='' as $$
 select private.stage14_hash(jsonb_build_object('version','r12.evidence-text.1','quote',
 btrim(regexp_replace(normalize(v,NFC),E'[ \\t\\n\\v\\f\\r]+',' ','g'))))
$$;

-- Full historical rows, including rejected/failed outputs, are hash-pinned and
-- retained behind the archive. This is deliberately scoped to the old plans:
-- a later bounded setup operation must not invalidate its frozen predecessor.
create function private.r12_direct_origin_snapshot(b uuid,g uuid,last_version integer) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('version','r12.direct-origin-snapshot.1','businessId',b,'goalId',g,
 'plans',coalesce(jsonb_agg(jsonb_build_object('plan',to_jsonb(p),'scope',to_jsonb(s),'authority',to_jsonb(q),
 'activation',(select to_jsonb(x) from private.r12_adaptive_activations x where x.plan_id=p.id),
 'setup',(select to_jsonb(x) from private.r12_adaptive_setups x where x.scope_id=s.id),
 'plannerReceipt',(select to_jsonb(x) from private.r12_adaptive_planner_receipts x where x.scope_id=s.id),
 'episodeActivation',(select to_jsonb(x) from private.r12_owner_episode_activations x where x.plan_id=p.id),
 'policyRevocation',(select to_jsonb(x) from private.r05_revocations x where x.policy_id=p.policy_id),
 'attempts',(select coalesce(jsonb_agg(jsonb_build_object('attempt',to_jsonb(a),
 'child',(select to_jsonb(x) from private.r07_children x where x.id=a.child_id),
 'binding',(select to_jsonb(x) from private.r07_bindings x where x.attempt_id=a.id),
 'marker',(select to_jsonb(x) from private.r07_markers x where x.attempt_id=a.id),
 'response',(select to_jsonb(x) from private.r07_responses x where x.attempt_id=a.id),
 'inputSnapshot',(select to_jsonb(x) from private.r12_adaptive_input_snapshots x where x.attempt_id=a.id),
 'requests',(select coalesce(jsonb_agg(jsonb_build_object('request',to_jsonb(r),
 'reservation',(select to_jsonb(x) from private.r05_reservations x where x.request_id=r.id),
 'marker',(select to_jsonb(x) from private.r05_markers x where x.request_id=r.id),
 'release',(select to_jsonb(x) from private.r05_releases x where x.request_id=r.id),
 'settlements',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from private.r05_settlements x where x.request_id=r.id),
 'wire',(select to_jsonb(x) from private.r12_discovery_wires x where x.request_id=r.id),
 'candidate',(select to_jsonb(x) from private.r12_discovery_candidates x where x.request_id=r.id),
 'responseObservations',(select coalesce(jsonb_agg(to_jsonb(x) order by x.kind),'[]') from private.r12_discovery_response_observations x where x.request_id=r.id),
 'receiptObservations',(select coalesce(jsonb_agg(jsonb_build_object('check',to_jsonb(x),'observation',to_jsonb(o)) order by x.attempt),'[]')
  from private.r12_discovery_receipt_checks x left join private.r12_discovery_receipt_observations o on o.check_id=x.id where x.request_id=r.id)
 ) order by r.id),'[]') from private.r05_requests r where r.workflow_run_id=a.id)
 ) order by a.created_at,a.id),'[]') from private.r07_attempts a where a.plan_id=p.id),
 'actions',(select coalesce(jsonb_agg(to_jsonb(x) order by x.ordinal),'[]') from private.r12_adaptive_actions x where x.scope_id=s.id),
 'actionClosures',(select coalesce(jsonb_agg(to_jsonb(x) order by x.action_ordinal),'[]') from private.r12_adaptive_action_closures x where x.scope_id=s.id),
 'failures',(select coalesce(jsonb_agg(to_jsonb(x) order by x.attempt_id),'[]') from private.r12_adaptive_failed_calls x where x.scope_id=s.id)
 ) order by p.version),'[]'))
 from private.r07_plans p join private.r12_discovery_scopes s on s.id=(p.content->>'discoveryScopeId')::uuid
 join private.r12_discovery_authorities q on q.scope_id=s.id
 where p.business_id=b and p.goal_id=g and p.version<=last_version
$$;

-- A known usage charge does not prove the provider route or accepted receipt.
-- Failed research may close financially with a genuine qualified candidate;
-- the absence of accepted output never becomes a fabricated research receipt.
create function private.r12_direct_origin_financial(b uuid,g uuid) returns jsonb
language plpgsql set search_path='' as $$
declare a private.r07_attempts;r private.r05_requests;rs private.r05_reservations;
 w private.r12_discovery_wires;c private.r12_discovery_candidates;proof jsonb;mark timestamptz;
 st private.r05_settlements;failure private.r12_adaptive_failed_calls;diag private.r12_discovery_response_observations;
 result jsonb:='[]';body jsonb;disposition text;qualification text;
begin
 if exists(select 1 from private.r05_requests orphan join private.r07_plans pl on pl.policy_id=orphan.policy_id
  where pl.business_id=b and pl.goal_id=g and not exists(select 1 from private.r07_attempts mapped
   where mapped.id=orphan.workflow_run_id and mapped.plan_id=pl.id and mapped.business_id=b and mapped.goal_id=g))
 then raise exception 'r12_direct_origin_request_lineage_required';end if;
 for r in select x.* from private.r05_requests x join private.r07_attempts t on t.id=x.workflow_run_id
 where t.business_id=b and t.goal_id=g order by x.id loop
  select * into strict a from private.r07_attempts where id=r.workflow_run_id;
  select * into rs from private.r05_reservations where request_id=r.id;
  select created_at into mark from private.r05_markers where request_id=r.id;
  if rs.request_id is null then
   if mark is not null or exists(select 1 from private.r07_markers where attempt_id=a.id)
    then raise exception 'r12_direct_origin_reservation_required';end if;
   continue;
  end if;
  if mark is null then
   if not exists(select 1 from private.r05_releases where request_id=r.id)
    then raise exception 'r12_direct_origin_pending_reservation';end if;
   continue;
  end if;
  -- A marked release is exceptional evidence, not a general paid-call waiver.
  if exists(select 1 from private.r05_releases where request_id=r.id) then
   perform private.r12_pilot_marked_closure_context((select scope_id from private.r12_discovery_wires where request_id=r.id));
   continue;
  end if;
  select * into w from private.r12_discovery_wires where request_id=r.id;
  select * into c from private.r12_discovery_candidates where request_id=r.id;
  select * into st from private.r05_settlements where request_id=r.id order by actual_microunits desc nulls last,id desc limit 1;
  select o.proof into proof from private.r12_discovery_receipt_checks ck
   join private.r12_discovery_receipt_observations o on o.check_id=ck.id
   where ck.request_id=r.id and o.proof is not null and o.created_at>=mark and o.created_at<c.receipt_expires_at order by ck.attempt desc limit 1;
  if w.request_id is null or c.request_id is null or proof is null or st.id is null or st.actual_microunits is null
   or st.currency<>'USD' or r.currency<>'USD' or st.actual_microunits>r.liability_microunits
   or st.actual_microunits is distinct from (c.candidate->>'reportedMicrousd')::bigint
   or st.provider_request_id is distinct from c.candidate->>'providerRequestId'
   or c.candidate_hash is distinct from private.stage14_hash(c.candidate)
   or c.candidate->>'scopeId' is distinct from w.scope_id::text or c.candidate->>'attemptId' is distinct from a.id::text
   or c.candidate->>'requestId' is distinct from r.id::text or c.candidate->>'phase' is distinct from a.step_key
   or c.candidate->>'requestHash' is distinct from r.payload->>'requestHash'
   or w.binding->>'requestHash' is distinct from r.payload->>'requestHash'
   or w.binding->>'requestHash' is distinct from private.stage14_hash((w.binding->>'requestJson')::jsonb)
   or w.binding->>'wireHash' is distinct from r.payload->>'wireRequestHash'
   or w.binding->>'wireHash' is distinct from encode(extensions.digest(convert_to(w.binding->>'wireBody','UTF8'),'sha256'),'hex')
   or mark>(c.candidate->>'receivedAt')::timestamptz or (c.candidate->>'receivedAt')::timestamptz>=c.receipt_expires_at
   or not exists(select 1 from private.r07_markers where attempt_id=a.id)
   or not exists(select 1 from private.r12_discovery_transport_claims where request_id=r.id)
   or exists(select 1 from private.r05_settlements x where x.request_id=r.id and
    (x.provider_request_id<>st.provider_request_id or x.currency<>'USD'))
   or exists(select 1 from private.r05_settlements x where x.request_id<>r.id and x.provider_request_id=st.provider_request_id)
   then raise exception 'r12_direct_origin_qualified_financial_disposition_required';end if;
  perform private.r12_discovery_proof_validate(c,proof);
  disposition:='qualified_receipt';qualification:=proof->>'proofHash';
  select * into failure from private.r12_adaptive_failed_calls where request_id=r.id;
  if failure.attempt_id is not null then
   select * into diag from private.r12_discovery_response_observations where request_id=r.id and kind='rejected';
   if failure.attempt_id<>a.id or failure.scope_id<>w.scope_id or failure.diagnostic_hash is distinct from diag.payload_hash
    or diag.payload_hash is distinct from private.stage14_hash(diag.payload) or failure.settlement_hash<>st.receipt_hash
    or a.status<>'failed' or exists(select 1 from private.r07_responses where attempt_id=a.id)
    then raise exception 'r12_direct_origin_terminal_failure_unverified';end if;
   disposition:='qualified_terminal_failure';qualification:=private.stage14_hash(jsonb_build_object('failure',to_jsonb(failure),'diagnostic',to_jsonb(diag),'receiptProof',proof));
  end if;
  body:=jsonb_build_object('scopeId',w.scope_id,'attemptId',a.id,'requestId',r.id,'requestHash',w.binding->>'requestHash',
   'reservationId',rs.request_id,'maximumMicrounits',r.liability_microunits::text,'actualMicrounits',st.actual_microunits::text,
   'disposition',disposition,'qualificationHash',qualification,'settlementHash',st.receipt_hash);
  result:=result||jsonb_build_array(body);
 end loop;
 return result;
end $$;

create function private.r12_direct_origin_material_add(history jsonb,kind text,statement text,response_hash text,provenance jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare body jsonb;part text;offset_at integer:=1;begin
 if statement is null or length(btrim(statement))=0 then return history;end if;
 -- All genuine raw output stays in the snapshot, including strings longer than
 -- the public per-statement bound. Public chunks concatenate without loss.
 while offset_at<=length(statement) loop
  part:=substr(statement,offset_at,2000);offset_at:=offset_at+2000;
  body:=jsonb_build_object('kind',kind,'statement',part,'sourceResponseHash',response_hash,'provenanceHashes',provenance);
  body:=body||jsonb_build_object('recordHash',private.stage14_hash(body));
  if not history @> jsonb_build_array(body) then history:=history||jsonb_build_array(body);end if;
 end loop;
 return history;
end $$;
create function private.r12_direct_origin_material(history jsonb,d jsonb,provenance jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare raw jsonb:=d->'candidate'->'output';item jsonb;candidate jsonb;dim jsonb;q jsonb;begin
 if d->>'stepKey'='strategy' then
  raw:=coalesce(raw->'assessment',raw);
  for candidate in select value from jsonb_array_elements(coalesce(raw->'candidates','[]')) loop
   for dim in select value from jsonb_array_elements(coalesce(candidate->'dimensions','[]')) loop
    for q in select value from jsonb_array_elements(coalesce(dim->'uncertainties','[]')) loop
     history:=private.r12_direct_origin_material_add(history,'unresolved_question',q->>'question',d->>'responseHash',provenance);
    end loop;
    if dim->'hardFailure'='true'::jsonb or dim->>'finding'='unfavorable' then
     history:=private.r12_direct_origin_material_add(history,'negative_finding',dim->>'rationale',d->>'responseHash',provenance);
    end if;
   end loop;
  end loop;
 elsif d->>'stepKey'='review' then
  history:=private.r12_direct_origin_material_add(history,'prior_decision',raw->>'sufficiencyRationale',d->>'responseHash',provenance);
  for item in select value from jsonb_array_elements(coalesce(raw->'additionalUncertainties','[]')) loop
   history:=private.r12_direct_origin_material_add(history,'unresolved_question',item->>'question',d->>'responseHash',provenance);
  end loop;
  for item in select value from jsonb_array_elements(coalesce(raw->'additionalQuestions','[]')||
   coalesce(d->'response'->'result'->'review'->'inheritedQuestions','[]')||coalesce(d->'response'->'result'->'review'->'additionalQuestions','[]')) loop
   history:=private.r12_direct_origin_material_add(history,'unresolved_question',item#>>'{}',d->>'responseHash',provenance);
  end loop;
  for dim in select value from jsonb_array_elements(coalesce(raw->'dimensions','[]')||coalesce(raw->'proposalConcerns','[]')||coalesce(raw->'checks','[]')) loop
   if dim->>'verdict'='known_failure' or dim->>'severity'='known_failure' or dim->'passed'='false'::jsonb then
    history:=private.r12_direct_origin_material_add(history,'negative_finding',dim->>'rationale',d->>'responseHash',provenance);
   end if;
  end loop;
  if raw->'progress'->>'kind'='refuted' then
   history:=private.r12_direct_origin_material_add(history,'negative_finding',raw->'progress'->>'finding',d->>'responseHash',provenance);
  end if;
 end if;
 return history;
end $$;

create function private.r12_direct_origin_text(v text) returns text language sql immutable set search_path='' as $$
 select translate(btrim(regexp_replace(normalize(v,NFC),E'[ \\t\\n\\v\\f\\r]+',' ','g')),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')
$$;
create function private.r12_direct_origin_fact(o jsonb,m jsonb) returns text language plpgsql immutable set search_path='' as $$
declare c jsonb:=o->'context';fact jsonb;context jsonb;begin
 context:=jsonb_build_object('productFormat',private.r12_direct_origin_text(c->>'productFormat'),
 'category',private.r12_direct_origin_text(c->>'category'),'query',private.r12_direct_origin_text(c->>'query'),
 'windowStart',c->'windowStart','windowEnd',c->'windowEnd','locale',private.r12_direct_origin_text(c->>'locale'),
 'geography',jsonb_build_object('kind',c->'geography'->'kind','countries',private.r12_direct_origin_set(c->'geography'->'countries'),
 'basis',private.r12_direct_origin_text(c->'geography'->>'basis')));
 case m->>'kind'
 when 'statement' then fact:=jsonb_build_object('kind','statement','statement',private.r12_direct_origin_text(m->>'displayed'));
 when 'count' then fact:=jsonb_build_object('kind','count','unit',private.r12_direct_origin_text(m->>'unit'),'value',m->'value','precision',m->'precision');
 when 'money_range' then fact:=jsonb_build_object('kind','money_range','currency',m->'currency','lower',m->'lower','upper',m->'upper','basis',private.r12_direct_origin_text(m->>'basis'));
 when 'ordinal' then fact:=jsonb_build_object('kind','ordinal','scale',(select jsonb_agg(private.r12_direct_origin_text(x) order by ord) from jsonb_array_elements_text(m->'scale') with ordinality v(x,ord)),
 'value',private.r12_direct_origin_text(m->>'value'),'definition',private.r12_direct_origin_text(m->>'definition'));
 else raise exception 'r12_direct_origin_unsupported_fact';end case;
 return private.stage14_hash(jsonb_build_object('version','r12.public-owner-fact.1','context',context,'fact',fact));
end $$;

-- Reconstruct the exact E1..En wire projection from authenticated saved inputs.
-- Reference IDs live only in the envelope; they are not invented wire fields.
create function private.r12_direct_origin_wire_expand(v jsonb,texts jsonb default '[]') returns jsonb
language plpgsql immutable set search_path='' as $$
declare result jsonb;item record;begin
 if jsonb_typeof(v)='object' and v ? '$text' and v-'$text'='{}'::jsonb then
  if v->>'$text' !~ '^(0|[1-9][0-9]*)$' or jsonb_typeof(texts->(v->>'$text')::integer) is distinct from 'string'
   then raise exception 'r12_direct_origin_compact_text_unverified';end if;
  return texts->(v->>'$text')::integer;
 elsif jsonb_typeof(v)='object' then
  result:='{}';for item in select key,value from jsonb_each(v) where key<>'sharedText' loop
   result:=result||jsonb_build_object(item.key,private.r12_direct_origin_wire_expand(item.value,texts));end loop;return result;
 elsif jsonb_typeof(v)='array' then
  select coalesce(jsonb_agg(private.r12_direct_origin_wire_expand(value,texts) order by ord),'[]') into result
   from jsonb_array_elements(v) with ordinality z(value,ord);return result;
 else return v;end if;
end $$;
create function private.r12_direct_origin_reviewer_pool(d jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare sn jsonb;input jsonb;ar jsonb;pack jsonb;ev jsonb;src jsonb;v_bundle jsonb;obs jsonb;m jsonb;pin jsonb;
 ref jsonb;wire jsonb;entries jsonb:='[]';expected jsonb;refs_json jsonb;start_at integer;
begin
 input:=(d->'binding'->'request'->'messages'->1->>'content')::jsonb;
 input:=private.r12_direct_origin_wire_expand(input,coalesce(input->'sharedText','[]'));
 if d->'origin'->>'actionHash' is null then return jsonb_build_object('input',input,'references','[]'::jsonb);end if;
 select content into strict sn from private.r12_adaptive_input_snapshots where attempt_id=(d->>'attemptId')::uuid;
 if sn->'ownerObservationContext' is not null and sn->'ownerObservationContext'<>'null'::jsonb and
 (sn->'ownerObservationContext'->>'manifestHash' is distinct from private.stage14_hash(sn->'ownerObservationContext'->'manifest')
 or sn->'ownerObservationContext'->'manifest' is distinct from sn->'intentPins'->'ownerObservationRef'->'manifest'
 or sn->'ownerObservationContext'->>'scopeId' is distinct from d->'origin'->>'scopeId'
 or sn->'ownerObservationContext'->>'scopeHash' is distinct from d->'origin'->>'scopeHash')
 then raise exception 'r12_direct_origin_owner_context_changed';end if;
 for ar in select value from jsonb_array_elements(sn->'archive') where sn->'intentPins'->'activeEvidenceArtifactIds' ? (value->'persisted'->>'artifactId') loop
  if ar is distinct from private.r12_adaptive_evidence_archive((ar->'selector'->>'attemptId')::uuid) then raise exception 'r12_direct_origin_archive_changed';end if;
  pack:=ar->'persisted'->'evidencePack';
  for ev in select value from jsonb_array_elements(pack->'evidence') loop
   select value into strict src from jsonb_array_elements(pack->'sources') where value->>'id'=ev->>'sourceId';
   start_at:=position(ev->>'quote' in src->>'excerpt')-1;
   ref:=jsonb_build_object('artifactId',ar->'persisted'->>'artifactId','evidenceId',ev->>'id','sourceId',src->>'id',
    'sourceContentHash',src->>'contentHash','start',start_at,'end',start_at+length(ev->>'quote'));
   wire:=jsonb_build_object('quote',ev->>'quote','url',src->>'url','retrievedAt',src->>'retrievedAt','expiresAt',src->'retrievalExpiresAt');
   entries:=entries||jsonb_build_array(jsonb_build_object('reference',ref,'referenceHash',private.stage14_hash(ref),'wire',wire));
  end loop;
 end loop;
 for v_bundle in select value from jsonb_array_elements(coalesce(sn->'ownerObservationContext'->'bundles','[]')) loop
  select value into strict pin from jsonb_array_elements(sn->'ownerObservationContext'->'manifest') where value->>'bundleId'=v_bundle->>'id';
  if not exists(select 1 from private.r12_owner_observation_bundles saved where saved.bundle=v_bundle and saved.bundle_hash=pin->>'bundleHash')
   then raise exception 'r12_direct_origin_owner_bundle_unverified';end if;
  for obs in select value from jsonb_array_elements(v_bundle->'observations') where pin->'selectedObservationIds' ? (value->>'id') loop
   for m in select value from jsonb_array_elements(obs->'metrics') loop
    ref:=jsonb_build_object('artifactId',obs->>'id','evidenceId',m->>'id','sourceId',obs->>'sourceId','sourceContentHash',obs->>'contentHash','start',m->'start','end',m->'end');
    wire:=jsonb_build_object('quote',substr(obs->>'content',(m->>'start')::integer+1,(m->>'end')::integer-(m->>'start')::integer),
     'url',obs->'source'->>'url','retrievedAt',obs->'source'->>'capturedAt','expiresAt',null,
     'sourceContext',jsonb_build_object('provenance',obs->>'provenance','independentVerification',false,'sourceTextIsUntrusted',true,
     'attribution',jsonb_build_object('ownerId',v_bundle->>'ownerId','businessId',v_bundle->>'businessId','authenticationRequiredAtIntake',true,'providerSigned',false),
     'comparisonRole',case when v_bundle->'baseline'->'candidateObservationIds' ? (obs->>'id') then 'candidate' when v_bundle->'baseline'->>'referenceObservationId'=obs->>'id' then 'reference' else 'exploratory' end,
     'baselineTiming',v_bundle->'baseline'->'timing','source',obs->'source','context',obs->'context','metric',m,'limitations',obs->'limitations'));
    entries:=entries||jsonb_build_array(jsonb_build_object('reference',ref,'referenceHash',private.stage14_hash(ref),'wire',wire));
   end loop;
  end loop;
 end loop;
 select coalesce(jsonb_agg(z.v->'wire'||jsonb_build_object('key','E'||z.n::text) order by z.n),'[]'),
  coalesce(jsonb_agg(z.v->'reference' order by z.n),'[]') into expected,refs_json
 from(select value v,row_number() over(order by value->>'referenceHash' collate "C") n from jsonb_array_elements(entries))z;
 if input->'evidence' is distinct from expected then raise exception 'r12_direct_origin_exact_reviewer_pool_required';end if;
 return jsonb_build_object('input',input,'references',refs_json);
end $$;

create function private.r12_direct_origin_build(b uuid,g uuid) returns jsonb
language plpgsql set search_path='' as $$
declare h private.r07_heads;p private.r07_plans;s private.r12_discovery_scopes;binding private.r12_owner_funding_bindings;
 activation private.r12_adaptive_activations;setup private.r12_adaptive_setups;gv private.r04_goal_versions;bv private.r04_business_versions;
 x record;d jsonb;ar jsonb;pack jsonb;src jsonb;ev jsonb;body jsonb;obs jsonb;metric jsonb;v_bundle jsonb;pin jsonb;
 dependency jsonb;deps jsonb:='[]';archives jsonb:='[]';receipt_rows jsonb:='[]';finance jsonb;provenance jsonb:='[]';material jsonb:='[]';
 questions jsonb:='[]';quotes jsonb:='[]';facts jsonb:='[]';diagnostics jsonb:='[]';negative jsonb:='[]';refs jsonb;
 closure jsonb;predecessor jsonb;imports jsonb;history jsonb;raw_history jsonb;revocations jsonb;known bigint;children integer;dispatches integer;repairs integer;streak integer:=0;
begin
 select * into h from private.r07_heads where business_id=b and goal_id=g;
 select * into p from private.r07_plans where id=h.plan_id and business_id=b and goal_id=g;
 select * into s from private.r12_discovery_scopes where id=(p.content->>'discoveryScopeId')::uuid;
 select * into binding from private.r12_owner_funding_bindings where business_id=b;
 select v.* into gv from private.r04_goal_versions v join private.r04_goal_state st using(business_id,goal_id,revision) where v.business_id=b and v.goal_id=g;
 select v.* into bv from private.r04_business_versions v join private.r04_business_state st using(business_id,revision) where v.business_id=b;
 if p.id is null or s.id is null or binding.id is null or gv.preference is distinct from 'ready' or bv.preference is distinct from 'setup'
 or not exists(select 1 from public.businesses where id=b and owner_user_id=p.owner_id)
 or coalesce(s.budget_authority_root_id,b) is distinct from binding.authority_root_id
 or exists(select 1 from private.r12_direct_origin_freezes f where f.business_id=b and f.goal_id=g)
 then raise exception 'r12_direct_origin_current_predecessor_required';end if;
 if (select count(*) from private.r07_plans where business_id=b and goal_id=g)<>p.version
 or exists(select 1 from private.r07_plans z left join private.r07_plans prev on prev.id=z.previous_plan_id
 left join private.r12_discovery_scopes sc on sc.id=(z.content->>'discoveryScopeId')::uuid
 left join private.r12_discovery_authorities q on q.scope_id=sc.id
 left join private.r05_policies pol on pol.id=z.policy_id
 where z.business_id=b and z.goal_id=g and (z.content_hash is distinct from private.r04_hash(z.content)
 or z.owner_id<>p.owner_id or sc.business_id is distinct from b or sc.goal_id is distinct from g
 or sc.amendment_hash is distinct from private.stage14_hash(sc.amendment)
 or z.content->>'discoveryScopeHash' is distinct from sc.amendment_hash
 or coalesce(sc.budget_authority_root_id,b) is distinct from binding.authority_root_id
 or sc.prior_round_id is distinct from s.prior_round_id or q.plan is distinct from z.content or q.plan_hash is distinct from z.content_hash
 or pol.actor_id is distinct from p.owner_id or pol.content_hash is distinct from z.content->>'policyHash'
 or not exists(select 1 from private.r05_confirmations c where c.policy_id=z.policy_id and c.actor_id=p.owner_id)
 or (z.version=1 and z.previous_plan_id is not null)
 or (z.version>1 and (prev.version is distinct from z.version-1 or prev.business_id is distinct from b or prev.goal_id is distinct from g))
 or (z.id<>p.id and not exists(select 1 from private.r05_revocations rr where rr.policy_id=z.policy_id))
 or (z.id=p.id and not exists(select 1 from private.r05_revocations rr where rr.policy_id=z.policy_id)
   and h.state not in('completed','paused','stopped')))) then raise exception 'r12_direct_origin_lineage_unverified';end if;
 select count(*) into children from private.r07_children where business_id=b and goal_id=g;
 select count(*) into dispatches from private.r07_markers m join private.r07_attempts a on a.id=m.attempt_id where a.business_id=b and a.goal_id=g;
 -- Adaptive repeats are separately admitted investigation calls, not generic
 -- R07 repair-counter increments (the published controller keeps that at zero).
 select count(*) into repairs from private.r07_attempts where business_id=b and goal_id=g and attempt>1 and adaptive_action_hash is null;
 if h.children_created<>children or h.dispatches<>dispatches or h.repairs_used<>repairs
 or children+4>32 or dispatches+4>64 then raise exception 'r12_direct_origin_lifetime_bound';end if;
 if exists(select 1 from private.r05_exposure(b) where unknown)
 or (private.r12_owner_funding(binding)->>'pendingMicrounits')::bigint<>0
 or exists(select 1 from private.r07_attempts a where a.business_id=b and a.goal_id=g and a.status='reserved'
 and not exists(select 1 from private.r05_requests r join private.r05_releases rel on rel.request_id=r.id where r.workflow_run_id=a.id))
 then raise exception 'r12_direct_origin_unresolved_liability';end if;
 finance:=private.r12_direct_origin_financial(b,g);
 select coalesce(sum((v->>'actualMicrounits')::bigint),0) into known from jsonb_array_elements(finance)v;
 raw_history:=private.r12_direct_origin_snapshot(b,g,p.version);
 select jsonb_agg(jsonb_build_object('scopeId',q.scope_id,'controllerKeyHash',q.controller_key_hash,
 'admissionKeyHash',q.admission_key_hash,'policyRevocation',(select to_jsonb(r) from private.r05_revocations r where r.policy_id=z.policy_id)) order by z.version)
 into revocations from private.r07_plans z join private.r12_discovery_authorities q on q.scope_id=(z.content->>'discoveryScopeId')::uuid where z.business_id=b and z.goal_id=g;
 if s.amendment->>'version' in ('r12.discovery-owner-adaptive.1','r12.discovery-owner-adaptive.2') then
  select * into activation from private.r12_adaptive_activations where scope_id=s.id and plan_id=p.id;
  select * into setup from private.r12_adaptive_setups where id=activation.setup_id;
  if activation.scope_id is null or setup.id is null or activation.business_id<>b or activation.goal_id<>g or activation.owner_id<>p.owner_id
   or activation.binding_id<>binding.id or activation.policy_id<>p.policy_id or activation.plan_hash<>p.content_hash
   or activation.scope_hash<>s.amendment_hash or activation.content_hash<>private.stage14_hash(activation.content)
   or activation.predecessor_plan_id is distinct from p.previous_plan_id
   or activation.predecessor_closure_hash<>private.stage14_hash(activation.predecessor_closure)
   or activation.predecessor_closure->>'predecessorPlanId' is distinct from p.previous_plan_id::text
   or setup.setup_hash is distinct from s.amendment->>'setupHash' or setup.preview->'predecessor' is distinct from activation.predecessor_closure
   or setup.preview->'imports' is distinct from private.r12_adaptive_imports(activation.predecessor_plan_id,false)
   or not exists(select 1 from private.r12_owner_grant_roots rt where rt.id=activation.grant_root_id and rt.binding_id=binding.id)
   then raise exception 'r12_direct_origin_adaptive_binding';end if;
  closure:=jsonb_build_object('version','r12.direct-adaptive-origin-closure.1','businessId',b,'goalId',g,
   'predecessorPlanId',p.id,'predecessorPlanHash',p.content_hash,'predecessorPlanVersion',p.version,
   'predecessorScopeId',s.id,'predecessorScopeHash',s.amendment_hash,'predecessorScopeVersion',s.amendment->>'version',
   'predecessorSetupId',setup.id,'predecessorSetupHash',setup.setup_hash,'predecessorActivationHash',activation.content_hash,
   'predecessorPolicyId',p.policy_id,'predecessorPolicyHash',p.content->>'policyHash',
   'authorityRootId',binding.authority_root_id,'fundingBindingId',binding.id,
   'goalRevision',gv.revision,'goalHash',gv.content_hash,'businessRevision',bv.revision,'businessHash',bv.content_hash,
   'headRevision',h.revision,'headState',case when h.state='completed' and not exists(select 1 from private.r05_revocations where policy_id=p.policy_id) then 'completed' else 'stopped' end,
   'headReason',case when exists(select 1 from private.r05_revocations where policy_id=p.policy_id) then 'owner_stopped' else h.reason end,
   'baseChildren',children,'baseDispatches',dispatches,'baseRepairs',repairs,'basePivots',h.pivots_used,'baseKnownMicrounits',known::text,
   'closureProofHash',private.stage14_hash(jsonb_build_object('originalHead',to_jsonb(h),'activation',to_jsonb(activation),'financialProofs',finance)),
   'revocationHash',private.stage14_hash(revocations),'settlementHash',private.stage14_hash(finance),'historyHash',private.stage14_hash(raw_history));
  predecessor:=jsonb_build_object('kind','adaptive_direct_origin','closure',closure);
 else
  closure:=private.r12_direct_legacy_predecessor(b,g);
  select jsonb_agg(v.x||jsonb_build_object('phase',case v.x->>'phase' when 'search1' then 'search' when 'select1' then 'select' else v.x->>'phase' end) order by v.ord)
   into imports from jsonb_array_elements(private.r12_adaptive_imports(p.id,false)) with ordinality v(x,ord);
  predecessor:=jsonb_build_object('kind','legacy_episode','closure',closure,'imports',imports);
 end if;
 -- Qualify every real accepted phase in chronological lineage order. Historical
 -- five-phase sources remain archive-only and are never executable .4 inputs.
 for x in select a.*,pl.version,pl.content_hash plan_hash,(pl.content->>'discoveryScopeId')::uuid scope_id,pl.content->>'discoveryScopeHash' scope_hash
  from private.r07_attempts a join private.r07_plans pl on pl.id=a.plan_id
  where a.business_id=b and a.goal_id=g and a.status='completed'
  order by pl.version,coalesce(a.adaptive_action_ordinal,-1),case a.step_key when 'plan' then 0 when 'search1' then 1 when 'select1' then 2 when 'strategy' then 3 else 4 end,a.attempt,a.id loop
  d:=private.r12_adaptive_input_dependency(x.id);deps:=deps||jsonb_build_array(d);
  if x.step_key='select1' then
   ar:=private.r12_adaptive_evidence_archive(x.id);archives:=archives||jsonb_build_array(ar);pack:=ar->'persisted'->'evidencePack';
   for ev in select value from jsonb_array_elements(pack->'evidence') loop
    select value into strict src from jsonb_array_elements(pack->'sources') where value->>'id'=ev->>'sourceId';
    body:=jsonb_build_object('kind','legacy_evidence','scopeId',x.scope_id,'containerId',ar->'persisted'->>'artifactId',
     'containerHash',private.stage14_hash(pack),'sourceId',src->>'id','sourceContentHash',src->>'contentHash',
     'evidenceId',ev->>'id','evidenceIdentityHash',private.r12_direct_origin_quote(ev->>'quote'),'factIdentityHash',null);
    body:=body||jsonb_build_object('provenanceHash',private.stage14_hash(body));
    if not provenance @> jsonb_build_array(body) then provenance:=provenance||jsonb_build_array(body);end if;
   end loop;
  end if;
  if x.step_key in ('strategy','review') then
   receipt_rows:=receipt_rows||jsonb_build_array(jsonb_build_object('scopeId',x.scope_id,'scopeHash',x.scope_hash,
    'planId',x.plan_id,'planHash',x.plan_hash,'planVersion',x.version,'actionOrdinal',x.adaptive_action_ordinal,
    'phase',x.step_key,'attemptId',x.id,'artifactId',d->>'artifactId','responseHash',d->>'responseHash','receiptProofHash',d->'proof'->>'proofHash'));
   if x.step_key='review' then
    if x.adaptive_action_hash is not null then
     if private.r12_adaptive_review_progress(d,(select content from private.r12_adaptive_input_snapshots where attempt_id=x.id),
      (select kind from private.r12_adaptive_actions where scope_id=x.scope_id and ordinal=x.adaptive_action_ordinal)) then streak:=0;else streak:=streak+1;end if;
    elsif d->'response'->'result'->>'outcome'='TEST' or d->'candidate'->'output'->>'outcome'='TEST' then streak:=0;else streak:=streak+1;end if;
   end if;
  end if;
 end loop;
 -- Authenticated public addenda were not selector calls; retain them separately.
 for x in select sc.* from private.r12_discovery_scopes sc join private.r07_plans pl on pl.content->>'discoveryScopeId'=sc.id::text
 where pl.business_id=b and pl.goal_id=g and sc.amendment->>'version'='r12.discovery-evidence-continuation.1' order by pl.version loop
  perform private.r12_evidence_addendum_validate(x,(x.amendment->>'createdAt')::timestamptz,false);
  for obs in select value from jsonb_array_elements(x.amendment->'addendum'->'observations') loop
   body:=jsonb_build_object('kind','legacy_evidence','scopeId',x.id,'containerId',x.amendment->'addendum'->>'id',
    'containerHash',x.amendment->>'addendumHash','sourceId',obs->>'sourceId','sourceContentHash',obs->>'contentHash',
    'evidenceId',obs->>'id','evidenceIdentityHash',private.r12_direct_origin_quote(substr(obs->>'context',(obs->>'start')::integer+1,(obs->>'end')::integer-(obs->>'start')::integer)),
    'factIdentityHash',null);body:=body||jsonb_build_object('provenanceHash',private.stage14_hash(body));
   if not provenance @> jsonb_build_array(body) then provenance:=provenance||jsonb_build_array(body);end if;
  end loop;
 end loop;
 -- All selected owner metrics are retained, including those never cited. This
 -- prevents an unused typed fact or cosmetic recapture from appearing novel.
 for x in select sn.content,sn.scope_id from private.r12_adaptive_input_snapshots sn join private.r07_attempts a on a.id=sn.attempt_id
  where a.business_id=b and a.goal_id=g order by a.created_at,a.id loop
  for v_bundle in select value from jsonb_array_elements(coalesce(x.content->'ownerObservationContext'->'bundles','[]')) loop
   if not exists(select 1 from private.r12_owner_observation_bundles saved where saved.id=(v_bundle->>'id')::uuid and saved.business_id=b
    and saved.owner_id=p.owner_id and saved.bundle=v_bundle and saved.bundle_hash=private.stage14_hash(v_bundle-'bundleHash'))
    then raise exception 'r12_direct_origin_owner_bundle_unverified';end if;
   select value into strict pin from jsonb_array_elements(x.content->'ownerObservationContext'->'manifest') where value->>'bundleId'=v_bundle->>'id';
   if pin->>'bundleHash' is distinct from v_bundle->>'bundleHash' then raise exception 'r12_direct_origin_owner_manifest_changed';end if;
   for obs in select value from jsonb_array_elements(v_bundle->'observations') where pin->'selectedObservationIds' ? (value->>'id') loop
    for metric in select value from jsonb_array_elements(obs->'metrics') loop
     body:=jsonb_build_object('kind','owner_observation','scopeId',x.scope_id,'containerId',v_bundle->>'id','containerHash',v_bundle->>'bundleHash',
      'sourceId',obs->>'sourceId','sourceContentHash',obs->>'contentHash','evidenceId',metric->>'id',
      'evidenceIdentityHash',private.r12_direct_origin_quote(substr(obs->>'content',(metric->>'start')::integer+1,(metric->>'end')::integer-(metric->>'start')::integer)),
      'factIdentityHash',private.r12_direct_origin_fact(obs,metric));body:=body||jsonb_build_object('provenanceHash',private.stage14_hash(body));
     if not provenance @> jsonb_build_array(body) then provenance:=provenance||jsonb_build_array(body);end if;
    end loop;
   end loop;
  end loop;
 end loop;
 for dependency in select value from jsonb_array_elements(deps) where value->>'stepKey' in ('strategy','review') loop
  body:=private.r12_direct_origin_reviewer_pool(dependency);
  select private.r12_direct_origin_set(coalesce(jsonb_agg(v->'provenanceHash'),'[]')) into refs from jsonb_array_elements(provenance)v
   where exists(select 1 from jsonb_array_elements(body->'input'->'evidence') span where private.r12_direct_origin_quote(span->>'quote')=v->>'evidenceIdentityHash')
   and exists(select 1 from private.r07_plans pl where pl.business_id=b and pl.goal_id=g and pl.content->>'discoveryScopeId'=v->>'scopeId'
    and pl.version<=(select version from private.r07_plans where content_hash=dependency->'origin'->>'planHash' and business_id=b and goal_id=g));
  material:=private.r12_direct_origin_material(material,dependency,refs);
 end loop;
 -- Seen questions are re-derived from the original text, including actual
 -- admitted investigation questions and fetched queries, never old hash hashes.
 for x in select sc.amendment->>'approvedQuery' question from private.r07_plans pl join private.r12_discovery_scopes sc on sc.id=(pl.content->>'discoveryScopeId')::uuid
  where pl.business_id=b and pl.goal_id=g
  union all select ac.content->>'question' from private.r12_adaptive_actions ac join private.r12_adaptive_activations aa on aa.scope_id=ac.scope_id where aa.business_id=b and aa.goal_id=g
  union all select ac.content->>'counterevidenceQuestion' from private.r12_adaptive_actions ac join private.r12_adaptive_activations aa on aa.scope_id=ac.scope_id where aa.business_id=b and aa.goal_id=g loop
  if x.question is not null and btrim(x.question)<>'' then questions:=questions||jsonb_build_array(private.r12_direct_origin_question(x.question));end if;
 end loop;
 for body in select value from jsonb_array_elements(material) loop
  if body->>'kind'='unresolved_question' then questions:=questions||jsonb_build_array(private.r12_direct_origin_question(body->>'statement'));end if;
  if body->>'kind'='negative_finding' then negative:=negative||jsonb_build_array(body->>'recordHash');end if;
 end loop;
 for body in select value from jsonb_array_elements(provenance) loop
  quotes:=quotes||jsonb_build_array(body->>'evidenceIdentityHash');
  if body->>'factIdentityHash' is not null then facts:=facts||jsonb_build_array(body->>'factIdentityHash');end if;
 end loop;
 select coalesce(jsonb_agg(to_jsonb(o.payload_hash)),'[]') into diagnostics from private.r12_discovery_response_observations o
  join private.r05_requests r on r.id=o.request_id join private.r07_attempts a on a.id=r.workflow_run_id where a.business_id=b and a.goal_id=g and o.kind='rejected';
 history:=jsonb_build_object('version','r12.public-research-origin-history.1','businessId',b,'goalId',g,'predecessorScopeId',s.id,
  'predecessorClosureHash',private.stage14_hash(closure),'receipts',receipt_rows,'financialProofs',finance,'provenance',provenance,'materialHistory',material,
  'continuity',jsonb_build_object('seenQuestionHashes',private.r12_direct_origin_set(questions),'seenEvidenceIdentityHashes',private.r12_direct_origin_set(quotes),
   'seenFactIdentityHashes',private.r12_direct_origin_set(facts),'usedDiagnosticHashes',private.r12_direct_origin_set(diagnostics),
   'negativeFindingHashes',private.r12_direct_origin_set(negative),'consecutiveNonprogress',streak));
 history:=history||jsonb_build_object('historyHash',private.stage14_hash(history));
 if octet_length(private.stage14_canonical(history))>2097152 then raise exception 'r12_direct_origin_archive_too_large';end if;
 return jsonb_build_object('predecessor',predecessor,'originHistory',history);
end $$;

create function private.r12_direct_origin_frozen_check(b uuid,g uuid,expected_origin_hash text) returns jsonb
language plpgsql set search_path='' as $$
declare f private.r12_direct_origin_freezes;h private.r07_heads;binding private.r12_owner_funding_bindings;v integer;begin
 select * into f from private.r12_direct_origin_freezes where business_id=b and goal_id=g and origin_hash=expected_origin_hash;
 if f.predecessor_plan_id is null then raise exception 'r12_direct_origin_exact_freeze_required';end if;
 perform 1 from public.businesses where id=b and owner_user_id=f.owner_id for share;
 if not found then raise exception 'r12_direct_origin_owner_changed';end if;
 select * into h from private.r07_heads where business_id=b and goal_id=g;
 select * into binding from private.r12_owner_funding_bindings where business_id=b;
 v:=(f.packet->'predecessor'->'closure'->>'predecessorPlanVersion')::integer;
 if f.origin_hash is distinct from private.stage14_hash(f.packet) or to_jsonb(h) is distinct from f.head_snapshot
 or binding.authority_root_id is distinct from f.authority_root_id
 or private.stage14_hash(private.r12_direct_origin_snapshot(b,g,v)) is distinct from f.history_snapshot_hash
 or not exists(select 1 from private.r04_goal_state gs join private.r04_goal_versions gv using(business_id,goal_id,revision)
  where gs.business_id=b and gs.goal_id=g and gs.revision=(f.packet->'predecessor'->'closure'->>'goalRevision')::integer
  and gv.content_hash=f.packet->'predecessor'->'closure'->>'goalHash' and gv.preference='ready')
 or not exists(select 1 from private.r04_business_state bs join private.r04_business_versions bv using(business_id,revision)
  where bs.business_id=b and bs.revision=(f.packet->'predecessor'->'closure'->>'businessRevision')::integer
  and bv.content_hash=f.packet->'predecessor'->'closure'->>'businessHash' and bv.preference='setup')
 or exists(select 1 from private.r07_plans p join private.r12_discovery_authorities q on q.scope_id=(p.content->>'discoveryScopeId')::uuid
  where p.business_id=b and p.goal_id=g and p.version<=v and
  (not exists(select 1 from private.r07_server_revocations z where z.key_hash=q.controller_key_hash)
   or not exists(select 1 from private.r05_server_revocations z where z.key_hash=q.admission_key_hash)))
 then raise exception 'r12_direct_origin_frozen_predecessor_changed';end if;
 -- No r05_exposure/r12_owner_funding no-pending check here. New setup liabilities
 -- belong to the confirmed envelope and are checked by its new financial gate.
 return f.packet;
end $$;

create function private.r12_direct_origin_freeze(b uuid,g uuid,expected_origin_hash text) returns jsonb
language plpgsql set search_path='' as $$
declare binding private.r12_owner_funding_bindings;h private.r07_heads;p private.r07_plans;packet jsonb;snapshot jsonb;begin
 perform 1 from public.businesses where id=b and owner_user_id=auth.uid() for update;
 if not found then raise exception 'r12_direct_origin_owner_required' using errcode='42501';end if;
 select * into binding from private.r12_owner_funding_bindings where business_id=b;
 if binding.id is null then raise exception 'r12_direct_origin_funding_required';end if;
 if binding.kind='legacy_research_root' then
  perform 1 from public.product_experiments where id=binding.authority_root_id and business_id=b for update;
  if not found then raise exception 'r12_direct_origin_original_root_required';end if;
 end if;
 perform 1 from private.r12_owner_grant_roots where binding_id=binding.id for update;
 select * into strict h from private.r07_heads where business_id=b and goal_id=g for update;
 if exists(select 1 from private.r12_direct_origin_freezes where business_id=b and goal_id=g) then
  return private.r12_direct_origin_frozen_check(b,g,expected_origin_hash);
 end if;
 select * into strict p from private.r07_plans where id=h.plan_id;
 packet:=private.r12_direct_origin_build(b,g);
 if expected_origin_hash is distinct from private.stage14_hash(packet) then raise exception 'r12_direct_origin_preview_changed';end if;
 -- Lock both old capabilities before closing; ordinary Stop deliberately did
 -- not revoke them, so qualified late billing remained recoverable until now.
 perform 1 from private.r07_server_keys k join private.r12_discovery_authorities q on q.controller_key_hash=k.key_hash
  join private.r07_plans oldp on oldp.content->>'discoveryScopeId'=q.scope_id::text
  where oldp.business_id=b and oldp.goal_id=g for update of k;
 perform 1 from private.r05_server_keys k join private.r12_discovery_authorities q on q.admission_key_hash=k.key_hash
  join private.r07_plans oldp on oldp.content->>'discoveryScopeId'=q.scope_id::text
  where oldp.business_id=b and oldp.goal_id=g for update of k;
 insert into private.r07_server_revocations(key_hash)
  select distinct q.controller_key_hash from private.r12_discovery_authorities q join private.r07_plans oldp on oldp.content->>'discoveryScopeId'=q.scope_id::text
  where oldp.business_id=b and oldp.goal_id=g on conflict do nothing;
 insert into private.r05_server_revocations(key_hash)
  select distinct q.admission_key_hash from private.r12_discovery_authorities q join private.r07_plans oldp on oldp.content->>'discoveryScopeId'=q.scope_id::text
  where oldp.business_id=b and oldp.goal_id=g on conflict do nothing;
 snapshot:=private.r12_direct_origin_snapshot(b,g,p.version);
 insert into private.r12_direct_origin_freezes(predecessor_plan_id,business_id,goal_id,owner_id,authority_root_id,
  packet,origin_hash,history_snapshot,history_snapshot_hash,head_snapshot)
 values(p.id,b,g,p.owner_id,binding.authority_root_id,packet,expected_origin_hash,snapshot,private.stage14_hash(snapshot),to_jsonb(h));
 return private.r12_direct_origin_frozen_check(b,g,expected_origin_hash);
end $$;

create function private.r12_direct_origin_plan_frozen(plan uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from private.r07_plans p join private.r12_direct_origin_freezes f on f.business_id=p.business_id and f.goal_id=p.goal_id
 where p.id=plan and p.version<=(f.packet->'predecessor'->'closure'->>'predecessorPlanVersion')::integer)
$$;
-- Defense in depth against a different, otherwise valid bootstrap key. Existing
-- controllers retain their original behavior for every unfrozen .1/.2 scope.
create function private.r12_direct_origin_mutation_guard() returns trigger language plpgsql set search_path='' as $$
declare row jsonb:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;v_plan uuid;v_attempt uuid;v_request uuid;v_scope uuid;begin
 if row ? 'plan_id' then v_plan:=(row->>'plan_id')::uuid;end if;
 if tg_table_name='r07_plans' then v_plan:=(row->>'id')::uuid;end if;
 if row ? 'attempt_id' then v_attempt:=(row->>'attempt_id')::uuid;end if;
 if tg_table_name='r07_attempts' then v_attempt:=(row->>'id')::uuid;end if;
 if row ? 'request_id' then v_request:=(row->>'request_id')::uuid;end if;
 if tg_table_name='r05_requests' then v_request:=(row->>'id')::uuid;v_attempt:=(row->>'workflow_run_id')::uuid;
  if exists(select 1 from private.r07_plans p where p.policy_id=(row->>'policy_id')::uuid and private.r12_direct_origin_plan_frozen(p.id))
   then raise exception 'r12_direct_origin_irreversibly_closed';end if;
 end if;
 if tg_table_name='r12_discovery_receipt_observations' then
  select request_id into v_request from private.r12_discovery_receipt_checks where id=(row->>'check_id')::uuid;
 end if;
 if v_request is not null then select workflow_run_id into v_attempt from private.r05_requests where id=v_request;end if;
 if v_plan is null and v_attempt is not null then select plan_id into v_plan from private.r07_attempts where id=v_attempt;end if;
 if v_plan is null and row ? 'scope_id' then
  v_scope:=(row->>'scope_id')::uuid;select id into v_plan from private.r07_plans where content->>'discoveryScopeId'=v_scope::text;
 end if;
 if private.r12_direct_origin_plan_frozen(v_plan) then raise exception 'r12_direct_origin_irreversibly_closed';end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
do $guards$ declare t text;d text;begin
 foreach t in array array['r07_heads','r07_children','r07_attempts','r07_bindings','r07_markers','r07_responses','r07_reused','r07_events',
 'r05_requests','r05_reservations','r05_markers','r05_releases','r05_settlements',
 'r12_discovery_wires','r12_discovery_transport_claims','r12_discovery_candidates','r12_discovery_receipt_checks','r12_discovery_receipt_observations',
 'r12_discovery_response_observations','r12_adaptive_actions','r12_adaptive_action_dependencies','r12_adaptive_action_closures',
 'r12_adaptive_failed_calls','r12_adaptive_call_admissions','r12_adaptive_input_snapshots'] loop
  execute format('create trigger direct_origin_closed before insert or update or delete on private.%I for each row execute function private.r12_direct_origin_mutation_guard()',t);
 end loop;
 d:=pg_get_functiondef('public.r12_discovery_server(uuid,uuid,text,jsonb,text)'::regprocedure);
 d:=regexp_replace(d,'\mbegin\M',$guard$begin
 if exists(select 1 from private.r07_attempts olda where olda.id=p_attempt_id and olda.business_id=p_business_id
  and private.r12_direct_origin_plan_frozen(olda.plan_id)) then raise exception 'r12_direct_origin_irreversibly_closed';end if;
 $guard$,'i');execute d;
 d:=pg_get_functiondef('public.r12_adaptive_controller_server(uuid,uuid,text,jsonb,text)'::regprocedure);
 d:=regexp_replace(d,'\mbegin\M',$guard$begin
 if exists(select 1 from private.r07_plans oldp where oldp.business_id=p_business_id and oldp.content->>'discoveryScopeId'=p_scope_id::text
  and private.r12_direct_origin_plan_frozen(oldp.id)) then raise exception 'r12_direct_origin_irreversibly_closed';end if;
 $guard$,'i');execute d;
 d:=pg_get_functiondef('public.r07_controller(uuid,uuid,text,jsonb,uuid,text,text,bigint,text)'::regprocedure);
 d:=regexp_replace(d,'\mbegin\M',$guard$begin
 if p_operation<>'read' and
 (exists(select 1 from private.r07_heads oldh where oldh.business_id=p_business_id and oldh.goal_id=p_goal_id and private.r12_direct_origin_plan_frozen(oldh.plan_id))
 or exists(select 1 from private.r07_attempts olda where olda.business_id=p_business_id and olda.id::text=p_payload->>'attemptId' and private.r12_direct_origin_plan_frozen(olda.plan_id)))
 then raise exception 'r12_direct_origin_irreversibly_closed';end if;
 $guard$,'i');execute d;
 d:=pg_get_functiondef('public.r05_admission_server(uuid,text,jsonb,text)'::regprocedure);
 d:=regexp_replace(d,'\mbegin\M',$guard$begin
 if exists(select 1 from private.r05_requests oldr join private.r07_attempts olda on olda.id=oldr.workflow_run_id
  where oldr.business_id=p_business_id and oldr.id::text=p_payload->>'requestId' and private.r12_direct_origin_plan_frozen(olda.plan_id))
  then raise exception 'r12_direct_origin_irreversibly_closed';end if;
 $guard$,'i');execute d;
end $guards$;

do $acl$ declare f regprocedure;begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and (p.proname like 'r12_direct_origin_%' or p.proname='r12_direct_legacy_predecessor') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
 end loop;
end $acl$;
commit;
