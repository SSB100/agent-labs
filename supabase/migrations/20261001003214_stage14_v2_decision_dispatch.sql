-- OFFLINE DRAFT: minimal Stage14 persisted-decision version dispatch.
-- Replaces one existing fully private helper only; no new public endpoint, grant,
-- model route, pack qualification, spending scope or publication authority.
-- The native-PNG approval and runtime functions retain their exact contracts and
-- invoke this helper both before production and at terminal eligibility recheck.

create or replace function private.stage14_assert_approval(p_candidate_id uuid,p_snapshot jsonb) returns void language plpgsql stable set search_path='' as $$
declare c public.product_candidates%rowtype; d public.product_decisions%rowtype; e public.product_experiments%rowtype;
  root_e public.product_experiments%rowtype; terminal jsonb; reviewed_test jsonb;
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
    if d.id is null or d.assessment is distinct from p_snapshot->'candidateAssessment' or d.assessment->>'outcome' is distinct from 'TEST' or
      exists(select 1 from public.product_decisions later where later.candidate_id=c.id and later.business_id=c.business_id and later.id<>d.id and later.created_at>=d.created_at) then
      raise exception 'Production requires the current exact persisted TEST decision.';
    end if;
    select * into strict e from public.product_experiments where id=d.experiment_id and candidate_id=c.id and business_id=c.business_id and status='completed';
    if exists(select 1 from public.product_experiments newer where newer.business_id=c.business_id and newer.candidate_id=c.id and newer.discovery_version='pod-discovery-2.0' and
      newer.parent_discovery_id is not null and newer.status='completed' and newer.id<>e.id and newer.created_at>=e.created_at) then
      raise exception 'Newer completed v2 discovery supersedes this TEST, including an unselected candidate with no new verdict.';
    end if;
    if e.discovery_version='pod-discovery-1.0' and e.parent_discovery_id is null then
      -- Preserve the complete legacy owner-assessment gate and provenance path.
      if d.assessment->>'assessmentOrigin' is distinct from 'owner_assessment' or d.assessment->'missingEvidence' is distinct from '[]'::jsonb or
        coalesce((d.assessment->>'totalScore')::integer,0)<65 then raise exception 'Production requires the current persisted evidence-backed owner TEST decision.'; end if;
      v_pack:=private.stage13_validated_evidence(e.source_artifact_id,c.business_id,true);
      if d.assessment->'ownerRightsConfirmed'='true'::jsonb then c.rights_status:='confirmed'; end if;
      v_assessment:=private.stage13_assessment(c,v_pack,d.assessment->'dimensions');
      if d.assessment->'ownerRightsConfirmed'='true'::jsonb then v_assessment:=v_assessment||'{"ownerRightsConfirmed":true}'::jsonb; end if;
      if v_assessment is distinct from d.assessment then raise exception 'Production TEST evidence is stale or inconsistent.'; end if;
    elsif e.discovery_version='pod-discovery-2.0' and e.parent_discovery_id is not null then
      select * into strict root_e from public.product_experiments where id=e.parent_discovery_id and business_id=c.business_id and discovery_version='pod-discovery-2.0' and
        parent_discovery_id is null and candidate_id is null and workflow_run_id=e.workflow_run_id and status='completed';
      terminal:=private.stage13v2_validate_persisted(root_e.id,true);
      reviewed_test:=terminal->'strategy'->'testPlan';
      if terminal->'decisionValidated' is distinct from 'true'::jsonb or terminal->>'validationLevel' is distinct from 'terminal_recommendation' or
        terminal->>'businessId' is distinct from c.business_id::text or terminal->>'intentId' is distinct from root_e.id::text or terminal->>'outcome' is distinct from 'TEST' or
        terminal->>'selectedCandidateId' is distinct from c.id::text or terminal->'review' is distinct from d.assessment or d.assessment->>'version' is distinct from 'pod-discovery-2.0' or
        d.assessment->>'candidateId' is distinct from c.id::text or d.assessment->>'intentId' is distinct from root_e.id::text or
        e.source_artifact_id is distinct from root_e.source_artifact_id or e.evidence_pack is distinct from root_e.evidence_pack or
        e.measurement_plan is distinct from jsonb_build_object('version','pod-discovery-2.0','testPlan',reviewed_test) or
        jsonb_typeof(reviewed_test) is distinct from 'object' or reviewed_test->>'budgetStatus' is distinct from 'proposal_only' or
        reviewed_test->'generationAuthorized' is distinct from 'false'::jsonb or reviewed_test->'spendingAuthorized' is distinct from 'false'::jsonb or
        (p_snapshot->>'maximumGenerations')::integer>(reviewed_test->>'maximumGenerations')::integer then
        raise exception 'Production needs the exact selected, completed, independently reviewed v2 TEST and its image-count limit.';
      end if;
      -- The terminal validator reconstructs all fresh source spans, actual Luna /
      -- Haiku receipts, nine dimensions, hard gates and blocking uncertainty.
      -- Its proposed test cost grants nothing: this approval retains its separate
      -- explicit owner cap and the existing fresh provider-bound creative quote.
    else raise exception 'Unsupported persisted discovery version or production experiment identity.';
    end if;
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
