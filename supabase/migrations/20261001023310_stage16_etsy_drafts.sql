-- Stage 16. No Etsy credentials, server key or activation are installed by this migration.
-- Owner session plus a server-held key is required for every secret/mutation RPC.
create table private.etsy_server_authority (
  key_hash text primary key check(key_hash ~ '^[a-f0-9]{64}$'),
  enabled boolean not null default true
);
create table private.etsy_oauth_requests (
  state_hash text primary key check(state_hash ~ '^[a-f0-9]{64}$'),
  business_id uuid not null references public.businesses(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  envelope text not null check(length(envelope) between 1 and 20000),
  expires_at timestamptz not null, consumed_at timestamptz
);
create table private.etsy_connections (
  id uuid primary key, business_id uuid not null unique references public.businesses(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  shop_id bigint not null unique check(shop_id>0), shop_name text not null,
  currency text not null check(currency in ('NZD','USD','AUD','GBP')),
  revision uuid not null, status text not null check(status in ('connected','revoked')),
  envelope text, refreshing boolean not null default false, connected_at timestamptz not null default now(), revoked_at timestamptz,
  unique(id,business_id), check(status<>'connected' or envelope is not null)
);
create table private.etsy_draft_runs (
  id uuid primary key, business_id uuid not null references public.businesses(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  connection_id uuid not null, connection_revision uuid not null,
  package_artifact_id uuid not null, package_hash text not null check(package_hash ~ '^[a-f0-9]{64}$'),
  package jsonb not null, identity text not null check(identity ~ '^al-[a-f0-9]{40}$'),
  shop_id bigint not null, product_identity text not null,
  state jsonb not null, action_intent_id uuid not null,
  approved_at timestamptz not null default now(), approval_expires_at timestamptz not null,
  stopped_at timestamptz, lease_hash text, lease_expires_at timestamptz,
  revision integer not null default 0,
  foreign key(connection_id,business_id) references private.etsy_connections(id,business_id) on delete restrict,
  foreign key(package_artifact_id,business_id) references public.artifacts(id,business_id) on delete restrict,
  foreign key(action_intent_id,business_id) references public.action_intents(id,business_id) on delete restrict,
  unique(business_id,shop_id,product_identity), unique(business_id,identity)
);
do $$ declare name text; begin
  foreach name in array array['etsy_server_authority','etsy_oauth_requests','etsy_connections','etsy_draft_runs'] loop
    execute format('alter table private.%I enable row level security',name);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',name);
  end loop;
end $$;

create function private.stage16_assert_package(p_business_id uuid,p_package jsonb) returns void
language plpgsql set search_path='' as $$
declare approval public.creative_approvals%rowtype; image jsonb; resource public.external_resources%rowtype;
begin
  if p_package->>'businessId' is distinct from p_business_id::text or p_package->>'version' is distinct from '1.0'
    or coalesce((p_package->>'expiresAt')::timestamptz, '-infinity')<=clock_timestamp()
    or (p_package->>'approvedAt')::timestamptz>clock_timestamp()
    or (p_package->>'expiresAt')::timestamptz>(p_package->>'approvedAt')::timestamptz+interval '1 day'
    then raise exception 'invalid_or_stale_package'; end if;
  if not exists(select 1 from public.goals where id=(p_package->>'goalId')::uuid and business_id=p_business_id and status='active')
    or not exists(select 1 from public.workflow_runs where id=(p_package->>'workflowRunId')::uuid and business_id=p_business_id and goal_id=(p_package->>'goalId')::uuid and status not in ('cancelled','failed','needs_owner','waiting'))
    then raise exception 'goal_or_workflow_stopped'; end if;
  select * into strict approval from public.creative_approvals where id=(p_package->>'creativeApprovalId')::uuid
    and business_id=p_business_id and candidate_id=(p_package->>'candidateId')::uuid and decision_id=(p_package->>'decisionId')::uuid
    and purpose='candidate_production' and expires_at>clock_timestamp();
  perform private.stage14_assert_approval(approval.candidate_id,approval.snapshot);
  if not exists(select 1 from public.creative_runs r join public.workflow_runs w on w.id=r.workflow_run_id and w.business_id=r.business_id
    where r.id=(p_package->>'creativeRunId')::uuid and r.business_id=p_business_id and r.approval_id=approval.id
    and w.status='completed' and w.state->'productionReady'='true'::jsonb) then raise exception 'production_asset_not_qualified'; end if;
  if jsonb_typeof(p_package->'images') is distinct from 'array' or jsonb_array_length(p_package->'images') not between 1 and 10 then raise exception 'reviewed_images_required'; end if;
  for image in select value from jsonb_array_elements(p_package->'images') loop
    if not exists(select 1 from public.creative_assets a join public.creative_reviews r on r.asset_id=a.id and r.business_id=a.business_id
      where a.id=(image->>'assetId')::uuid and a.business_id=p_business_id and a.creative_run_id=(p_package->>'creativeRunId')::uuid
      and a.approval_id=approval.id and a.asset_hash=image->>'sha256' and a.storage_path=image->>'storagePath'
      and a.inspection->'failedCriteria'='[]'::jsonb and r.asset_hash=a.asset_hash and r.review->>'outcome'='PASS'
      and not exists(select 1 from public.creative_assets newer where newer.creative_run_id=a.creative_run_id and newer.version>a.version))
      then raise exception 'asset_provenance_not_current'; end if;
  end loop;
  select * into strict resource from public.external_resources where id=(p_package->>'printfulResourceId')::uuid and business_id=p_business_id
    and provider='printful' and status='active';
  -- Stage 15's mapping-only and synthetic converters deliberately fail this gate.
  if resource.metadata->'configurationVerified' is distinct from 'true'::jsonb
    or resource.metadata->'assetBindingVerified' is distinct from 'true'::jsonb
    or resource.metadata->>'productFactsHash' is distinct from p_package->>'productFactsHash'
    or coalesce((resource.metadata->>'expiresAt')::timestamptz,'-infinity')<=clock_timestamp()
    or not exists(select 1 from public.action_receipts r join public.action_intents i on i.id=r.action_intent_id and i.business_id=r.business_id
      where r.id=(p_package->>'printfulReceiptId')::uuid and r.business_id=p_business_id and r.external_resource_id=resource.id
      and r.provider='printful' and r.outcome='succeeded' and i.action_type='printful.product.configure' and i.status='completed'
      and r.response_summary->'configurationVerified'='true'::jsonb and r.response_summary->'assetBindingVerified'='true'::jsonb
      and r.response_summary->>'productFactsHash'=p_package->>'productFactsHash') then raise exception 'verified_printful_product_required'; end if;
end $$;
revoke all on function private.stage16_assert_package(uuid,jsonb) from public,anon,authenticated,service_role;

create function public.etsy_owner_transition(p_business_id uuid,p_operation text,p_payload jsonb default '{}'::jsonb,p_server_key text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare connection private.etsy_connections%rowtype; request private.etsy_oauth_requests%rowtype; run private.etsy_draft_runs%rowtype;
  v_state jsonb; v_package jsonb; v_id uuid; v_intent uuid; v_resource uuid; v_receipt uuid; v_lease text; prior jsonb; next_op jsonb;
begin
  if not private.is_business_owner(p_business_id) then raise exception 'owner_required' using errcode='42501'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>200000 then raise exception 'invalid_request'; end if;
  if p_operation='workspace' then
    return jsonb_build_object('connection',(select jsonb_build_object('id',id,'shopName',shop_name,'shopId',shop_id,'status',status,'currency',currency) from private.etsy_connections where business_id=p_business_id),
      'runs',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'title',x.package->>'title','status',x.state->>'status','reason',x.state->>'reason','listingId',x.state->'listingId','approvedAt',x.approved_at,'stopped',x.stopped_at is not null) order by x.approved_at desc) from (select * from private.etsy_draft_runs where business_id=p_business_id order by approved_at desc limit 50) x),'[]'::jsonb));
  end if;
  if length(p_server_key)<32 or not exists(select 1 from private.etsy_server_authority where key_hash=private.stage13_hash(p_server_key) and enabled)
    then raise exception 'server_authority_required' using errcode='42501'; end if;
  -- Serializes connection begin/consume/revoke and new product identities for one Business.
  perform 1 from public.businesses where id=p_business_id for update;
  select * into connection from private.etsy_connections where business_id=p_business_id for update;
  if p_operation='oauth_begin' then
    update private.etsy_oauth_requests set consumed_at=clock_timestamp() where business_id=p_business_id and consumed_at is null;
    insert into private.etsy_oauth_requests(state_hash,business_id,owner_id,envelope,expires_at)
      values(p_payload->>'stateHash',p_business_id,auth.uid(),p_payload->>'envelope',clock_timestamp()+interval '10 minutes');
    return '{}'::jsonb;
  elsif p_operation='oauth_consume' then
    select * into strict request from private.etsy_oauth_requests where state_hash=p_payload->>'stateHash' and business_id=p_business_id and owner_id=auth.uid()
      and expires_at>clock_timestamp() and consumed_at is null for update;
    update private.etsy_oauth_requests set consumed_at=clock_timestamp() where state_hash=request.state_hash;
    return jsonb_build_object('envelope',request.envelope);
  elsif p_operation='connect' then
    -- The server consumed this exact request and verified OAuth/shop ownership.
    select * into strict request from private.etsy_oauth_requests where state_hash=p_payload->>'stateHash' and business_id=p_business_id
      and owner_id=auth.uid() and expires_at>clock_timestamp() and consumed_at is not null for update;
    if connection.id is not null and connection.shop_id<>(p_payload->>'shopId')::bigint then raise exception 'shop_reassignment_denied'; end if;
    insert into private.etsy_connections(id,business_id,owner_id,shop_id,shop_name,currency,revision,status,envelope)
      values((p_payload->>'id')::uuid,p_business_id,auth.uid(),(p_payload->>'shopId')::bigint,p_payload->>'shopName',p_payload->>'currency',(p_payload->>'revision')::uuid,'connected',p_payload->>'envelope')
      on conflict(business_id) do update set envelope=excluded.envelope,revision=excluded.revision,status='connected',revoked_at=null,owner_id=excluded.owner_id,refreshing=false;
    delete from private.etsy_oauth_requests where state_hash=request.state_hash;
    return '{}'::jsonb;
  elsif p_operation='disconnect' then
    update private.etsy_connections set status='revoked',envelope=null,revoked_at=clock_timestamp(),revision=gen_random_uuid() where business_id=p_business_id;
    update private.etsy_oauth_requests set consumed_at=clock_timestamp() where business_id=p_business_id and consumed_at is null;
    update private.etsy_draft_runs set stopped_at=clock_timestamp(),state=jsonb_set(state,'{status}','"cancelled"') where business_id=p_business_id and state->>'status'<>'verified';
    return '{}'::jsonb;
  elsif p_operation='connection' then
    if connection.status is distinct from 'connected' or connection.owner_id is distinct from auth.uid() then raise exception 'account_access_revoked'; end if;
    return jsonb_build_object('id',connection.id,'revision',connection.revision,'shopId',connection.shop_id,'currency',connection.currency,'envelope',connection.envelope);
  elsif p_operation='refresh_begin' then
    if connection.status is distinct from 'connected' or connection.revision is distinct from (p_payload->>'revision')::uuid or connection.refreshing then raise exception 'account_reconnection_required'; end if;
    update private.etsy_connections set refreshing=true where id=connection.id;
    return '{}'::jsonb;
  elsif p_operation='refresh' then
    if connection.status is distinct from 'connected' or connection.revision is distinct from (p_payload->>'revision')::uuid then raise exception 'account_access_revoked'; end if;
    if not connection.refreshing then raise exception 'refresh_not_reserved'; end if;
    update private.etsy_connections set envelope=p_payload->>'envelope',refreshing=false where id=connection.id;
    return '{}'::jsonb;
  elsif p_operation='validate_package' then
    perform private.stage16_assert_package(p_business_id,p_payload->'package'); return '{}'::jsonb;
  elsif p_operation='prepare' then
    v_package:=p_payload->'package'; perform private.stage16_assert_package(p_business_id,v_package);
    if connection.status is distinct from 'connected' or connection.revision is distinct from (p_payload->>'connectionRevision')::uuid or connection.currency is distinct from v_package->>'currency' then raise exception 'account_access_revoked'; end if;
    if p_payload->'approveDraft' is distinct from 'true'::jsonb or p_payload->'approveAssetSharing' is distinct from 'true'::jsonb then raise exception 'draft_and_asset_sharing_approval_required'; end if;
    if not exists(select 1 from public.artifacts where id=(v_package->>'id')::uuid and business_id=p_business_id and artifact_type='product.package.v1' and content->>'etsyDraftEnvelope'=p_payload->>'packageEnvelope') then raise exception 'approved_package_required'; end if;
    select * into run from private.etsy_draft_runs where business_id=p_business_id and shop_id=connection.shop_id and product_identity=v_package->>'productIdentity';
    if run.id is not null then
      if run.package_hash is distinct from p_payload->>'packageHash' then raise exception 'existing_product_draft_requires_reconciliation'; end if;
      return jsonb_build_object('runId',run.id,'created',false);
    end if;
    v_id:=gen_random_uuid(); v_intent:=gen_random_uuid(); v_resource:=gen_random_uuid(); v_receipt:=gen_random_uuid();
    v_state:=jsonb_build_object('id',v_id,'businessId',p_business_id,'connectionId',connection.id,'connectionRevision',connection.revision,'shopId',connection.shop_id,
      'actionIntentId',v_intent,'resourceId',v_resource,'receiptId',v_receipt,'packageHash',p_payload->>'packageHash','identity',p_payload->>'identity',
      'listingId',null,'operations','[]'::jsonb,'status','ready','reason',null);
    insert into public.action_intents(id,business_id,workflow_run_id,action_type,capability,status,request,risk,financial_impact,idempotency_key,created_by_type,created_by_id)
      values(v_intent,p_business_id,(v_package->>'workflowRunId')::uuid,'etsy.draft.create','marketplace.etsy','approved',
        jsonb_build_object('packageHash',p_payload->>'packageHash','identity',p_payload->>'identity','connectionId',connection.id,'shopId',connection.shop_id,'publicationAllowed',false),
        '{"scope":"draft_only","assetSharingApproved":true}', '{"paidActionsAllowed":false}',p_payload->>'identity','owner',auth.uid()::text);
    insert into private.etsy_draft_runs(id,business_id,owner_id,connection_id,connection_revision,package_artifact_id,package_hash,package,identity,shop_id,product_identity,state,action_intent_id,approval_expires_at)
      values(v_id,p_business_id,auth.uid(),connection.id,connection.revision,(v_package->>'id')::uuid,p_payload->>'packageHash',v_package,p_payload->>'identity',connection.shop_id,v_package->>'productIdentity',v_state,v_intent,least((v_package->>'expiresAt')::timestamptz,clock_timestamp()+interval '1 hour'));
    return jsonb_build_object('runId',v_id,'created',true);
  end if;
  select * into strict run from private.etsy_draft_runs where id=(p_payload->>'runId')::uuid and business_id=p_business_id and owner_id=auth.uid() for update;
  if p_operation='cancel' then
    if run.state->>'status'='verified' then return '{}'::jsonb; end if;
    update private.etsy_draft_runs set stopped_at=clock_timestamp(),state=jsonb_set(state,'{status}','"cancelled"') where id=run.id;
    update public.action_intents set status='expired' where id=run.action_intent_id;
    return '{}'::jsonb;
  elsif p_operation='acquire' then
    if run.lease_expires_at>clock_timestamp() then raise exception 'draft_in_progress'; end if;
    if coalesce(length(p_payload->>'lease'),0)<32 then raise exception 'invalid_lease'; end if;
    update private.etsy_draft_runs set lease_hash=private.stage13_hash(p_payload->>'lease'),lease_expires_at=clock_timestamp()+interval '10 minutes' where id=run.id;
    return jsonb_build_object('state',run.state,'revision',run.revision);
  end if;
  if run.lease_hash is distinct from private.stage13_hash(p_payload->>'lease') or coalesce(run.lease_expires_at,'-infinity')<=clock_timestamp() then raise exception 'lease_expired'; end if;
  if p_operation='release' then
    update private.etsy_draft_runs set lease_hash=null,lease_expires_at=null where id=run.id; return '{}'::jsonb;
  elsif p_operation='guard' then
    if run.stopped_at is not null or run.approval_expires_at<=clock_timestamp() then raise exception 'draft_stopped_or_approval_expired'; end if;
    if connection.status is distinct from 'connected' or connection.revision is distinct from run.connection_revision then raise exception 'account_access_revoked'; end if;
    perform private.stage16_assert_package(p_business_id,run.package);
    return jsonb_build_object('package',run.package);
  elsif p_operation in ('save','finish') then
    if (p_payload->>'revision')::integer is distinct from run.revision then raise exception 'stale_draft_revision'; end if;
    v_state:=p_payload->'state';
    if v_state-array['listingId','operations','status','reason'] is distinct from run.state-array['listingId','operations','status','reason']
      or (run.state->>'listingId' is not null and v_state->'listingId' is distinct from run.state->'listingId')
      or jsonb_typeof(v_state->'operations') is distinct from 'array' or jsonb_array_length(v_state->'operations')>41
      then raise exception 'immutable_draft_identity'; end if;
    for prior in select value from jsonb_array_elements(run.state->'operations') loop
      select value into next_op from jsonb_array_elements(v_state->'operations') where value->>'key'=prior->>'key';
      if next_op is null or (prior->>'externalId' is not null and next_op->'externalId' is distinct from prior->'externalId')
        or (prior->>'status'='verified' and next_op->>'status' is distinct from 'verified') then raise exception 'write_history_cannot_be_reset'; end if;
    end loop;
    if (select count(*)<>count(distinct value->>'key') from jsonb_array_elements(v_state->'operations')) then raise exception 'duplicate_operation'; end if;
    if run.stopped_at is not null then v_state:=jsonb_set(v_state,'{status}','"cancelled"'); end if;
    if run.state->>'status'='verified' and v_state is distinct from run.state then raise exception 'verified_draft_immutable'; end if;
    if v_state->>'listingId' is not null then
      insert into public.external_resources(id,business_id,provider,resource_type,external_id,status,canonical_url,metadata)
        values((run.state->>'resourceId')::uuid,p_business_id,'etsy','draft_listing','shop:'||run.shop_id||':listing:'||(v_state->>'listingId'),'pending',
          'https://www.etsy.com/your/shops/me/listing-editor/edit/'||(v_state->>'listingId'),
          jsonb_build_object('shopId',run.shop_id,'listingId',v_state->'listingId','packageHash',run.package_hash,'verified',false,'publicationAllowed',false))
        on conflict(id) do nothing;
    end if;
    if p_operation='finish' then
      if run.stopped_at is not null or run.approval_expires_at<=clock_timestamp() or connection.status is distinct from 'connected' or connection.revision is distinct from run.connection_revision then raise exception 'draft_stopped_or_access_revoked'; end if;
      perform private.stage16_assert_package(p_business_id,run.package);
      if v_state->>'status' is distinct from 'verified' or v_state->>'listingId' is null or exists(select 1 from jsonb_array_elements(v_state->'operations') where value->>'status' is distinct from 'verified') then raise exception 'readback_required'; end if;
      if p_payload->'receipt'->>'provider' is distinct from 'etsy' or p_payload->'receipt'->>'outcome' is distinct from 'succeeded'
        or p_payload->'receipt'->>'actionIntentId' is distinct from run.action_intent_id::text
        or p_payload->'receipt'->'responseSummary'->>'verifiedBy' is distinct from 'independent_get'
        or p_payload->'receipt'->'responseSummary'->>'state' is distinct from 'draft'
        or p_payload->'receipt'->'responseSummary'->'publicationAllowed' is distinct from 'false'::jsonb then raise exception 'invalid_receipt'; end if;
      insert into public.external_resources(id,business_id,provider,resource_type,external_id,status,canonical_url,metadata)
        values((run.state->>'resourceId')::uuid,p_business_id,'etsy','draft_listing','shop:'||run.shop_id||':listing:'||(v_state->>'listingId'),'active',
          'https://www.etsy.com/your/shops/me/listing-editor/edit/'||(v_state->>'listingId'),p_payload->'resource'->'metadata')
        on conflict(id) do update set status='active',metadata=excluded.metadata;
      insert into public.action_receipts(id,business_id,action_intent_id,external_resource_id,attempt,outcome,provider,request_fingerprint,response_summary)
        values((run.state->>'receiptId')::uuid,p_business_id,run.action_intent_id,(run.state->>'resourceId')::uuid,
          (select coalesce(max(attempt),0)+1 from public.action_receipts where action_intent_id=run.action_intent_id),'succeeded','etsy',run.package_hash,p_payload->'receipt'->'responseSummary');
      update public.action_intents set status='completed' where id=run.action_intent_id;
      update public.owner_interventions set status='resolved',resolved_at=clock_timestamp(),resolution='{"result":"draft_verified"}' where action_intent_id=run.action_intent_id and status='open';
      insert into public.events(business_id,workflow_run_id,event_type,actor_type,payload) values(p_business_id,(run.package->>'workflowRunId')::uuid,'etsy.draft.verified','system',jsonb_build_object('listingId',v_state->'listingId','publicationAllowed',false));
    elsif v_state->>'status'='needs_owner' then
      if v_state is distinct from run.state then
        insert into public.action_receipts(business_id,action_intent_id,external_resource_id,attempt,outcome,provider,request_fingerprint,response_summary)
          values(p_business_id,run.action_intent_id,case when v_state->>'listingId' is not null then (run.state->>'resourceId')::uuid else null end,
            (select coalesce(max(attempt),0)+1 from public.action_receipts where action_intent_id=run.action_intent_id),'uncertain','etsy',run.package_hash,
            jsonb_build_object('listingId',v_state->'listingId','reason',v_state->'reason','verified',false,'publicationAllowed',false));
      end if;
      if not exists(select 1 from public.owner_interventions where action_intent_id=run.action_intent_id and status='open') then
        insert into public.owner_interventions(business_id,action_intent_id,intervention_type,status,title,description,options)
          values(p_business_id,run.action_intent_id,'etsy.draft.reconcile','open','Etsy draft needs verification','A result could not be verified. Check the saved draft before continuing. No automatic repeat or publication is permitted.','[]');
      end if;
      insert into public.events(business_id,event_type,actor_type,payload) values(p_business_id,'etsy.draft.uncertain','system',jsonb_build_object('runId',run.id,'listingId',v_state->'listingId','reason',v_state->'reason'));
    end if;
    update private.etsy_draft_runs set state=v_state,revision=revision+1 where id=run.id;
    return jsonb_build_object('revision',run.revision+1,'state',v_state);
  end if;
  raise exception 'unknown_etsy_operation';
end $$;
revoke all on function public.etsy_owner_transition(uuid,text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.etsy_owner_transition(uuid,text,jsonb,text) to authenticated;

-- Block generic owner CRUD from rewriting Stage16 Core evidence or identities.
create function private.stage16_core_guard() returns trigger language plpgsql set search_path='' as $$
declare a jsonb; b jsonb;
begin
  if tg_op<>'INSERT' then a:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then b:=to_jsonb(new); end if;
  if current_user in ('anon','authenticated','service_role') and (
    a->>'provider'='etsy' or b->>'provider'='etsy' or a->>'action_type' like 'etsy.%' or b->>'action_type' like 'etsy.%'
    or a->>'event_type' like 'etsy.%' or b->>'event_type' like 'etsy.%'
    or a->>'intervention_type' like 'etsy.%' or b->>'intervention_type' like 'etsy.%')
    then raise exception 'etsy_state_is_server_managed' using errcode='42501'; end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
revoke all on function private.stage16_core_guard() from public,anon,authenticated,service_role;
do $$ declare name text; begin
  foreach name in array array['external_resources','action_intents','action_receipts','events','owner_interventions'] loop
    execute format('create trigger %I before insert or update or delete on public.%I for each row execute function private.stage16_core_guard()','stage16_'||name||'_guard',name);
  end loop;
end $$;

alter table public.pack_capability_definitions drop constraint pack_capability_definitions_adapter_check;
alter table public.pack_capability_definitions add constraint pack_capability_definitions_adapter_check check(adapter in ('structured.mapping','web.research','image.generate','printful.foundation','etsy.drafts'));
select private.stage10_register_pack('{"frameworkVersion":"1.0","packKey":"capability.etsy","version":"1.0.0","name":"Etsy Drafts","kind":"capability","description":"Experimental API-first draft preparation with owner account authorization, durable write claims and readback receipts. Live qualification remains open.","dependencies":[],"ui":{"category":"Commerce","summary":"Approved products become verified drafts. No publication, orders or paid actions.","supportedBusinessTypes":["etsy-pod"]},"evals":["owner-isolation","oauth-pkce","package-freshness","duplicate-prevention","uncertain-writes","partial-images","cancellation","readback","draft-only","live-draft"],"capabilities":[{"key":"marketplace.etsy","adapter":"etsy.drafts","description":"Dedicated server-only Etsy draft adapter. Installing the pack does not connect an account or grant generic workers execution access."}],"knowledge":[],"workers":[],"workflows":[]}'::jsonb);
