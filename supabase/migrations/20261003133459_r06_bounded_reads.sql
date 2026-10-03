-- R06 additive, pure owner reads. No existing function, table grant, row or authority is changed.
begin;
create function private.r06_experiment_goal(p_business_id uuid,p_experiment_id uuid) returns uuid
language sql stable set search_path='' as $$
 select case when count(distinct matches.goal_id)=1 then (array_agg(distinct matches.goal_id))[1] else null end
 from (
  select w.goal_id from public.product_experiments e join public.workflow_runs w on w.id=e.workflow_run_id and w.business_id=e.business_id
   where e.id=p_experiment_id and e.business_id=p_business_id and w.goal_id is not null
  union all
  select l.goal_id from public.product_experiments e join private.r04_research_links l on l.experiment_id=e.id and l.business_id=e.business_id and l.workflow_run_id=e.workflow_run_id
   where e.id=p_experiment_id and e.business_id=p_business_id
 ) matches join public.goals g on g.id=matches.goal_id and g.business_id=p_business_id;
$$;
revoke all on function private.r06_experiment_goal(uuid,uuid) from public,anon,authenticated,service_role;
create function public.r06_read(p_business_id uuid,p_dataset text,p_query jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid(); observed timestamptz:=statement_timestamp(); source text; scoped text; filtered text;
 n integer:=25; off integer:=0; needle text:=''; status_filter text:='all'; selected uuid; goal uuid; intervention uuid;
 total bigint; owner_total bigint; items jsonb; detail jsonb; target uuid; candidate uuid; workflow uuid; state jsonb:='{}'::jsonb;
begin
 if uid is null then raise exception 'owner_required' using errcode='42501'; end if;
 if p_business_id is null and p_dataset not in ('account_unresolved','product_candidates','product_experiments','product_decisions','production_candidates') then raise exception 'business_required'; end if;
 if p_business_id is not null and not exists(select 1 from public.businesses where id=p_business_id and owner_user_id=uid) then raise exception 'owner_required' using errcode='42501'; end if;
 if jsonb_typeof(p_query) is distinct from 'object' or octet_length(p_query::text)>2048 or p_query-array['limit','offset','query','status','selectedId','interventionId','goalId','candidateId','workflowRunId']<>'{}'::jsonb then raise exception 'read_query_invalid'; end if;
 if p_query ? 'limit' then
  if jsonb_typeof(p_query->'limit')<>'number' or (p_query->>'limit') !~ '^[0-9]+$' then raise exception 'read_limit_invalid'; end if;
  n:=(p_query->>'limit')::integer;
 end if;
 if p_query ? 'offset' then
  if jsonb_typeof(p_query->'offset')<>'number' or (p_query->>'offset') !~ '^[0-9]+$' then raise exception 'read_offset_invalid'; end if;
  off:=(p_query->>'offset')::integer;
 end if;
 if n not between 1 and 25 or off not between 0 and 249999 then raise exception 'read_bounds_invalid'; end if;
 if p_query ? 'query' and (jsonb_typeof(p_query->'query')<>'string' or length(p_query->>'query')>120) then raise exception 'read_search_invalid'; end if;
 needle:=coalesce(p_query->>'query','');status_filter:=coalesce(p_query->>'status','all');
 if status_filter not in ('all','candidate','open','pending_approval','approved','preparation_started','owner_handoff','expired','verified','queued','running','completed','passed','failed','cancelled','needs_owner','blocked','unknown','prepared','stopped','invalidated','ready','rejected','needs_evidence','profile_saved','request_prepared','request_approved','request_expired','connection_verified','connection_revoked','password_saved','password_deleted','local_revoked','password_removed','TEST','REJECT','NEEDS_MORE_EVIDENCE','unassessed','reserved','researching') then raise exception 'read_status_invalid'; end if;
 if exists(select 1 from jsonb_each(p_query) e where e.key in ('status','selectedId','goalId','interventionId','candidateId','workflowRunId') and (jsonb_typeof(e.value)<>'string' or e.value='""'::jsonb)) then raise exception 'read_filter_invalid'; end if;
 candidate:=nullif(p_query->>'candidateId','')::uuid; workflow:=nullif(p_query->>'workflowRunId','')::uuid;
 selected:=nullif(p_query->>'selectedId','')::uuid; goal:=nullif(p_query->>'goalId','')::uuid; intervention:=nullif(p_query->>'interventionId','')::uuid;
 if goal is not null and (p_dataset like 'account_%' or not exists(select 1 from public.goals where id=goal and business_id=p_business_id)) then raise exception 'quest_scope_invalid'; end if;
 if (candidate is not null or workflow is not null) and p_dataset not in ('product_candidates','product_experiments','product_decisions','production_candidates') then raise exception 'read_filter_invalid'; end if;
 if intervention is not null then
  if p_dataset='publication_runs' then
   select r.id into target from public.owner_interventions oi join private.etsy_publication_runs r on r.action_intent_id=oi.action_intent_id and r.business_id=oi.business_id
    join public.action_intents ai on ai.id=r.action_intent_id and ai.business_id=r.business_id
    where oi.id=intervention and oi.business_id=p_business_id and oi.intervention_type='etsy.publication.reconcile' and r.owner_id=uid and ai.action_type='etsy.publication.activate' and ai.capability='marketplace.etsy.publish';
  elsif p_dataset='printful_runs' then
   select r.id into target from public.owner_interventions oi join private.printful_product_runs r on r.action_intent_id=oi.action_intent_id and r.business_id=oi.business_id
    join public.action_intents ai on ai.id=r.action_intent_id and ai.business_id=r.business_id
    where oi.id=intervention and oi.business_id=p_business_id and oi.intervention_type='printful.product.reconcile' and r.owner_id=uid and ai.action_type='printful.product.configure';
  else raise exception 'intervention_scope_invalid'; end if;
  if target is null or (selected is not null and selected<>target) then raise exception 'intervention_not_found'; end if;
  selected:=target;
 end if;
 if p_dataset='account_state' then
  if p_query<>'{}'::jsonb then raise exception 'read_query_invalid'; end if;
  return jsonb_build_object('observedAt',observed,'profile',(select profile||jsonb_build_object('revision',revision) from private.account_profiles where business_id=p_business_id and owner_id=uid),'accounts',private.account_registry(p_business_id),'currentRuns',coalesce((select jsonb_agg(private.account_run_view(r) order by r.provider) from (select distinct on (provider) * from private.account_setup_runs where business_id=p_business_id and owner_id=uid order by provider,created_at desc,id desc) r),'[]'::jsonb));
 elsif p_dataset='etsy_state' then
  if p_query<>'{}'::jsonb then raise exception 'read_query_invalid'; end if;
  return jsonb_build_object('connection',(select jsonb_build_object('id',id,'shopName',shop_name,'shopId',shop_id,'status',status,'currency',currency) from private.etsy_connections where business_id=p_business_id and owner_id=uid));
 elsif p_dataset='listing_state' then
  if p_query<>'{}'::jsonb then raise exception 'read_query_invalid'; end if;
  return jsonb_build_object('qualified',private.stage17_qualified(),'activeQualification',exists(select 1 from private.listing_qualification_runs where business_id=p_business_id and status in ('queued','running')));
 end if;
 case p_dataset
 when 'account_runs' then source:=$source$select r.id,r.business_id,r.created_at,r.provider label,
 case when r.status in ('pending_approval','approved','preparation_started','owner_handoff') and r.approval_expires_at<=$3 then 'expired' else r.status end status,
 null::uuid goal_id, private.account_run_view(r)||jsonb_build_object('status',case when r.status in ('pending_approval','approved','preparation_started','owner_handoff') and r.approval_expires_at<=$3 then 'expired' else r.status end) item
 from private.account_setup_runs r where r.owner_id=$2$source$;
 when 'account_unresolved' then source:=$source$select r.id,r.business_id,r.created_at,r.provider label,
 case when r.status in ('pending_approval','approved','preparation_started','owner_handoff') and r.approval_expires_at<=$3 then 'expired' else r.status end status,
 null::uuid goal_id, private.account_run_view(r)||jsonb_build_object('status',case when r.status in ('pending_approval','approved','preparation_started','owner_handoff') and r.approval_expires_at<=$3 then 'expired' else r.status end) item
 from private.account_setup_runs r where r.owner_id=$2 and r.status in ('pending_approval','approved','preparation_started','owner_handoff') and (r.approval_expires_at is null or r.approval_expires_at>$3)$source$;
 when 'account_health' then source:=$source$select h.id,h.business_id,h.created_at,h.provider label,h.event_type status,null::uuid goal_id,
 jsonb_build_object('id',h.id,'provider',h.provider,'runId',h.setup_run_id,'eventType',h.event_type,'summary',h.summary,'occurredAt',h.created_at) item from private.account_health_events h$source$;
 when 'etsy_runs' then source:=$source$select r.id,r.business_id,r.approved_at created_at,r.package->>'title' label,r.state->>'status' status,w.goal_id,
 jsonb_build_object('id',r.id,'title',r.package->>'title','status',r.state->>'status','reason',r.state->>'reason','listingId',r.state->'listingId','approvedAt',r.approved_at,'stopped',r.stopped_at is not null) item
 from private.etsy_draft_runs r left join public.workflow_runs w on w.business_id=r.business_id and w.id::text=r.package->>'workflowRunId' and w.goal_id::text=r.package->>'goalId' where r.owner_id=$2$source$;
 when 'publication_runs' then source:=$source$select r.id,r.business_id,r.approved_at created_at,r.package->>'title' label,r.state->>'status' status,w.goal_id,private.stage18_view(r.id) item
 from private.etsy_publication_runs r left join public.workflow_runs w on w.business_id=r.business_id and w.id::text=r.package->>'workflowRunId' and w.goal_id::text=r.package->>'goalId' where r.owner_id=$2$source$;
 when 'publication_drafts' then source:=$source$select d.id,d.business_id,d.approved_at created_at,d.package->>'title' label,d.state->>'status' status,w.goal_id,
 jsonb_build_object('id',d.id,'title',d.package->>'title','packageArtifactId',d.package_artifact_id,'packageHash',d.package_hash,'listingId',d.state->'listingId','shopId',d.shop_id,'quantity',d.package->'quantity','priceMinor',d.package->'priceMinor','currency',d.package->>'currency','verifiedAt',ar.occurred_at) item
 from private.etsy_draft_runs d join public.action_receipts ar on ar.id::text=d.state->>'receiptId' and ar.business_id=d.business_id
 left join public.workflow_runs w on w.business_id=d.business_id and w.id::text=d.package->>'workflowRunId' and w.goal_id::text=d.package->>'goalId'
 where d.owner_id=$2 and d.state->>'status'='verified' and not exists(select 1 from private.etsy_publication_runs p where p.draft_run_id=d.id and p.business_id=d.business_id)$source$;
 when 'printful_runs' then source:=$source$select r.id,r.business_id,r.approved_at created_at,r.source->>'name' label,r.state->>'status' status,w.goal_id,
 jsonb_build_object('id',r.id,'name',r.source->>'name','status',r.state->>'status','reason',r.state->>'reason','stopRequested',r.stopped_at is not null,'dispatchSent',r.state->'dispatch' is not null and r.state->'dispatch'<>'null'::jsonb,'receiptRecorded',r.state->'receiptRecorded','syncProductId',r.state->'syncProductId','syncVariantId',r.state->'syncVariantId') item
 from private.printful_product_runs r left join public.workflow_runs w on w.business_id=r.business_id and w.id::text=r.source->>'workflowRunId' and w.goal_id::text=r.source->>'goalId' where r.owner_id=$2$source$;
 when 'printful_sources' then source:=$source$select s.id,s.business_id,s.imported_at created_at,s.source->>'name' label,'candidate'::text status,w.goal_id,
 jsonb_build_object('id',s.id,'name',s.source->>'name','sourceHash',s.source_hash,'expiresAt',s.source->>'expiresAt','storeId',s.store_id,'assetSha256',s.source->>'assetSha256','catalogProductId',s.source->'plan'->'productId','catalogVariantId',s.source->'plan'->'variantId','placement',s.source->'plan'->'placement','designWidthIn',s.source->'plan'->'designWidthIn','designHeightIn',s.source->'plan'->'designHeightIn','retailPrice',s.source->'retailPrice','currency',s.source->'currency') item
 from private.printful_product_sources s left join public.workflow_runs w on w.business_id=s.business_id and w.id::text=s.source->>'workflowRunId' and w.goal_id::text=s.source->>'goalId' where s.owner_id=$2$source$;
 when 'listing_runs' then source:=$source$select r.id,r.business_id,r.created_at,'Listing preparation'::text label,r.status,w.goal_id,
 jsonb_build_object('id',r.id,'workflowRunId',r.workflow_run_id,'sourceArtifactId',r.source_artifact_id,'outputArtifactId',r.output_artifact_id,'status',r.status,'phase',r.phase,'reason',r.reason,'maximumMicrousd',r.maximum_microusd,'createdAt',r.created_at,'expiresAt',r.capability_expires_at,
 'costs',coalesce((select jsonb_agg(jsonb_build_object('role',c.role,'reservedMicrousd',c.reserved_microusd,'reportedMicrousd',st.reported_microusd,'providerRequestId',st.provider_request_id,'settled',st.listing_run_id is not null) order by c.role) from public.listing_cost_reservations c left join public.listing_cost_settlements st using(listing_run_id,role,business_id) where c.listing_run_id=r.id and c.business_id=r.business_id),'[]'::jsonb),
 'proposal',(select output from public.listing_phase_outputs where listing_run_id=r.id and business_id=r.business_id and role='specialist'),
 'review',(select output from public.listing_phase_outputs where listing_run_id=r.id and business_id=r.business_id and role='reviewer')) item
 from public.listing_runs r join public.workflow_runs w on w.id=r.workflow_run_id and w.business_id=r.business_id$source$;
 when 'listing_qualifications' then source:=$source$select r.id,r.business_id,r.created_at,'Listing qualification'::text label,case r.status when 'completed' then 'passed' else r.status end status,w.goal_id,
 jsonb_build_object('id',r.id,'workflowRunId',r.workflow_run_id,'status',case r.status when 'completed' then 'passed' else r.status end,'reason',r.reason,'maximumMicrousd',r.maximum_microusd,'createdAt',r.created_at,'expiresAt',r.expires_at,
 'costs',coalesce((select jsonb_agg(jsonb_build_object('caseKey',a.case_key,'reservedMicrousd',a.reserved_microusd,'reportedMicrousd',b.reported_microusd,'settled',b.run_id is not null) order by a.case_key) from private.listing_qualification_reservations a left join private.listing_qualification_settlements b using(run_id,case_key) where a.run_id=r.id),'[]'::jsonb)) item
 from private.listing_qualification_runs r join public.workflow_runs w on w.id=r.workflow_run_id and w.business_id=r.business_id$source$;
 when 'etsy_packages' then source:=$source$select a.id,a.business_id,a.created_at,a.name label,'candidate'::text status,w.goal_id,jsonb_build_object('id',a.id,'name',a.name,'createdAt',a.created_at) item
 from public.artifacts a left join public.workflow_runs w on w.id=a.workflow_run_id and w.business_id=a.business_id where a.artifact_type='product.package.v1' and jsonb_typeof(a.content->'etsyDraftEnvelope')='string' and jsonb_typeof(a.content->'listingReviewEnvelope')='string'$source$;
 when 'listing_sources' then source:=$source$select a.id,a.business_id,a.created_at,a.name label,'candidate'::text status,w.goal_id,jsonb_build_object('id',a.id,'name',a.name,'createdAt',a.created_at) item
 from public.artifacts a left join public.workflow_runs w on w.id=a.workflow_run_id and w.business_id=a.business_id where a.artifact_type='product.package.v1' and jsonb_typeof(a.content->'listingInputEnvelope')='string' and not exists(select 1 from public.listing_runs r where r.business_id=a.business_id and r.source_artifact_id=a.id)$source$;
 when 'product_candidates' then source:=$source$select c.id,c.business_id,c.created_at,c.concept label,coalesce((select assessment->>'outcome' from public.product_decisions where candidate_id=c.id and business_id=c.business_id and ($4 is null or private.r06_experiment_goal(business_id,experiment_id)=$4) and ($10 is null or exists(select 1 from public.product_experiments selected_experiment where selected_experiment.id=experiment_id and selected_experiment.business_id=c.business_id and selected_experiment.workflow_run_id=$10)) order by created_at desc,id desc limit 1),'unassessed') status,$4::uuid goal_id,
 jsonb_build_object('id',c.id,'candidate',(to_jsonb(c)||jsonb_build_object('current_decision_id',(select id from public.product_decisions latest where latest.business_id=c.business_id and latest.candidate_id=c.id order by latest.created_at desc,latest.id desc limit 1),
 'current_decision_ambiguous',(select count(*)>1 from public.product_decisions tied where tied.business_id=c.business_id and tied.candidate_id=c.id and tied.created_at=(select max(created_at) from public.product_decisions current_decision where current_decision.business_id=c.business_id and current_decision.candidate_id=c.id)))),'decisions',coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at desc,d.id desc) from (select * from public.product_decisions where candidate_id=c.id and business_id=c.business_id and ($4 is null or private.r06_experiment_goal(business_id,experiment_id)=$4) and ($10 is null or exists(select 1 from public.product_experiments selected_experiment where selected_experiment.id=experiment_id and selected_experiment.business_id=c.business_id and selected_experiment.workflow_run_id=$10)) order by created_at desc,id desc limit 2) d),'[]'::jsonb),
 'experiments',coalesce((select jsonb_agg(to_jsonb(e)||jsonb_build_object('has_competing_completed_v2',exists(select 1 from public.product_experiments competing where competing.business_id=e.business_id and competing.candidate_id=e.candidate_id and competing.id<>e.id and competing.discovery_version='pod-discovery-2.0' and competing.status='completed' and competing.created_at>=e.created_at),'has_successor',exists(select 1 from public.product_experiments successor where successor.business_id=e.business_id and successor.parent_discovery_id is null and successor.variables->'ownerKickoff'->'followUpBasis'->>'rootId'=e.id::text))) from public.product_experiments e where e.business_id=c.business_id and ($4 is null or private.r06_experiment_goal(e.business_id,e.id)=$4) and ($10 is null or e.workflow_run_id=$10) and e.id in (
 select x.id from (select e0.id from public.product_experiments e0 where e0.business_id=c.business_id and e0.candidate_id=c.id and ($4 is null or private.r06_experiment_goal(e0.business_id,e0.id)=$4) and ($10 is null or e0.workflow_run_id=$10) order by e0.created_at desc,e0.id desc limit 2) x
 union select v.id from (select id from public.product_experiments where business_id=c.business_id and candidate_id=c.id and discovery_version='pod-discovery-2.0' and status='completed' order by created_at desc,id desc limit 2) v
 union select d.experiment_id from (select * from public.product_decisions where candidate_id=c.id and business_id=c.business_id and ($4 is null or private.r06_experiment_goal(business_id,experiment_id)=$4) and ($10 is null or exists(select 1 from public.product_experiments selected_experiment where selected_experiment.id=experiment_id and selected_experiment.business_id=c.business_id and selected_experiment.workflow_run_id=$10)) order by created_at desc,id desc limit 2) d
 union select e0.parent_discovery_id from public.product_experiments e0 where e0.business_id=c.business_id and e0.id in (select experiment_id from public.product_decisions where candidate_id=c.id and business_id=c.business_id and ($4 is null or private.r06_experiment_goal(business_id,experiment_id)=$4) and ($10 is null or exists(select 1 from public.product_experiments selected_experiment where selected_experiment.id=experiment_id and selected_experiment.business_id=c.business_id and selected_experiment.workflow_run_id=$10)) order by created_at desc,id desc limit 2)
 )),'[]'::jsonb)) item
 from public.product_candidates c
 where ($9 is null or c.id=$9) and (($4 is null and $10 is null) or exists(select 1 from public.product_experiments membership where membership.business_id=c.business_id and membership.candidate_id=c.id and ($4 is null or private.r06_experiment_goal(membership.business_id,membership.id)=$4) and ($10 is null or membership.workflow_run_id=$10)))$source$;
 when 'production_candidates' then source:=$source$select c.id,c.business_id,c.created_at,c.concept label,coalesce((select assessment->>'outcome' from public.product_decisions where candidate_id=c.id and business_id=c.business_id and ($4 is null or private.r06_experiment_goal(business_id,experiment_id)=$4) and ($10 is null or exists(select 1 from public.product_experiments selected_experiment where selected_experiment.id=experiment_id and selected_experiment.business_id=c.business_id and selected_experiment.workflow_run_id=$10)) order by created_at desc,id desc limit 1),'unassessed') status,$4::uuid goal_id,
 jsonb_build_object('id',c.id,'candidate',(to_jsonb(c)||jsonb_build_object('current_decision_id',(select id from public.product_decisions latest where latest.business_id=c.business_id and latest.candidate_id=c.id order by latest.created_at desc,latest.id desc limit 1),
 'current_decision_ambiguous',(select count(*)>1 from public.product_decisions tied where tied.business_id=c.business_id and tied.candidate_id=c.id and tied.created_at=(select max(created_at) from public.product_decisions current_decision where current_decision.business_id=c.business_id and current_decision.candidate_id=c.id)))),'decisions',coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at desc,d.id desc) from (select * from public.product_decisions where candidate_id=c.id and business_id=c.business_id and ($4 is null or private.r06_experiment_goal(business_id,experiment_id)=$4) and ($10 is null or exists(select 1 from public.product_experiments selected_experiment where selected_experiment.id=experiment_id and selected_experiment.business_id=c.business_id and selected_experiment.workflow_run_id=$10)) order by created_at desc,id desc limit 2) d),'[]'::jsonb),
 'experiments',coalesce((select jsonb_agg(to_jsonb(e)||jsonb_build_object('has_competing_completed_v2',exists(select 1 from public.product_experiments competing where competing.business_id=e.business_id and competing.candidate_id=e.candidate_id and competing.id<>e.id and competing.discovery_version='pod-discovery-2.0' and competing.status='completed' and competing.created_at>=e.created_at),'has_successor',exists(select 1 from public.product_experiments successor where successor.business_id=e.business_id and successor.parent_discovery_id is null and successor.variables->'ownerKickoff'->'followUpBasis'->>'rootId'=e.id::text))) from public.product_experiments e where e.business_id=c.business_id and ($4 is null or private.r06_experiment_goal(e.business_id,e.id)=$4) and ($10 is null or e.workflow_run_id=$10) and e.id in (
 select x.id from (select e0.id from public.product_experiments e0 where e0.business_id=c.business_id and e0.candidate_id=c.id and ($4 is null or private.r06_experiment_goal(e0.business_id,e0.id)=$4) and ($10 is null or e0.workflow_run_id=$10) order by e0.created_at desc,e0.id desc limit 2) x
 union select v.id from (select id from public.product_experiments where business_id=c.business_id and candidate_id=c.id and discovery_version='pod-discovery-2.0' and status='completed' order by created_at desc,id desc limit 2) v
 union select d.experiment_id from (select * from public.product_decisions where candidate_id=c.id and business_id=c.business_id and ($4 is null or private.r06_experiment_goal(business_id,experiment_id)=$4) and ($10 is null or exists(select 1 from public.product_experiments selected_experiment where selected_experiment.id=experiment_id and selected_experiment.business_id=c.business_id and selected_experiment.workflow_run_id=$10)) order by created_at desc,id desc limit 2) d
 union select e0.parent_discovery_id from public.product_experiments e0 where e0.business_id=c.business_id and e0.id in (select experiment_id from public.product_decisions where candidate_id=c.id and business_id=c.business_id and ($4 is null or private.r06_experiment_goal(business_id,experiment_id)=$4) and ($10 is null or exists(select 1 from public.product_experiments selected_experiment where selected_experiment.id=experiment_id and selected_experiment.business_id=c.business_id and selected_experiment.workflow_run_id=$10)) order by created_at desc,id desc limit 2)
 )),'[]'::jsonb)) item
 from public.product_candidates c
 where ($9 is null or c.id=$9) and (($4 is null and $10 is null) or exists(select 1 from public.product_experiments membership where membership.business_id=c.business_id and membership.candidate_id=c.id and ($4 is null or private.r06_experiment_goal(membership.business_id,membership.id)=$4) and ($10 is null or membership.workflow_run_id=$10))) and (select assessment->>'outcome' from public.product_decisions where candidate_id=c.id and business_id=c.business_id and ($4 is null or private.r06_experiment_goal(business_id,experiment_id)=$4) and ($10 is null or exists(select 1 from public.product_experiments selected_experiment where selected_experiment.id=experiment_id and selected_experiment.business_id=c.business_id and selected_experiment.workflow_run_id=$10)) order by created_at desc,id desc limit 1)='TEST'$source$;
 when 'product_experiments' then source:=$source$select e.id,e.business_id,e.created_at,coalesce(e.hypothesis,'Research experiment') label,e.status,private.r06_experiment_goal(e.business_id,e.id) goal_id,(to_jsonb(e)||jsonb_build_object('has_competing_completed_v2',exists(select 1 from public.product_experiments competing where competing.business_id=e.business_id and competing.candidate_id=e.candidate_id and competing.id<>e.id and competing.discovery_version='pod-discovery-2.0' and competing.status='completed' and competing.created_at>=e.created_at),'has_successor',exists(select 1 from public.product_experiments successor where successor.business_id=e.business_id and successor.parent_discovery_id is null and successor.variables->'ownerKickoff'->'followUpBasis'->>'rootId'=e.id::text))) item from public.product_experiments e left join public.workflow_runs w on w.id=e.workflow_run_id and w.business_id=e.business_id where ($9 is null or e.candidate_id=$9) and ($10 is null or e.workflow_run_id=$10)$source$;
 when 'product_decisions' then source:=$source$select d.id,d.business_id,d.created_at,c.concept label,d.assessment->>'outcome' status,private.r06_experiment_goal(e.business_id,e.id) goal_id,to_jsonb(d) item from public.product_decisions d join public.product_candidates c on c.id=d.candidate_id and c.business_id=d.business_id join public.product_experiments e on e.id=d.experiment_id and e.business_id=d.business_id left join public.workflow_runs w on w.id=e.workflow_run_id and w.business_id=e.business_id where ($9 is null or d.candidate_id=$9) and ($10 is null or e.workflow_run_id=$10)$source$;
 else raise exception 'read_dataset_invalid'; end case;
 -- Dynamic SQL is assembled exclusively from the constant branches above. Every user value is a bound parameter.
 -- LIMIT is applied inside the database before json aggregation; counts have the same filter and no page dependency.
 scoped:=' from ('||source||') s where ($1 is null or s.business_id=$1) and exists(select 1 from public.businesses b where b.id=s.business_id and b.owner_user_id=$2) and ($4 is null or s.goal_id=$4)';
 filtered:=scoped||' and ($5='''' or strpos(lower(s.label),lower($5))>0) and ($6=''all'' or s.status=$6)';
 execute 'select count(*)'||filtered into total using p_business_id,uid,observed,goal,needle,status_filter,n,off,candidate,workflow;
 execute 'select coalesce(jsonb_agg(p.item order by p.created_at desc,p.id desc),''[]''::jsonb) from (select s.item,s.created_at,s.id'||filtered||' order by s.created_at desc,s.id desc limit $7 offset $8) p'
  into items using p_business_id,uid,observed,goal,needle,status_filter,n,off,candidate,workflow;
 if selected is not null then
  execute 'select s.item'||scoped||' and s.id=$11 limit 1' into detail using p_business_id,uid,observed,goal,needle,status_filter,n,off,candidate,workflow,selected;
 end if;
 if octet_length(items::text)>8388608 or octet_length(coalesce(detail,'null'::jsonb)::text)>2097152 then raise exception 'read_payload_limit'; end if;
 if p_dataset='account_unresolved' then
  execute 'select count(*)'||scoped into owner_total using null::uuid,uid,observed,null::uuid;
 end if;
 return jsonb_build_object('ownerTotal',owner_total,'items',items,'total',total,'limit',n,'offset',off,'hasNext',off+jsonb_array_length(items)<total,'observedAt',observed,
  'selection',jsonb_build_object('status',case when selected is null then 'none' when detail is null then 'missing' else 'found' end,'item',detail));
end $$;
revoke all on function public.r06_read(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.r06_read(uuid,text,jsonb) to authenticated;
create index r06_business_directory on public.businesses(owner_user_id,created_at desc,id desc);
create index r06_account_history on private.account_setup_runs(business_id,owner_id,created_at desc,id desc);
create index r06_account_open on private.account_setup_runs(business_id,owner_id,status,created_at desc,id desc);
create index r06_account_health on private.account_health_events(business_id,created_at desc,id desc);
create index r06_etsy_history on private.etsy_draft_runs(business_id,owner_id,approved_at desc,id desc);
create index r06_publication_history on private.etsy_publication_runs(business_id,owner_id,approved_at desc,id desc);
create index r06_printful_history on private.printful_product_runs(business_id,owner_id,approved_at desc,id desc);
create index r06_printful_sources on private.printful_product_sources(business_id,owner_id,imported_at desc,id desc);
create index r06_listing_sources on public.listing_runs(business_id,source_artifact_id);
create index r06_artifact_sources on public.artifacts(business_id,artifact_type,created_at desc,id desc);
create index r06_candidate_latest on public.product_decisions(business_id,candidate_id,created_at desc,id desc);
create index r06_candidate_experiments on public.product_experiments(business_id,candidate_id,created_at desc,id desc);
commit;
