-- OFFLINE DRAFT: fence legacy mutation and stale creative eligibility boundaries.
-- Existing v1 records and cached replays remain intact. No new function, endpoint,
-- privilege, model route, print/IP waiver or invented candidate verdict is added.
-- The native-PNG owner approval/runtime implementations stay unchanged; their
-- existing private assert dependency gains one newer-experiment invalidation.

create or replace function public.begin_product_discovery(p_candidate_id uuid,p_launch_nonce uuid,p_runtime_capability text) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.product_candidates%rowtype; e public.product_experiments%rowtype; v_pack uuid; v_install uuid; v_run jsonb; v_id uuid;
begin
  select * into c from public.product_candidates where id=p_candidate_id;
  if c.id is null or auth.uid() is null or not private.is_business_owner(c.business_id) then raise exception 'Business ownership required.' using errcode='42501'; end if;
  if p_launch_nonce is null or coalesce(length(p_runtime_capability),0) not between 32 and 512 then raise exception 'Invalid product discovery reservation.'; end if;
  perform 1 from public.product_candidates where id=c.id for update;
  select * into e from public.product_experiments where candidate_id=c.id and basis_artifact_id is null and discovery_version='pod-discovery-1.0' and parent_discovery_id is null;
  if found then return jsonb_build_object('experimentId',e.id,'workflowRunId',e.workflow_run_id,'shouldStart',false,'cached',true); end if;
  if exists(select 1 from public.product_experiments newer where newer.business_id=c.business_id and newer.candidate_id=c.id and newer.discovery_version='pod-discovery-2.0') or
    exists(select 1 from public.artifacts dossier where dossier.business_id=c.business_id and dossier.artifact_type='product.discovery-dossier.v2' and
      (dossier.content->'shortlist') @> jsonb_build_array(jsonb_build_object('id',c.id))) then
    raise exception 'This candidate has versioned discovery history; use the bounded v2 workflow for new research or decisions.';
  end if;
  select id into strict v_pack from public.packs where pack_key='workflow.web-research' and version='1.0.0' and status='qualified';
  v_install:=public.activate_business_pack(c.business_id,v_pack);
  v_run:=public.begin_installed_pack_run(c.business_id,v_install,'research.public-evidence',
    jsonb_build_object('question',private.stage13_question(c.concept,c.audience,c.hypothesis),'sourceDomains',to_jsonb(c.source_domains)),
    'product-discovery:initial:'||c.id,p_launch_nonce,p_runtime_capability);
  insert into public.product_experiments(business_id,candidate_id,workflow_run_id,fingerprint,hypothesis,variables,audience,status,measurement_plan)
    values(c.business_id,c.id,(v_run->>'workflowRunId')::uuid,private.stage13_hash(c.id||':initial'),c.hypothesis,
      jsonb_build_object('concept',c.concept,'productType',c.product_type,'sourceDomains',c.source_domains,'originalDesign',c.original_design,'rightsStatus',c.rights_status),c.audience,'reserved',private.stage13_plan()) returning id into v_id;
  return jsonb_build_object('experimentId',v_id,'workflowRunId',v_run->'workflowRunId','shouldStart',v_run->'shouldStart','cached',false);
end; $$;

create or replace function private.stage13_finalize(p_experiment_id uuid) returns jsonb language plpgsql set search_path='' as $$
declare e public.product_experiments%rowtype; c public.product_candidates%rowtype; r public.workflow_runs%rowtype;
  v_artifact uuid; v_pack jsonb; v_assessment jsonb; v_decision uuid;
begin
  select * into strict e from public.product_experiments where id=p_experiment_id for update;
  if e.discovery_version<>'pod-discovery-1.0' or e.parent_discovery_id is not null then raise exception 'Legacy finalization cannot consume a v2 discovery descriptor; use its versioned terminal workflow.'; end if;
  if e.status='completed' then
    select id into strict v_decision from public.product_decisions where experiment_id=e.id and assessment->>'assessmentOrigin'='deterministic_provisional';
    return jsonb_build_object('experimentId',e.id,'workflowRunId',e.workflow_run_id,'decisionId',v_decision,'status','completed','cached',true); end if;
  if e.status='failed' then raise exception 'Failed discovery is terminal; new evidence requires reconsideration.'; end if;
  select * into strict c from public.product_candidates where id=e.candidate_id and business_id=e.business_id;
  if exists(select 1 from public.product_experiments newer where newer.business_id=c.business_id and newer.candidate_id=c.id and newer.discovery_version='pod-discovery-2.0') or
    exists(select 1 from public.artifacts dossier where dossier.business_id=c.business_id and dossier.artifact_type='product.discovery-dossier.v2' and
      (dossier.content->'shortlist') @> jsonb_build_array(jsonb_build_object('id',c.id))) then
    raise exception 'This candidate has versioned discovery history; use the bounded v2 workflow for new research or decisions.';
  end if;
  select * into strict r from public.workflow_runs where id=e.workflow_run_id and business_id=e.business_id and status='completed';
  v_artifact:=coalesce(e.basis_artifact_id,private.stage4_deterministic_uuid('pack:output:'||r.id||':research'));
  v_pack:=private.stage13_validated_evidence(v_artifact,e.business_id,true);
  if v_pack->>'question' is distinct from private.stage13_question(c.concept,c.audience,c.hypothesis) or
    (select array_agg(x order by x) from jsonb_array_elements_text(r.input->'sourceDomains') x) is distinct from c.source_domains then
    raise exception 'Research does not match this candidate scope.'; end if;
  v_assessment:=private.stage13_assessment(c,v_pack);
  update public.product_experiments set status='completed',evidence_pack=v_pack,source_artifact_id=v_artifact,
    started_at=coalesce(e.started_at,r.started_at,now()),completed_at=now(),failure=null where id=e.id;
  insert into public.product_decisions(business_id,candidate_id,experiment_id,assessment,assessment_fingerprint)
    values(e.business_id,c.id,e.id,v_assessment,private.stage13_hash(v_assessment::text)) returning id into v_decision;
  insert into public.events(id,business_id,workflow_run_id,event_type,actor_type,payload) values
    (private.stage4_deterministic_uuid('product:discovery-completed:'||e.id),e.business_id,r.id,'product.discovery.completed','system',
      jsonb_build_object('candidateId',c.id,'experimentId',e.id,'decisionId',v_decision,'outcome',v_assessment->>'outcome','liveQualified',false,'creativeProductionAllowed',false,'publicationAllowed',false));
  return jsonb_build_object('experimentId',e.id,'workflowRunId',r.id,'decisionId',v_decision,'status','completed','cached',false);
end; $$;

create or replace function public.product_discovery_runtime(p_workflow_run_id uuid,p_business_id uuid,p_runtime_capability text,p_operation text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.workflow_runs%rowtype; e public.product_experiments%rowtype; v_pack jsonb;
begin
  if coalesce(length(p_runtime_capability),0) not between 32 and 512 or p_operation is null or p_operation not in ('scope','finalize','fail') then raise exception 'Product runtime capability denied.' using errcode='42501'; end if;
  select * into r from public.workflow_runs where id=p_workflow_run_id and business_id=p_business_id
    and runtime_capability_hash=private.stage13_hash(p_runtime_capability) for update;
  if not found then raise exception 'Product runtime capability denied.' using errcode='42501'; end if;
  if exists(select 1 from public.product_experiments where workflow_run_id=r.id and business_id=r.business_id and discovery_version='pod-discovery-2.0') then raise exception 'The legacy runtime cannot mutate a v2 discovery root or child.'; end if;
  select * into e from public.product_experiments where workflow_run_id=r.id and business_id=r.business_id and basis_artifact_id is null and discovery_version='pod-discovery-1.0' and parent_discovery_id is null for update;
  if not found then raise exception 'Linked initial product experiment required.' using errcode='42501'; end if;
  if p_operation in ('scope','finalize') and e.status<>'completed' then
  if exists(select 1 from public.product_experiments newer where newer.business_id=e.business_id and newer.candidate_id=e.candidate_id and newer.discovery_version='pod-discovery-2.0') or
    exists(select 1 from public.artifacts dossier where dossier.business_id=e.business_id and dossier.artifact_type='product.discovery-dossier.v2' and
      (dossier.content->'shortlist') @> jsonb_build_array(jsonb_build_object('id',e.candidate_id))) then
    raise exception 'This candidate has versioned discovery history; use the bounded v2 workflow for new research or decisions.';
  end if;
  end if;
  if p_operation='scope' then
    if e.status='reserved' and r.status='running' then update public.product_experiments set status='researching',started_at=coalesce(r.started_at,now()) where id=e.id; end if;
    return jsonb_build_object('experimentId',e.id,'researchMode','automatic_search','budgetMicrousd',1000000,'reservationBasis','conservative_preflight_estimate','guaranteedInvoiceCap',false);
  end if;
  if p_operation='finalize' then
    if e.status='completed' then return private.stage13_finalize(e.id); end if;
    v_pack:=private.stage13_validated_evidence(private.stage4_deterministic_uuid('pack:output:'||r.id||':research'),r.business_id,false);
    perform public.installed_pack_runtime_transition(r.id,r.business_id,p_runtime_capability,'complete','{}');
    return private.stage13_finalize(e.id);
  end if;
  if e.status='completed' or r.status='completed' then return jsonb_build_object('experimentId',e.id,'status',e.status,'cached',true); end if;
  if r.status<>'failed' then raise exception 'Persisted failed workflow required.'; end if;
  if e.status='failed' then return jsonb_build_object('experimentId',e.id,'status','failed','cached',true); end if;
  update public.product_experiments set status='failed',failure=left(coalesce(nullif(r.state->'failure'->>'message',''),(r.state->'failure')::text,'Research workflow failed'),1200),
    started_at=coalesce(e.started_at,r.started_at),completed_at=coalesce(r.completed_at,now()) where id=e.id;
  return jsonb_build_object('experimentId',e.id,'status','failed','cached',false);
end; $$;

create or replace function public.finalize_product_discovery(p_experiment_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.product_experiments%rowtype;
begin
  select * into e from public.product_experiments where id=p_experiment_id;
  if e.id is null or auth.uid() is null or not private.is_business_owner(e.business_id) then raise exception 'Business ownership required.' using errcode='42501'; end if;
  if e.discovery_version<>'pod-discovery-1.0' or e.parent_discovery_id is not null then raise exception 'Use the versioned v2 discovery finalization workflow.'; end if;
  return private.stage13_finalize(e.id);
end; $$;

create or replace function public.record_product_assessment(p_experiment_id uuid,p_dimensions jsonb,p_confirm_rights boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.product_experiments%rowtype; c public.product_candidates%rowtype; v_assessment jsonb; v_hash text; v_id uuid;
begin
  select * into e from public.product_experiments where id=p_experiment_id;
  if e.id is null or auth.uid() is null or not private.is_business_owner(e.business_id) then raise exception 'Business ownership required.' using errcode='42501'; end if;
  if e.discovery_version<>'pod-discovery-1.0' or e.parent_discovery_id is not null then raise exception 'Legacy scoring cannot rewrite an independent v2 qualitative review.'; end if;
  if p_confirm_rights is null or e.status<>'completed' or e.evidence_pack is null or p_dimensions is null or length(p_dimensions::text)>12000 then raise exception 'Completed research and explicit dimension assessments required.'; end if;
  select * into strict c from public.product_candidates where id=e.candidate_id and business_id=e.business_id;
  if p_confirm_rights then c.rights_status:='confirmed'; end if;
  v_assessment:=private.stage13_assessment(c,e.evidence_pack,p_dimensions);
  if p_confirm_rights then v_assessment:=v_assessment||'{"ownerRightsConfirmed":true}'::jsonb; end if;
  v_hash:=private.stage13_hash(v_assessment::text);
  select id into v_id from public.product_decisions where experiment_id=e.id and assessment_fingerprint=v_hash;
  if found then return jsonb_build_object('decisionId',v_id,'assessment',v_assessment,'cached',true); end if;
  if exists(select 1 from public.product_experiments newer where newer.business_id=c.business_id and newer.candidate_id=c.id and newer.discovery_version='pod-discovery-2.0') or
    exists(select 1 from public.artifacts dossier where dossier.business_id=c.business_id and dossier.artifact_type='product.discovery-dossier.v2' and
      (dossier.content->'shortlist') @> jsonb_build_array(jsonb_build_object('id',c.id))) then
    raise exception 'This candidate has versioned discovery history; use the bounded v2 workflow for new research or decisions.';
  end if;
  if private.stage13_validated_evidence(e.source_artifact_id,e.business_id,true) is distinct from e.evidence_pack then raise exception 'Stored evidence snapshot no longer matches provenance.'; end if;
  insert into public.product_decisions(business_id,candidate_id,experiment_id,assessment,assessment_fingerprint)
    values(e.business_id,c.id,e.id,v_assessment,v_hash) on conflict(experiment_id,assessment_fingerprint) do nothing returning id into v_id;
  if v_id is null then select id into strict v_id from public.product_decisions where experiment_id=e.id and assessment_fingerprint=v_hash;
    return jsonb_build_object('decisionId',v_id,'assessment',v_assessment,'cached',true); end if;
  insert into public.events(id,business_id,workflow_run_id,event_type,actor_type,actor_id,payload) values
    (private.stage4_deterministic_uuid('product:assessment-recorded:'||v_id),e.business_id,e.workflow_run_id,'product.assessment.recorded','owner',auth.uid()::text,
      jsonb_build_object('candidateId',c.id,'experimentId',e.id,'decisionId',v_id,'outcome',v_assessment->>'outcome','assessmentOrigin','owner_assessment','creativeProductionAllowed',false,'publicationAllowed',false));
  return jsonb_build_object('decisionId',v_id,'assessment',v_assessment,'cached',false);
end; $$;

create or replace function public.reconsider_product_candidate(p_candidate_id uuid,p_basis_artifact_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.product_candidates%rowtype; v_pack jsonb; a public.artifacts%rowtype; e public.product_experiments%rowtype; v_id uuid;
begin
  select * into c from public.product_candidates where id=p_candidate_id;
  if c.id is null or auth.uid() is null or not private.is_business_owner(c.business_id) then raise exception 'Business ownership required.' using errcode='42501'; end if;
  perform 1 from public.product_candidates where id=c.id for update;
  select * into e from public.product_experiments where candidate_id=c.id and basis_artifact_id=p_basis_artifact_id and discovery_version='pod-discovery-1.0' and parent_discovery_id is null;
  if found then return jsonb_build_object('experimentId',e.id,'cached',true); end if;
  if exists(select 1 from public.product_experiments newer where newer.business_id=c.business_id and newer.candidate_id=c.id and newer.discovery_version='pod-discovery-2.0') or
    exists(select 1 from public.artifacts dossier where dossier.business_id=c.business_id and dossier.artifact_type='product.discovery-dossier.v2' and
      (dossier.content->'shortlist') @> jsonb_build_array(jsonb_build_object('id',c.id))) then
    raise exception 'This candidate has versioned discovery history; use the bounded v2 workflow for new research or decisions.';
  end if;
  if not exists(select 1 from public.product_experiments where candidate_id=c.id and discovery_version='pod-discovery-1.0' and parent_discovery_id is null and status in ('completed','failed')) or
    exists(select 1 from public.product_experiments where candidate_id=c.id and status in ('reserved','researching')) then raise exception 'Finish the initial discovery before reconsideration.'; end if;
  v_pack:=private.stage13_validated_evidence(p_basis_artifact_id,c.business_id,true);
  select * into strict a from public.artifacts where id=p_basis_artifact_id and business_id=c.business_id;
  if exists(select 1 from public.product_experiments where candidate_id=c.id and source_artifact_id=a.id) then raise exception 'This research artifact was already used for this candidate.'; end if;
  if not exists(select 1 from jsonb_array_elements(v_pack->'sources') fresh where not exists(
    select 1 from public.product_experiments prior cross join lateral jsonb_array_elements(prior.evidence_pack->'sources') old_source
    where prior.candidate_id=c.id and old_source->>'contentHash'=fresh->>'contentHash') and not exists(
    select 1 from public.product_experiments prior join public.artifacts prior_sources on prior_sources.workflow_run_id=prior.workflow_run_id
      and prior_sources.business_id=prior.business_id and prior_sources.artifact_type='research.sources'
      cross join lateral jsonb_array_elements(prior_sources.content->'sources') old_source
    where prior.candidate_id=c.id and old_source->>'contentHash'=fresh->>'contentHash')) then
    raise exception 'Reconsideration requires never-before-seen source content, not a new URL or timestamp.'; end if;
  insert into public.product_experiments(business_id,candidate_id,workflow_run_id,fingerprint,hypothesis,variables,audience,status,measurement_plan,basis_artifact_id)
    values(c.business_id,c.id,a.workflow_run_id,private.stage13_hash(c.id||':basis:'||a.id),c.hypothesis,
      jsonb_build_object('concept',c.concept,'productType',c.product_type,'sourceDomains',c.source_domains,'originalDesign',c.original_design,'rightsStatus',c.rights_status,'reconsideration',true),
      c.audience,'reserved',private.stage13_plan(),a.id) returning id into v_id;
  perform private.stage13_finalize(v_id);
  return jsonb_build_object('experimentId',v_id,'cached',false);
end; $$;

create or replace function private.stage14_assert_approval(p_candidate_id uuid,p_snapshot jsonb) returns void language plpgsql stable set search_path='' as $$
declare c public.product_candidates%rowtype; d public.product_decisions%rowtype; e public.product_experiments%rowtype;
  spec jsonb:=p_snapshot->'printSpecification'; check_item jsonb; name text; dimension text; v_pack jsonb; v_assessment jsonb;
begin
  select * into strict c from public.product_candidates where id=p_candidate_id;
  if jsonb_typeof(p_snapshot) is distinct from 'object' or
    p_snapshot-array['approvalId','businessId','candidateId','decisionId','purpose','concept','audience','designInstructions','candidateAssessment','originalDesign','rightsStatement','rightsConfirmed','policyScreen','printSpecification','approvedBy','approvedAt','expiresAt','maximumMicrousd','maximumGenerations','publicationAllowed']<>'{}'::jsonb or
    p_snapshot->>'businessId' is distinct from c.business_id::text or p_snapshot->>'candidateId' is distinct from c.id::text or
    p_snapshot->>'concept' is distinct from c.concept or p_snapshot->>'audience' is distinct from c.audience or
    coalesce(p_snapshot->>'purpose','') not in ('candidate_production','technical_qualification','simulation') or
    p_snapshot->'originalDesign' is distinct from 'true'::jsonb or not c.original_design or
    coalesce(length(btrim(p_snapshot->>'designInstructions')),0) not between 50 and 1500 or
    p_snapshot->'rightsConfirmed' is distinct from 'true'::jsonb or coalesce(length(btrim(p_snapshot->>'rightsStatement')),0) not between 30 and 1500 or
    p_snapshot->>'approvedBy' is distinct from 'owner' or p_snapshot->'publicationAllowed' is distinct from 'false'::jsonb or
    coalesce(p_snapshot->'maximumGenerations','null'::jsonb) not in ('1'::jsonb,'2'::jsonb) or jsonb_typeof(p_snapshot->'maximumMicrousd') is distinct from 'number' or
    (p_snapshot->>'maximumMicrousd')::numeric<>trunc((p_snapshot->>'maximumMicrousd')::numeric) or (p_snapshot->>'maximumMicrousd')::numeric not between 0 and 2000000 or
    nullif(p_snapshot->>'approvedAt','') is null or (p_snapshot->>'approvedAt')::timestamptz>now()+interval '5 minutes' or
    nullif(p_snapshot->>'expiresAt','') is null or (p_snapshot->>'expiresAt')::timestamptz<=now() or
    (p_snapshot->>'expiresAt')::timestamptz>(p_snapshot->>'approvedAt')::timestamptz+interval '7 days' or
    (p_snapshot->>'purpose'='simulation' and (p_snapshot->>'maximumMicrousd')::bigint<>0) then
    raise exception 'Explicit, unexpired same-Business original-design approval required.';
  end if;
  if p_snapshot->>'purpose'='candidate_production' then
    select * into d from public.product_decisions where id=(p_snapshot->>'decisionId')::uuid and candidate_id=c.id and business_id=c.business_id;
    if d.id is null or d.assessment is distinct from p_snapshot->'candidateAssessment' or
      d.assessment->>'outcome' is distinct from 'TEST' or d.assessment->>'assessmentOrigin' is distinct from 'owner_assessment' or
      d.assessment->'missingEvidence' is distinct from '[]'::jsonb or coalesce((d.assessment->>'totalScore')::integer,0)<65 or
      exists(select 1 from public.product_decisions later where later.candidate_id=c.id and later.id<>d.id and later.created_at>=d.created_at) then
      raise exception 'Production requires the current persisted evidence-backed owner TEST decision.';
    end if;
    select * into strict e from public.product_experiments where id=d.experiment_id and candidate_id=c.id and business_id=c.business_id and status='completed';
    if e.discovery_version<>'pod-discovery-1.0' or e.parent_discovery_id is not null then raise exception 'This legacy production decision needs the matching versioned eligibility validator.'; end if;
    if exists(select 1 from public.product_experiments newer where newer.business_id=c.business_id and newer.candidate_id=c.id and newer.discovery_version='pod-discovery-2.0' and
      newer.parent_discovery_id is not null and newer.status='completed' and newer.created_at>=e.created_at) then
      raise exception 'Newer completed v2 discovery supersedes this legacy TEST, including an unselected candidate with no new verdict.';
    end if;
    v_pack:=private.stage13_validated_evidence(e.source_artifact_id,c.business_id,true);
    if d.assessment->'ownerRightsConfirmed'='true'::jsonb then c.rights_status:='confirmed'; end if;
    v_assessment:=private.stage13_assessment(c,v_pack,d.assessment->'dimensions');
    if d.assessment->'ownerRightsConfirmed'='true'::jsonb then v_assessment:=v_assessment||'{"ownerRightsConfirmed":true}'::jsonb; end if;
    if v_assessment is distinct from d.assessment then raise exception 'Production TEST evidence is stale or inconsistent.'; end if;
  elsif p_snapshot->'candidateAssessment' is distinct from 'null'::jsonb or p_snapshot->'decisionId' is distinct from 'null'::jsonb then
    raise exception 'Technical and simulation approvals cannot attach a fabricated research decision.';
  end if;
  if jsonb_typeof(p_snapshot->'policyScreen') is distinct from 'array' or jsonb_array_length(p_snapshot->'policyScreen')<>8 then raise exception 'Eight source-backed IP/policy screens required.'; end if;
  foreach name in array array['brand_names','trademarks','copyrighted_characters','sports_teams','logos','celebrity_likeness','copied_artwork','marketplace_policy'] loop
    if (select count(*) from jsonb_array_elements(p_snapshot->'policyScreen') x where x->>'category'=name)<>1 then raise exception 'Exactly one screen per category required.'; end if;
    select value into check_item from jsonb_array_elements(p_snapshot->'policyScreen') x where x->>'category'=name;
    if check_item->>'status' is distinct from 'clear' or coalesce(length(btrim(check_item->>'rationale')),0) not between 15 and 800 or
      jsonb_typeof(check_item->'sourceUrls') is distinct from 'array' or jsonb_array_length(check_item->'sourceUrls') not between 1 and 4 or
      exists(select 1 from jsonb_array_elements_text(check_item->'sourceUrls') u where u !~ '^https://[a-z][a-z0-9.-]+\.[a-z]{2,}(/[^[:space:]#]*)?$' or length(u)>1500 or u ~ '@') then
      raise exception 'Clear concept-specific source-linked IP/policy review required.'; end if;
  end loop;
  if jsonb_typeof(spec) is distinct from 'object' or spec->>'provider' is distinct from 'printful' or
    coalesce(spec->>'sourceUrl','') !~ '^https://(www\.)?printful\.com/[^[:space:]#]*$|^https://help\.printful\.com/[^[:space:]#]*$' or
    coalesce(length(btrim(spec->>'sourceExcerpt')),0) not between 30 and 1500 or nullif(spec->>'verifiedAt','') is null or
    (spec->>'verifiedAt')::timestamptz<now()-interval '30 days' or (spec->>'verifiedAt')::timestamptz>now()+interval '5 minutes' or
    spec->>'colorSpace' is distinct from 'srgb' or coalesce(spec->>'background','') not in ('transparent','opaque') or
    jsonb_typeof(spec->'maximumBytes') is distinct from 'number' or (spec->>'maximumBytes')::numeric<>trunc((spec->>'maximumBytes')::numeric) or
    (spec->>'maximumBytes')::integer not between 1024 and 7000000 or
    coalesce((spec->>'minimumDpi')::numeric,0) not between 150 and 300 then raise exception 'A fresh source-backed Printful specification is required.'; end if;
  foreach name in array array['product','garment','placement'] loop
    if coalesce(length(btrim(spec->>name)),0) not between 3 and 1000 then raise exception 'Invalid print product specification.'; end if;
  end loop;
  foreach dimension in array array['maximumWidthInches','maximumHeightInches','designWidthInches','designHeightInches'] loop
    if jsonb_typeof(spec->dimension) is distinct from 'number' or coalesce((spec->>dimension)::numeric,0)<=0 or (spec->>dimension)::numeric>24 then raise exception 'Invalid print dimensions.'; end if;
  end loop;
  if (spec->>'designWidthInches')::numeric>(spec->>'maximumWidthInches')::numeric or (spec->>'designHeightInches')::numeric>(spec->>'maximumHeightInches')::numeric then raise exception 'Placement exceeds print constraints.'; end if;
end; $$;
