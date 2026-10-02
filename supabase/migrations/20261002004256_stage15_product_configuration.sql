-- Stage15 bounded single-product persistence. OFFLINE / NOT LIVE QUALIFIED.
-- Additive only: no credentials, source evidence, access grants or enabled keys.
-- No source-registration RPC is installed. Existing catalog.read authority is
-- unchanged. Product GET cannot prove physical placement or technique, so this
-- slice can persist only an uncertain receipt and a pending external resource.

create table private.printful_product_server_authority (
 key_hash text primary key check(key_hash ~ '^[a-f0-9]{64}$'), enabled boolean not null default false
);
create table private.printful_product_write_authorities (
 id uuid primary key, business_id uuid not null, owner_id uuid not null references auth.users(id) on delete restrict,
 connection_id uuid not null, connection_revision uuid not null, store_id bigint not null check(store_id>0),
 scopes jsonb not null check(scopes='["product.configure"]'::jsonb),
 provider_scopes jsonb not null check(jsonb_typeof(provider_scopes)='array' and jsonb_array_length(provider_scopes) between 3 and 6
  and provider_scopes <@ '["sync_products","sync_products/read","sync_products/write","file_library/read","stores_list","stores_list/read"]'::jsonb
  and (provider_scopes ? 'sync_products' or provider_scopes ?& array['sync_products/read','sync_products/write'])
  and provider_scopes ? 'file_library/read' and (provider_scopes ? 'stores_list/read' or provider_scopes ? 'stores_list')),
 credential_envelope text not null check(length(credential_envelope) between 32 and 20000),
 enabled boolean not null default false, expires_at timestamptz not null,
 foreign key(connection_id,business_id) references private.connected_accounts(id,business_id) on delete restrict,
 unique(connection_id,connection_revision)
);
create table private.printful_product_sources (
 id uuid primary key, business_id uuid not null references public.businesses(id) on delete restrict,
 owner_id uuid not null references auth.users(id) on delete restrict,
 connection_id uuid not null, connection_revision uuid not null, store_id bigint not null check(store_id>0),
 source jsonb not null check(jsonb_typeof(source)='object'), source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),
 imported_at timestamptz not null default clock_timestamp(),
 foreign key(connection_id,business_id) references private.connected_accounts(id,business_id) on delete restrict,
 unique(id,business_id)
);
create table private.printful_product_runs (
 id uuid primary key, business_id uuid not null references public.businesses(id) on delete restrict,
 owner_id uuid not null references auth.users(id) on delete restrict, source_id uuid not null unique,
 source jsonb not null, source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),
 connection_id uuid not null, connection_revision uuid not null, store_id bigint not null check(store_id>0),
 identity text not null check(identity ~ '^al-pf-[a-f0-9]{32}$'),
 request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'), approval jsonb not null,
 approval_hash text not null check(approval_hash ~ '^[a-f0-9]{64}$'),
 action_intent_id uuid not null unique, resource_id uuid not null unique, receipt_id uuid not null unique,
 state jsonb not null, revision integer not null default 0 check(revision>=0),
 approved_at timestamptz not null, approval_expires_at timestamptz not null,
 stopped_at timestamptz, lease_hash text, lease_expires_at timestamptz, lease_generation uuid,
 foreign key(source_id,business_id) references private.printful_product_sources(id,business_id) on delete restrict,
 foreign key(connection_id,business_id) references private.connected_accounts(id,business_id) on delete restrict,
 foreign key(action_intent_id,business_id) references public.action_intents(id,business_id) on delete restrict,
 unique(business_id,identity), unique(id,business_id)
);
create table private.printful_product_operations (
 run_id uuid primary key, business_id uuid not null,
 request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'), sent_at timestamptz not null, marker jsonb not null, dispatch_lease_generation uuid not null,
 foreign key(run_id,business_id) references private.printful_product_runs(id,business_id) on delete restrict
);
create table private.printful_product_mutation_admissions (transaction_id bigint primary key);
do $$ declare n text; begin
 foreach n in array array['printful_product_server_authority','printful_product_write_authorities','printful_product_sources','printful_product_runs','printful_product_operations','printful_product_mutation_admissions'] loop
  execute format('alter table private.%I enable row level security',n);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role',n);
 end loop;
end $$;

create function private.stage15_product_admitted() returns boolean language sql stable set search_path='' as $$
 select current_user not in ('anon','authenticated','service_role') and exists(select 1 from private.printful_product_mutation_admissions where transaction_id=txid_current());
$$;
create function private.stage15_product_record_guard() returns trigger language plpgsql set search_path='' as $$
begin
 -- Only separately reviewed administrative provisioning can import evidence.
 -- None of this migration's owner/server operations can insert a source.
 if tg_table_name='printful_product_sources' then
  if tg_op<>'INSERT' then raise exception 'product_source_immutable'; end if;
  if current_user in ('anon','authenticated','service_role') then raise exception 'product_source_authority_required' using errcode='42501'; end if;
 else
  if not private.stage15_product_admitted() then raise exception 'product_runtime_managed' using errcode='42501'; end if;
  if tg_op='DELETE' or (tg_table_name='printful_product_operations' and tg_op<>'INSERT') then raise exception 'product_history_immutable'; end if;
  if tg_table_name='printful_product_runs' and tg_op='UPDATE' then
   if to_jsonb(new)-array['state','revision','stopped_at','lease_hash','lease_expires_at','lease_generation'] is distinct from to_jsonb(old)-array['state','revision','stopped_at','lease_hash','lease_expires_at','lease_generation'] then raise exception 'product_identity_immutable'; end if;
   if old.stopped_at is not null and new.stopped_at is distinct from old.stopped_at then raise exception 'product_stop_immutable'; end if;
  end if;
 end if;
 return new;
end $$;
create trigger printful_product_sources_guard before insert or update or delete on private.printful_product_sources for each row execute function private.stage15_product_record_guard();
create trigger printful_product_runs_guard before insert or update or delete on private.printful_product_runs for each row execute function private.stage15_product_record_guard();
create trigger printful_product_operations_guard before insert or update or delete on private.printful_product_operations for each row execute function private.stage15_product_record_guard();

-- Semantic and identity fences also cover old generic SECURITY DEFINER writers.
-- Existing Core ACLs and records are untouched; no broad table grant is added.
-- Narrow owner-scoped boolean lookup preserves unrelated invoker Core writes
-- without granting access to private records or changing trigger current_user.
create function private.stage15_product_core_identity(p_business uuid,p_table text,p_row jsonb) returns boolean language sql stable security definer set search_path='' as $$
 select private.is_business_owner(p_business) and exists(select 1 from private.printful_product_runs r where r.business_id=p_business and
  case p_table
   when 'action_intents' then r.action_intent_id=(p_row->>'id')::uuid
   when 'action_receipts' then r.action_intent_id=(p_row->>'action_intent_id')::uuid or r.receipt_id=(p_row->>'id')::uuid or r.resource_id=(p_row->>'external_resource_id')::uuid
   when 'external_resources' then r.resource_id=(p_row->>'id')::uuid
   when 'owner_interventions' then r.action_intent_id=(p_row->>'action_intent_id')::uuid
   else false end);
$$;
revoke all on function private.stage15_product_core_identity(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.stage15_product_core_identity(uuid,text,jsonb) to authenticated,service_role;

create function private.stage15_product_core_guard() returns trigger language plpgsql set search_path='' as $$
declare a jsonb; b jsonb; protected boolean:=false;
begin
 if tg_op<>'INSERT' then a:=to_jsonb(old); end if;
 if tg_op<>'DELETE' then b:=to_jsonb(new); end if;
 if tg_table_name='action_intents' then
  protected:=a->>'action_type'='printful.product.configure' or b->>'action_type'='printful.product.configure'
   or private.stage15_product_core_identity((a->>'business_id')::uuid,tg_table_name,a) or private.stage15_product_core_identity((b->>'business_id')::uuid,tg_table_name,b);
 elsif tg_table_name='action_receipts' then
  protected:=a->'response_summary' ? 'configurationRunId' or b->'response_summary' ? 'configurationRunId' or a->'response_summary'->>'configurationMode'='manual_api_product' or b->'response_summary'->>'configurationMode'='manual_api_product'
   or (a->>'provider'='printful' and a->'response_summary'->'configurationVerified'='true'::jsonb)
   or (b->>'provider'='printful' and b->'response_summary'->'configurationVerified'='true'::jsonb)
   or private.stage15_product_core_identity((a->>'business_id')::uuid,tg_table_name,a) or private.stage15_product_core_identity((b->>'business_id')::uuid,tg_table_name,b);
 elsif tg_table_name='external_resources' then
  protected:=(a->>'provider'='printful' and (a->>'resource_type'='product_configuration_observation' or a->'metadata'->>'configurationMode'='manual_api_product' or a->'metadata'->'configurationVerified'='true'::jsonb))
   or (b->>'provider'='printful' and (b->>'resource_type'='product_configuration_observation' or b->'metadata'->>'configurationMode'='manual_api_product' or b->'metadata'->'configurationVerified'='true'::jsonb))
   or private.stage15_product_core_identity((a->>'business_id')::uuid,tg_table_name,a) or private.stage15_product_core_identity((b->>'business_id')::uuid,tg_table_name,b);
 elsif tg_table_name='events' then
  protected:=coalesce(a->>'event_type','') like 'printful.product.%' or coalesce(b->>'event_type','') like 'printful.product.%';
 elsif tg_table_name='owner_interventions' then
  protected:=coalesce(a->>'intervention_type','') like 'printful.product.%' or coalesce(b->>'intervention_type','') like 'printful.product.%'
   or private.stage15_product_core_identity((a->>'business_id')::uuid,tg_table_name,a) or private.stage15_product_core_identity((b->>'business_id')::uuid,tg_table_name,b);
 end if;
 if protected then
  if not private.stage15_product_admitted() then raise exception 'product_core_runtime_managed' using errcode='42501'; end if;
  if tg_op='DELETE' or (tg_table_name in ('action_receipts','external_resources','events') and tg_op<>'INSERT') then raise exception 'product_core_provenance_immutable'; end if;
  if tg_table_name='action_intents' and tg_op='UPDATE' and a-array['status','updated_at'] is distinct from b-array['status','updated_at'] then raise exception 'product_intent_immutable'; end if;
  if tg_table_name='owner_interventions' then
   if tg_op='INSERT' and (b->>'intervention_type' is distinct from 'printful.product.reconcile' or b->>'status' is distinct from 'open' or b->'options' is distinct from '[]'::jsonb) then raise exception 'product_intervention_invalid'; end if;
   if tg_op='UPDATE' and (a->>'status' is distinct from 'open' or b->>'status' is distinct from 'resolved' or b->>'resolved_at' is null or b->'resolution'->>'result' is distinct from 'stopped_before_dispatch'
    or a-array['status','resolved_at','resolution','updated_at'] is distinct from b-array['status','resolved_at','resolution','updated_at']) then raise exception 'product_intervention_immutable'; end if;
  end if;
 end if;
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
do $$ declare n text; begin
 foreach n in array array['action_intents','action_receipts','external_resources','events','owner_interventions'] loop
  execute format('create trigger %I before insert or update or delete on public.%I for each row execute function private.stage15_product_core_guard()','stage15_product_'||n||'_guard',n);
 end loop;
end $$;

create function private.stage15_product_source(p_business uuid,p_source uuid,p_current boolean default true) returns jsonb language plpgsql set search_path='' as $$
declare row private.printful_product_sources%rowtype; s jsonb; plan jsonb; file jsonb; placement jsonb;
 stock jsonb; cost jsonb; pricing jsonb; fee jsonb; evidence jsonb; field text;
 a public.creative_approvals%rowtype; asset public.creative_assets%rowtype; c private.connected_accounts%rowtype; pc private.provider_connections%rowtype;
begin
 select * into row from private.printful_product_sources where id=p_source and business_id=p_business and owner_id=auth.uid();
 if row.id is null then raise exception 'product_source_authority_unavailable'; end if;
 s:=row.source; plan:=s->'plan'; file:=s->'fileBinding'; placement:=s->'placementEvidence'; stock:=s->'stockEvidence'; cost:=s->'costEvidence'; pricing:=cost->'pricing';
 if private.stage14_hash(s) is distinct from row.source_hash or s->>'id' is distinct from row.id::text or s->>'businessId' is distinct from p_business::text
  or s->>'connectionId' is distinct from row.connection_id::text or s->>'connectionRevision' is distinct from row.connection_revision::text or s->>'storeId' is distinct from row.store_id::text
  or s->>'version' is distinct from '1.0.0' or s->>'storeKind' is distinct from 'manual_api' or s->>'evidenceMode' is distinct from 'live'
  or plan->>'businessId' is distinct from p_business::text or plan->>'storeKind' is distinct from 'manual_api' or plan->>'operation' is distinct from 'create_native_sync_product'
  or plan->>'technique' is distinct from 'dtg' or coalesce(plan->>'placement','') not in ('front','back')
  or plan->>'assetVersionId' is distinct from s->>'assetVersionId' or plan->>'assetSha256' is distinct from s->>'assetSha256'
  or plan->>'version' is distinct from '1.0.0' or plan->>'state' is distinct from 'proposal'
  or plan->'executionAuthorized' is distinct from 'false'::jsonb or plan->'publicationAuthorized' is distinct from 'false'::jsonb or plan->'orderSubmissionAuthorized' is distinct from 'false'::jsonb
  or coalesce(plan->>'requestHash','') !~ '^[a-f0-9]{64}$'
  or coalesce(s->>'providerFactsHash','') !~ '^[a-f0-9]{64}$' or coalesce(s->>'assetSha256','') !~ '^[a-f0-9]{64}$'
  or coalesce((s->>'printfulFileId')::bigint,0)<=0 or coalesce((plan->>'variantId')::bigint,0)<=0 or coalesce((plan->>'productId')::bigint,0)<=0
  or coalesce(length(btrim(s->>'name')),0) not between 1 and 200 or coalesce(s->>'retailPrice','') !~ '^[0-9]+\.[0-9]{2}$' or (s->>'retailPrice')::numeric<=0
  or coalesce(s->>'currency','') not in ('USD','GBP','AUD','NZD') then raise exception 'product_source_binding_invalid'; end if;
 if jsonb_typeof(file) is distinct from 'object' or nullif(file->>'id','') is null or file->>'source' is distinct from 'authenticated_upload'
  or file->>'assetSha256' is distinct from s->>'assetSha256' or file->'printfulFileId' is distinct from s->'printfulFileId' or coalesce(file->>'providerMd5','') !~ '^[a-f0-9]{32}$'
  or file->'widthPx' is distinct from plan->'sourceWidthPx' or file->'heightPx' is distinct from plan->'sourceHeightPx'
  then raise exception 'product_file_binding_required'; end if;
 if placement is not null and placement<>'null'::jsonb and (jsonb_typeof(placement) is distinct from 'object' or nullif(placement->>'id','') is null
  or placement->>'source' is distinct from 'authenticated_placement' or coalesce(placement->>'proofHash','') !~ '^[a-f0-9]{64}$'
  or placement->>'assetSha256' is distinct from s->>'assetSha256' or placement->'catalogVariantId' is distinct from plan->'variantId'
  or placement->'placement' is distinct from plan->'placement' or placement->'designWidthIn' is distinct from plan->'designWidthIn' or placement->'designHeightIn' is distinct from plan->'designHeightIn') then raise exception 'product_placement_binding_invalid'; end if;
 -- Frozen trusted evidence remains a closed, bounded DTO; no raw provider
 -- bodies, secrets, arbitrary URLs, or downstream listing facts are projected.
 if s-array['version','id','businessId','connectionId','connectionRevision','storeId','storeKind','evidenceMode','goalId','workflowRunId','candidateId','decisionId','creativeApprovalId','creativeRunId','assetVersionId','assetSha256','assetStoragePath','plan','name','retailPrice','currency','printfulFileId','fileTypeEvidence','fileBinding','placementEvidence','stockEvidence','costEvidence','providerFactsHash','observedAt','expiresAt']<>'{}'::jsonb
  or plan->'requires' is distinct from '["verified_store_connection","current_persisted_creative_production_approval","current_stock_and_cost_quote","owner_configuration_approval"]'::jsonb then raise exception 'product_source_binding_invalid'; end if;
 evidence:=s->'fileTypeEvidence';
 if jsonb_typeof(evidence) is distinct from 'object' or evidence->'catalogProductId' is distinct from plan->'productId' or evidence->'catalogVariantId' is distinct from plan->'variantId'
  or evidence->'placement' is distinct from plan->'placement' or evidence->>'fileType' is distinct from (case when plan->>'placement'='front' then 'default' else 'back' end)
  or coalesce(evidence->>'responseHash','') !~ '^[a-f0-9]{64}$' then raise exception 'product_file_type_evidence_required'; end if;
 if jsonb_typeof(stock) is distinct from 'object' or stock->'variantId' is distinct from plan->'variantId' or stock->'available' is distinct from 'true'::jsonb or coalesce(stock->>'responseHash','') !~ '^[a-f0-9]{64}$' then raise exception 'product_stock_evidence_required'; end if;
 if jsonb_typeof(cost) is distinct from 'object' or cost->'variantId' is distinct from plan->'variantId' or cost->'currency' is distinct from s->'currency'
  or coalesce(cost->>'responseHash','') !~ '^[a-f0-9]{64}$' or jsonb_typeof(pricing) is distinct from 'object' or pricing->'currency' is distinct from s->'currency'
  or pricing->'productionMinor' is distinct from cost->'productionMinor' or (pricing->>'itemPriceMinor')::numeric is distinct from (s->>'retailPrice')::numeric*100
  or coalesce(length(btrim(pricing->>'assumptionLabel')),0) not between 3 and 1000 then raise exception 'product_cost_evidence_required'; end if;
 foreach field in array array['itemPriceMinor','shippingChargedMinor','productionMinor','fulfilmentShippingMinor','sellerTaxCostMinor'] loop
  if jsonb_typeof(pricing->field) is distinct from 'number' or (pricing->>field)::numeric<>trunc((pricing->>field)::numeric) or (pricing->>field)::numeric not between 0 and 10000000000 then raise exception 'product_cost_evidence_required'; end if;
 end loop;
 foreach field in array array['discountBps','refundReserveBps','targetMarginBps'] loop
  if jsonb_typeof(pricing->field) is distinct from 'number' or (pricing->>field)::numeric<>trunc((pricing->>field)::numeric) or (pricing->>field)::numeric not between 0 and 10000 then raise exception 'product_cost_evidence_required'; end if;
 end loop;
 if (pricing->>'itemPriceMinor')::numeric-ceil((pricing->>'itemPriceMinor')::numeric*(pricing->>'discountBps')::numeric/10000)+(pricing->>'shippingChargedMinor')::numeric<=0 then raise exception 'product_cost_evidence_required'; end if;
 foreach field in array array['marketplaceFee','paymentFee'] loop
  fee:=pricing->field;
  if jsonb_typeof(fee) is distinct from 'object' or jsonb_typeof(fee->'fixedMinor') is distinct from 'number' or (fee->>'fixedMinor')::numeric<>trunc((fee->>'fixedMinor')::numeric) or (fee->>'fixedMinor')::numeric not between 0 and 10000000000
   or jsonb_typeof(fee->'rateBps') is distinct from 'number' or (fee->>'rateBps')::numeric<>trunc((fee->>'rateBps')::numeric) or (fee->>'rateBps')::numeric not between 0 and 10000 or coalesce(fee->>'basis','') not in ('item','item_plus_shipping') then raise exception 'product_cost_evidence_required'; end if;
 end loop;
 if s->>'providerFactsHash' is distinct from private.stage14_hash(jsonb_build_object('productCatalogHash',plan->'productCatalogHash','variantCatalogHash',plan->'variantCatalogHash','stockEvidence',stock,'costEvidence',cost)) then raise exception 'product_provider_facts_changed'; end if;
 for evidence in select value from jsonb_array_elements(jsonb_build_array(s,file,placement,s->'fileTypeEvidence',stock,cost)) where value<>'null'::jsonb loop
  if coalesce((evidence->>'expiresAt')::timestamptz,'-infinity')<=coalesce((evidence->>'observedAt')::timestamptz,'infinity')
   or (evidence->>'expiresAt')::timestamptz>(evidence->>'observedAt')::timestamptz+interval '1 day'
   or (p_current and ((evidence->>'observedAt')::timestamptz>clock_timestamp() or (evidence->>'expiresAt')::timestamptz<=clock_timestamp())) then raise exception 'product_source_expired'; end if;
 end loop;
 if p_current then
  select * into c from private.connected_accounts where id=row.connection_id and business_id=p_business and owner_id=auth.uid() and provider='printful';
  select * into pc from private.provider_connections where id=c.id and business_id=p_business;
  if c.status is distinct from 'connected' or c.connection_revision is distinct from row.connection_revision or pc.revision is distinct from row.connection_revision or pc.store_id is distinct from row.store_id
   or pc.store_kind is distinct from 'manual_api' or coalesce(pc.expires_at,'-infinity')<=clock_timestamp() then raise exception 'product_connection_revoked'; end if;
  if coalesce((s->>'observedAt')::timestamptz,'infinity')>clock_timestamp() or coalesce((s->>'expiresAt')::timestamptz,'-infinity')<=clock_timestamp()
   or coalesce((file->>'observedAt')::timestamptz,'infinity')>clock_timestamp() or coalesce((file->>'expiresAt')::timestamptz,'-infinity')<=clock_timestamp()
   or (placement<>'null'::jsonb and (coalesce((placement->>'observedAt')::timestamptz,'infinity')>clock_timestamp() or coalesce((placement->>'expiresAt')::timestamptz,'-infinity')<=clock_timestamp())) then raise exception 'product_source_expired'; end if;
  if not exists(select 1 from public.goals where id=(s->>'goalId')::uuid and business_id=p_business and status='active')
   or not exists(select 1 from public.workflow_runs where id=(s->>'workflowRunId')::uuid and business_id=p_business and goal_id=(s->>'goalId')::uuid and status not in ('cancelled','failed','needs_owner','waiting')) then raise exception 'product_goal_or_workflow_stopped'; end if;
  select * into a from public.creative_approvals where id=(s->>'creativeApprovalId')::uuid and business_id=p_business and candidate_id=(s->>'candidateId')::uuid
   and decision_id=(s->>'decisionId')::uuid and purpose='candidate_production' and owner_user_id=auth.uid() and expires_at>clock_timestamp();
  if a.id is null or private.stage14_hash(a.snapshot) is distinct from a.approval_hash then raise exception 'product_production_approval_required'; end if;
  perform private.stage14_assert_approval(a.candidate_id,a.snapshot);
  if not exists(select 1 from public.creative_runs r join public.workflow_runs w on w.id=r.workflow_run_id and w.business_id=r.business_id
   where r.id=(s->>'creativeRunId')::uuid and r.business_id=p_business and r.approval_id=a.id and w.status='completed' and w.state->'productionReady'='true'::jsonb) then raise exception 'product_production_asset_required'; end if;
  select * into asset from public.creative_assets where id=(s->>'assetVersionId')::uuid and business_id=p_business and creative_run_id=(s->>'creativeRunId')::uuid and approval_id=a.id
   and asset_hash=s->>'assetSha256' and storage_path=s->>'assetStoragePath';
  if asset.id is null or asset.inspection->'failedCriteria' is distinct from '[]'::jsonb
   or asset.inspection->'width' is distinct from plan->'sourceWidthPx' or asset.inspection->'height' is distinct from plan->'sourceHeightPx'
   or a.snapshot->'printSpecification'->'designWidthInches' is distinct from plan->'designWidthIn' or a.snapshot->'printSpecification'->'designHeightInches' is distinct from plan->'designHeightIn'
   or not exists(select 1 from public.creative_reviews where asset_id=asset.id and business_id=p_business and asset_hash=asset.asset_hash and review->>'outcome'='PASS')
   or exists(select 1 from public.creative_assets newer where newer.creative_run_id=asset.creative_run_id and newer.version>asset.version) then raise exception 'product_asset_provenance_not_current'; end if;
 end if;
 return jsonb_build_object('source',s,'sourceHash',row.source_hash);
end $$;

create function private.stage15_product_authority(p_business uuid,p_source jsonb) returns jsonb language plpgsql set search_path='' as $$
declare a private.printful_product_write_authorities%rowtype; c private.connected_accounts%rowtype; pc private.provider_connections%rowtype;
begin
 select * into c from private.connected_accounts where id=(p_source->>'connectionId')::uuid and business_id=p_business and owner_id=auth.uid() and provider='printful';
 select * into pc from private.provider_connections where id=c.id and business_id=p_business;
 if c.status is distinct from 'connected' or c.connection_revision::text is distinct from p_source->>'connectionRevision' or pc.revision is distinct from c.connection_revision
  or pc.store_id::text is distinct from p_source->>'storeId' or pc.store_kind is distinct from 'manual_api' or coalesce(pc.expires_at,'-infinity')<=clock_timestamp() then raise exception 'product_connection_revoked'; end if;
 select * into a from private.printful_product_write_authorities where business_id=p_business and owner_id=auth.uid() and connection_id=c.id and connection_revision=c.connection_revision
  and store_id=pc.store_id and enabled and expires_at>clock_timestamp();
 if a.id is null then raise exception 'product_write_authority_unavailable'; end if;
 return jsonb_build_object('businessId',p_business,'connectionId',c.id,'connectionRevision',c.connection_revision,'storeId',pc.store_id,'storeKind','manual_api','writeAuthorityId',a.id,'credentialEnvelope',a.credential_envelope,'providerScopes',a.provider_scopes,'permittedOperations',a.scopes,'expiresAt',a.expires_at);
end $$;

create function private.stage15_product_view(p_run uuid) returns jsonb language sql stable set search_path='' as $$
 select r.state||jsonb_build_object('name',r.source->>'name','approvedAt',r.approved_at,'expiresAt',r.approval_expires_at,'revision',r.revision,'stopRequested',r.stopped_at is not null)
 from private.printful_product_runs r where r.id=p_run;
$$;
create function private.stage15_product_intervene(p_run uuid) returns void language plpgsql set search_path='' as $$
declare r private.printful_product_runs%rowtype;
begin
 select * into strict r from private.printful_product_runs where id=p_run;
 if not exists(select 1 from public.owner_interventions where action_intent_id=r.action_intent_id and status='open') then
  insert into public.owner_interventions(business_id,action_intent_id,intervention_type,status,title,description,options)
   values(r.business_id,r.action_intent_id,'printful.product.reconcile','open','Printful product needs verification',
    'The saved product request requires read-only reconciliation. A product GET cannot establish physical placement or printing technique. Stopping does not delete an external product. The request must not be repeated and no listing or order is authorized.','[]');
 end if;
end $$;

create function private.stage15_product_owner(p_business uuid,p_operation text,p_payload jsonb,p_server_key text) returns jsonb language plpgsql set search_path='' as $$
declare r private.printful_product_runs%rowtype; source jsonb; s jsonb; approval jsonb; request_hash text; source_hash text;
 v_id uuid:=gen_random_uuid(); intent uuid:=gen_random_uuid(); resource uuid:=gen_random_uuid(); receipt uuid:=gen_random_uuid();
 marker jsonb; prior_marker jsonb; summary jsonb; actual_receipt jsonb; actual_resource jsonb; expected_summary jsonb; result jsonb; target_run uuid;
begin
 if p_operation='workspace' then
  if p_payload-array['interventionId']<>'{}'::jsonb then raise exception 'product_request_invalid'; end if;
  if p_payload ? 'interventionId' then
   select pr.id into target_run from public.owner_interventions oi join private.printful_product_runs pr on pr.action_intent_id=oi.action_intent_id and pr.business_id=oi.business_id
    where oi.id=(p_payload->>'interventionId')::uuid and oi.business_id=p_business and oi.intervention_type='printful.product.reconcile' and pr.owner_id=auth.uid();
   if target_run is null then raise exception 'product_intervention_not_found'; end if;
  end if;
  return jsonb_build_object('sources',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'name',x.source->>'name','sourceHash',x.source_hash,'expiresAt',x.source->>'expiresAt',
    'connectionId',x.connection_id,'connectionRevision',x.connection_revision,'storeId',x.store_id,'assetVersionId',x.source->>'assetVersionId','assetSha256',x.source->>'assetSha256',
    'catalogProductId',x.source->'plan'->'productId','catalogVariantId',x.source->'plan'->'variantId','placement',x.source->'plan'->'placement',
    'designWidthIn',x.source->'plan'->'designWidthIn','designHeightIn',x.source->'plan'->'designHeightIn','retailPrice',x.source->'retailPrice','currency',x.source->'currency') order by x.imported_at desc)
    from (select * from private.printful_product_sources where business_id=p_business and owner_id=auth.uid() order by imported_at desc limit 50) x),'[]'::jsonb),
   'runs',coalesce((select jsonb_agg(private.stage15_product_view(x.id) order by (x.id=target_run) desc nulls last,x.approved_at desc) from
    (select * from private.printful_product_runs where business_id=p_business and owner_id=auth.uid() order by (id=target_run) desc nulls last,approved_at desc limit 50) x),'[]'::jsonb),
   'sourceAuthorityAvailable',false,'productWriteAuthorityAvailable',false,
   'blockers','["product_write_authority_unavailable","product_uploaded_asset_producer_required","product_placement_producer_required"]'::jsonb);
 end if;
 -- Stop is always owner-accessible even if server execution configuration fails.
 -- The Business lock serializes stop/connection changes with dispatch admission.
 perform 1 from public.businesses where id=p_business for update;
 if not private.is_business_owner(p_business) then raise exception 'owner_required' using errcode='42501'; end if;
 if p_operation='cancel' then
  if p_payload-array['runId']<>'{}'::jsonb then raise exception 'product_request_invalid'; end if;
  select * into strict r from private.printful_product_runs where id=(p_payload->>'runId')::uuid and business_id=p_business and owner_id=auth.uid() for update;
  if r.stopped_at is not null then return private.stage15_product_view(r.id); end if;
  s:=r.state||jsonb_build_object('stopRequested',true,'status',case when r.state->'dispatch'='null'::jsonb then 'cancelled' else 'needs_owner' end,
   'reason',case when r.state->'dispatch'='null'::jsonb then 'owner_cancel' else 'owner_cancel_after_dispatch' end);
  update private.printful_product_runs set stopped_at=clock_timestamp(),state=s where id=r.id;
  update public.action_intents set status=case when r.state->'dispatch'='null'::jsonb then 'expired' else 'executing' end where id=r.action_intent_id;
  if r.state->'dispatch'<>'null'::jsonb then perform private.stage15_product_intervene(r.id);
  else update public.owner_interventions set status='resolved',resolved_at=clock_timestamp(),resolution='{"result":"stopped_before_dispatch"}' where action_intent_id=r.action_intent_id and status='open'; end if;
  insert into public.events(business_id,event_type,actor_type,actor_id,payload) values(p_business,'printful.product.stopped','owner',auth.uid()::text,jsonb_build_object('runId',r.id,'dispatchSent',r.state->'dispatch'<>'null'::jsonb,'externalDeletionClaimed',false));
  return private.stage15_product_view(r.id);
 end if;
 if coalesce(length(p_server_key),0)<32 or not exists(select 1 from private.printful_product_server_authority where key_hash=private.stage13_hash(p_server_key) and enabled) then raise exception 'server_authority_required' using errcode='42501'; end if;
 if p_operation in ('source','connection') then
  if p_payload-array['sourceId']<>'{}'::jsonb then raise exception 'product_request_invalid'; end if;
  source:=private.stage15_product_source(p_business,(p_payload->>'sourceId')::uuid,p_operation='source');
  if p_operation='connection' then return private.stage15_product_authority(p_business,source->'source'); end if;
  return source;
 end if;
 if p_operation='prepare' then
  if p_payload-array['sourceId','sourceHash','requestHash','approval','approvalHash']<>'{}'::jsonb then raise exception 'product_request_invalid'; end if;
  -- Source identity remains single-use after stop, expiry, or uncertain outcome.
  select * into r from private.printful_product_runs where source_id=(p_payload->>'sourceId')::uuid and business_id=p_business and owner_id=auth.uid();
  if r.id is not null then
   if r.source_hash is distinct from p_payload->>'sourceHash' or r.request_hash is distinct from p_payload->>'requestHash' or r.approval_hash is distinct from p_payload->>'approvalHash' or r.approval is distinct from p_payload->'approval' then raise exception 'product_approval_replay_mismatch'; end if;
   return jsonb_build_object('runId',r.id,'created',false);
  end if;
  result:=private.stage15_product_source(p_business,(p_payload->>'sourceId')::uuid,true); source:=result->'source'; source_hash:=result->>'sourceHash';
  if source_hash is distinct from p_payload->>'sourceHash' then raise exception 'product_source_binding_invalid'; end if;
  if source->'placementEvidence' is null or source->'placementEvidence'='null'::jsonb then raise exception 'product_placement_producer_required'; end if;
  perform private.stage15_product_authority(p_business,source);
  request_hash:=private.stage13_hash('printful-product-configure:v1:'||p_business||':'||(source->>'id')||':'||source_hash||':'||(source->>'connectionId')||':'||(source->>'connectionRevision')||':'||(source->>'storeId'));
  approval:=p_payload->'approval';
  if p_payload->>'requestHash' is distinct from request_hash or private.stage14_hash(approval) is distinct from p_payload->>'approvalHash'
   or jsonb_typeof(approval) is distinct from 'object' or approval-array['id','sourceHash','requestHash','operation','configuration','approvedAt','expiresAt']<>'{}'::jsonb
   or coalesce(approval->>'id','') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
   or approval->>'sourceHash' is distinct from source_hash or approval->>'requestHash' is distinct from request_hash
   or approval->>'operation' is distinct from 'create_native_product' or approval->'configuration' is distinct from 'true'::jsonb
   or coalesce((approval->>'approvedAt')::timestamptz,'infinity')>clock_timestamp() or coalesce((approval->>'expiresAt')::timestamptz,'-infinity')<=clock_timestamp()
   or (approval->>'expiresAt')::timestamptz>(approval->>'approvedAt')::timestamptz+interval '5 minutes'
   or (approval->>'expiresAt')::timestamptz>(source->>'expiresAt')::timestamptz then raise exception 'product_approval_invalid'; end if;
  s:=jsonb_build_object('id',v_id,'businessId',p_business,'connectionId',source->'connectionId','connectionRevision',source->'connectionRevision','storeId',source->'storeId','storeKind','manual_api',
   'sourceId',source->'id','sourceHash',source_hash,'approvalHash',p_payload->>'approvalHash','requestHash',request_hash,'identity','al-pf-'||replace(source->>'id','-',''),
   'actionIntentId',intent,'resourceId',resource,'receiptId',receipt,'status','ready','reason',null,'stopRequested',false,'dispatch',null,'syncProductId',null,'syncVariantId',null,'receiptRecorded',false,'observationHash',null);
  insert into public.action_intents(id,business_id,action_type,capability,status,request,risk,financial_impact,idempotency_key,created_by_type,created_by_id)
   values(intent,p_business,'printful.product.configure','fulfilment.print','approved',jsonb_build_object('runId',v_id,'sourceId',source->'id','sourceHash',source_hash,'approvalHash',p_payload->>'approvalHash',
    'requestHash',request_hash,'identity',s->>'identity','connectionId',source->'connectionId','connectionRevision',source->'connectionRevision','storeId',source->'storeId'),
    '{"configurationMode":"manual_api_product","singleVariant":true,"singleAttempt":true,"automaticRetry":false,"publicationAuthorized":false,"orderSubmissionAuthorized":false}',
    '{"paidOrderAuthorized":false}','printful-product:'||(source->>'id'),'owner',auth.uid()::text);
  insert into private.printful_product_runs(id,business_id,owner_id,source_id,source,source_hash,connection_id,connection_revision,store_id,identity,request_hash,approval,approval_hash,
   action_intent_id,resource_id,receipt_id,state,approved_at,approval_expires_at)
   values(v_id,p_business,auth.uid(),(source->>'id')::uuid,source,source_hash,(source->>'connectionId')::uuid,(source->>'connectionRevision')::uuid,(source->>'storeId')::bigint,s->>'identity',request_hash,approval,p_payload->>'approvalHash',
    intent,resource,receipt,s,(approval->>'approvedAt')::timestamptz,(approval->>'expiresAt')::timestamptz);
  insert into public.events(business_id,event_type,actor_type,actor_id,payload) values(p_business,'printful.product.approved','owner',auth.uid()::text,jsonb_build_object('runId',v_id,'sourceId',source->'id','requestHash',request_hash));
  return jsonb_build_object('runId',v_id,'created',true);
 end if;
 select * into strict r from private.printful_product_runs where id=(p_payload->>'runId')::uuid and business_id=p_business and owner_id=auth.uid() for update;
 if p_operation='acquire' then
  if p_payload-array['runId','lease']<>'{}'::jsonb then raise exception 'product_request_invalid'; end if;
  if r.lease_expires_at>clock_timestamp() then raise exception 'product_in_progress'; end if;
  if coalesce(length(p_payload->>'lease'),0) not between 32 and 512 then raise exception 'product_invalid_lease'; end if;
  update private.printful_product_runs set lease_generation=gen_random_uuid(),lease_hash=private.stage13_hash(p_payload->>'lease'),lease_expires_at=clock_timestamp()+interval '2 minutes' where id=r.id;
  return jsonb_build_object('state',r.state,'revision',r.revision);
 end if;
 if r.lease_hash is distinct from private.stage13_hash(p_payload->>'lease') or coalesce(r.lease_expires_at,'-infinity')<=clock_timestamp() then raise exception 'product_lease_expired'; end if;
 if p_operation='release' then
  if p_payload-array['runId','lease']<>'{}'::jsonb then raise exception 'product_request_invalid'; end if;
  update private.printful_product_runs set lease_generation=null,lease_hash=null,lease_expires_at=null where id=r.id; return '{}'::jsonb;
 elsif p_operation='guard' then
  if p_payload-array['runId','lease','mode']<>'{}'::jsonb or coalesce(p_payload->>'mode','') not in ('configure','reconcile') then raise exception 'product_guard_mode_required'; end if;
  if p_payload->>'mode'='configure' then
   if r.stopped_at is not null or r.approval_expires_at<=clock_timestamp() or r.state->>'status' in ('cancelled','verified') then raise exception 'product_stopped_or_approval_expired'; end if;
   if r.state->'dispatch'<>'null'::jsonb and not exists(select 1 from private.printful_product_operations where run_id=r.id and dispatch_lease_generation=r.lease_generation) then raise exception 'product_already_dispatched'; end if;
   result:=private.stage15_product_source(p_business,r.source_id,true);
   if result->'source' is distinct from r.source or result->>'sourceHash' is distinct from r.source_hash then raise exception 'product_source_binding_invalid'; end if;
   if r.source->'placementEvidence' is null or r.source->'placementEvidence'='null'::jsonb then raise exception 'product_placement_producer_required'; end if;
  else
   if not exists(select 1 from private.printful_product_operations op where op.run_id=r.id and op.request_hash=r.request_hash) then raise exception 'product_dispatch_required'; end if;
  end if;
  perform private.stage15_product_authority(p_business,r.source);
  return jsonb_build_object('source',r.source,'sourceHash',r.source_hash,'approval',r.approval,'approvalHash',r.approval_hash,'stopRequested',r.stopped_at is not null);
 elsif p_operation in ('save','finish') then
  if p_payload-array['runId','lease','revision','state','receipt','resource']<>'{}'::jsonb or (p_operation='save' and p_payload ?| array['receipt','resource']) then raise exception 'product_request_invalid'; end if;
  if (p_payload->>'revision')::integer is distinct from r.revision then raise exception 'stale_product_revision'; end if;
  s:=p_payload->'state'; marker:=s->'dispatch'; prior_marker:=r.state->'dispatch';
  if jsonb_typeof(s) is distinct from 'object' or s-array['status','reason','stopRequested','dispatch','syncProductId','syncVariantId','receiptRecorded','observationHash'] is distinct from r.state-array['status','reason','stopRequested','dispatch','syncProductId','syncVariantId','receiptRecorded','observationHash']
   or coalesce(s->>'status','') not in ('ready','running','needs_owner','cancelled') or jsonb_typeof(s->'stopRequested') is distinct from 'boolean'
   or coalesce(jsonb_typeof(s->'reason'),'') not in ('null','string') or (s->'reason'<>'null'::jsonb and coalesce(s->>'reason','') !~ '^[a-z][a-z0-9_]{0,159}$')
   or jsonb_typeof(s->'receiptRecorded') is distinct from 'boolean' or coalesce(jsonb_typeof(s->'observationHash'),'') not in ('null','string') then raise exception 'product_state_identity_immutable'; end if;
  if r.state->'receiptRecorded'='true'::jsonb then
   if s is distinct from r.state then raise exception 'product_observation_immutable'; end if;
   return jsonb_build_object('state',r.state,'revision',r.revision);
  end if;
  if prior_marker='null'::jsonb and marker<>'null'::jsonb then
   if p_operation<>'save' or jsonb_typeof(marker) is distinct from 'object' or marker-array['requestHash','sentAt']<>'{}'::jsonb
    or marker->>'requestHash' is distinct from r.request_hash or coalesce((marker->>'sentAt')::timestamptz,'-infinity')<r.approved_at or (marker->>'sentAt')::timestamptz>clock_timestamp()+interval '5 seconds'
    or s->>'status' is distinct from 'running' then raise exception 'product_dispatch_marker_invalid'; end if;
   if r.stopped_at is not null or r.approval_expires_at<=clock_timestamp() or r.state->>'status'='cancelled' then raise exception 'product_stopped_or_approval_expired'; end if;
   result:=private.stage15_product_source(p_business,r.source_id,true);
   if result->'source' is distinct from r.source or result->>'sourceHash' is distinct from r.source_hash then raise exception 'product_source_binding_invalid'; end if;
   if r.source->'placementEvidence' is null or r.source->'placementEvidence'='null'::jsonb then raise exception 'product_placement_producer_required'; end if;
   perform private.stage15_product_authority(p_business,r.source);
   insert into private.printful_product_operations(run_id,business_id,request_hash,sent_at,marker,dispatch_lease_generation) values(r.id,p_business,r.request_hash,(marker->>'sentAt')::timestamptz,marker,r.lease_generation);
   update public.action_intents set status='executing' where id=r.action_intent_id;
  elsif prior_marker<>'null'::jsonb then
   if marker is distinct from prior_marker then raise exception 'product_dispatch_cannot_be_reset'; end if;
  elsif marker is distinct from 'null'::jsonb then raise exception 'product_dispatch_marker_invalid'; end if;
  if s->>'status'='cancelled' and marker<>'null'::jsonb then raise exception 'product_dispatched_requires_reconciliation'; end if;
  if (s->'syncProductId'<>'null'::jsonb and (coalesce((s->>'syncProductId')::bigint,0)<=0 or marker='null'::jsonb))
   or (s->'syncVariantId'<>'null'::jsonb and (coalesce((s->>'syncVariantId')::bigint,0)<=0 or marker='null'::jsonb))
   or (s->'syncProductId'<>'null'::jsonb and (jsonb_typeof(s->'syncProductId')<>'number' or (s->>'syncProductId')::numeric<>trunc((s->>'syncProductId')::numeric) or (s->>'syncProductId')::numeric>9007199254740991))
   or (s->'syncVariantId'<>'null'::jsonb and (jsonb_typeof(s->'syncVariantId')<>'number' or (s->>'syncVariantId')::numeric<>trunc((s->>'syncVariantId')::numeric) or (s->>'syncVariantId')::numeric>9007199254740991))
   or (r.state->'syncProductId'<>'null'::jsonb and s->'syncProductId' is distinct from r.state->'syncProductId')
   or (r.state->'syncVariantId'<>'null'::jsonb and s->'syncVariantId' is distinct from r.state->'syncVariantId')
   or s->'syncProductId' is null or s->'syncVariantId' is null then raise exception 'product_observed_identity_immutable'; end if;
  if p_operation='save' and (s->'observationHash' is distinct from r.state->'observationHash' or s->'receiptRecorded' is distinct from 'false'::jsonb) then raise exception 'product_observation_requires_finish'; end if;
  if r.stopped_at is not null then
   s:=s||jsonb_build_object('stopRequested',true,'status',case when marker='null'::jsonb then 'cancelled' else 'needs_owner' end);
  elsif s->'stopRequested'='true'::jsonb then raise exception 'product_stop_requires_cancel'; end if;
  if p_operation='finish' then
   -- This records already-obtained independent observations. Fresh source,
   -- approval, connection, or stop status must not erase a genuine dispatched
   -- observation. Reconciliation GET itself still uses the current-access guard.
   if not exists(select 1 from private.printful_product_operations op where op.run_id=r.id and op.request_hash=r.request_hash and op.marker=prior_marker)
    or s->>'status' is distinct from 'needs_owner' or s->'receiptRecorded' is distinct from 'true'::jsonb
    or coalesce((s->>'syncProductId')::bigint,0)<=0 or coalesce((s->>'syncVariantId')::bigint,0)<=0 then raise exception 'product_dispatch_and_readback_required'; end if;
   actual_receipt:=p_payload->'receipt'; actual_resource:=p_payload->'resource'; summary:=actual_receipt->'responseSummary';
   expected_summary:=jsonb_build_object('configurationRunId',r.id,'sourceId',r.source_id,'sourceHash',r.source_hash,'approvalHash',r.approval_hash,'requestHash',r.request_hash,
    'connectionId',r.connection_id,'connectionRevision',r.connection_revision,'storeId',r.store_id,'syncProductId',s->'syncProductId','syncVariantId',s->'syncVariantId','identity',r.identity,
    'assetVersionId',r.source->'assetVersionId','assetSha256',r.source->'assetSha256','printfulFileId',r.source->'printfulFileId','providerFactsHash',private.stage14_hash(jsonb_build_object('storeId',r.store_id,'syncProductId',s->'syncProductId','syncVariantId',s->'syncVariantId','externalId',r.identity,'variantExternalId',r.identity||'-v',
     'catalogProductId',r.source->'plan'->'productId','catalogVariantId',r.source->'plan'->'variantId','placement',r.source->'plan'->'placement','fileType',r.source->'fileTypeEvidence'->'fileType',
     'printfulFileId',r.source->'printfulFileId','providerMd5',r.source->'fileBinding'->'providerMd5','widthPx',r.source->'fileBinding'->'widthPx','heightPx',r.source->'fileBinding'->'heightPx',
     'retailPriceMinor',(r.source->>'retailPrice')::numeric*100,'currency',r.source->'currency')),
    'productReadHash',summary->'productReadHash','fileReadHash',summary->'fileReadHash','associationVerified',true,'assetBindingVerified',true,
    'physicalPlacementVerified',false,'techniqueVerified',false,'configurationVerified',false,'liveQualified',false,'listingReady',false,'publicationAuthorized',false,'orderSubmissionAuthorized',false,
    'verifiedBy','independent_get','stopRequested',summary->'stopRequested','blockers','["physical_placement_not_observable","technique_not_observable"]'::jsonb,'executionMode','provider_response');
   if jsonb_typeof(summary) is distinct from 'object' or summary is distinct from expected_summary or jsonb_typeof(summary->'stopRequested') is distinct from 'boolean'
    or (r.stopped_at is null and summary->'stopRequested'='true'::jsonb) or coalesce(summary->>'productReadHash','') !~ '^[a-f0-9]{64}$' or coalesce(summary->>'fileReadHash','') !~ '^[a-f0-9]{64}$'
    or private.stage14_hash(summary) is distinct from s->>'observationHash' then raise exception 'product_observation_binding_invalid'; end if;
   if actual_receipt->>'id' is distinct from r.receipt_id::text or actual_receipt->>'businessId' is distinct from p_business::text or actual_receipt->>'actionIntentId' is distinct from r.action_intent_id::text
    or actual_receipt->>'externalResourceId' is distinct from r.resource_id::text or actual_receipt->'attempt' is distinct from '1'::jsonb or actual_receipt->>'outcome' is distinct from 'uncertain'
    or actual_receipt->>'provider' is distinct from 'printful' or actual_receipt->>'requestFingerprint' is distinct from r.request_hash
    or actual_receipt-array['id','businessId','actionIntentId','externalResourceId','attempt','outcome','provider','requestFingerprint','responseSummary','occurredAt','createdAt']<>'{}'::jsonb
    or coalesce((actual_receipt->>'occurredAt')::timestamptz,'-infinity')<(prior_marker->>'sentAt')::timestamptz or (actual_receipt->>'occurredAt')::timestamptz>clock_timestamp()+interval '5 seconds'
    or actual_receipt->>'createdAt' is distinct from actual_receipt->>'occurredAt' then raise exception 'product_receipt_binding_invalid'; end if;
   if actual_resource->>'id' is distinct from r.resource_id::text or actual_resource->>'businessId' is distinct from p_business::text or actual_resource->>'provider' is distinct from 'printful'
    or actual_resource->>'resourceType' is distinct from 'product_configuration_observation' or actual_resource->>'status' is distinct from 'pending'
    or actual_resource->>'externalId' is distinct from 'store:'||r.store_id||':sync_product:'||(s->>'syncProductId')
    or actual_resource->>'canonicalUrl' is distinct from 'https://api.printful.com/store/products/'||(s->>'syncProductId') or actual_resource->'metadata' is distinct from summary
    or actual_resource-array['id','businessId','provider','resourceType','externalId','status','canonicalUrl','metadata','createdAt','updatedAt']<>'{}'::jsonb then raise exception 'product_resource_binding_invalid'; end if;
   -- Normalize a concurrent owner Stop without losing valid readback evidence.
   summary:=summary||jsonb_build_object('stopRequested',r.stopped_at is not null);
   s:=s||jsonb_build_object('observationHash',private.stage14_hash(summary),'stopRequested',r.stopped_at is not null);
   insert into public.external_resources(id,business_id,provider,resource_type,external_id,status,canonical_url,metadata)
    values(r.resource_id,p_business,'printful','product_configuration_observation',actual_resource->>'externalId','pending',actual_resource->>'canonicalUrl',summary);
   insert into public.action_receipts(id,business_id,action_intent_id,external_resource_id,attempt,outcome,provider,request_fingerprint,response_summary,occurred_at)
    values(r.receipt_id,p_business,r.action_intent_id,r.resource_id,1,'uncertain','printful',r.request_hash,summary,(actual_receipt->>'occurredAt')::timestamptz);
   insert into public.events(business_id,event_type,actor_type,payload) values(p_business,'printful.product.observed','system',jsonb_build_object('runId',r.id,'configurationVerified',false,'listingReady',false,'stopRequested',r.stopped_at is not null));
  end if;
  if s->>'status'='needs_owner' then perform private.stage15_product_intervene(r.id); end if;
  if s->>'status'='cancelled' and marker='null'::jsonb then update public.action_intents set status='expired' where id=r.action_intent_id; end if;
  update private.printful_product_runs set state=s,revision=revision+1 where id=r.id;
  return jsonb_build_object('state',s,'revision',r.revision+1);
 end if;
 raise exception 'product_operation_invalid';
end $$;

create function public.printful_product_owner_transition(p_business_id uuid,p_operation text,p_payload jsonb default '{}',p_server_key text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.is_business_owner(p_business_id) then raise exception 'owner_required' using errcode='42501'; end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>150000 then raise exception 'product_request_invalid'; end if;
 insert into private.printful_product_mutation_admissions values(txid_current());
 result:=private.stage15_product_owner(p_business_id,p_operation,p_payload,p_server_key);
 delete from private.printful_product_mutation_admissions where transaction_id=txid_current();
 return result;
end $$;
revoke all on function public.printful_product_owner_transition(uuid,text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.printful_product_owner_transition(uuid,text,jsonb,text) to authenticated;
revoke all on function private.stage15_product_admitted(),private.stage15_product_record_guard(),private.stage15_product_core_guard(),private.stage15_product_source(uuid,uuid,boolean),private.stage15_product_authority(uuid,jsonb),private.stage15_product_view(uuid),private.stage15_product_intervene(uuid),private.stage15_product_owner(uuid,text,jsonb,text) from public,anon,authenticated,service_role;
