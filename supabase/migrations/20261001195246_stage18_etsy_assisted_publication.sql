-- Stage 18: additive Assisted Etsy publication runtime. Pending authority review.
-- No key, account, all-in fee evidence, live run or provider request is installed.
-- The all-in charge authority is deliberately unavailable in this release.

-- Refuse an unexpected prerequisite implementation rather than silently
-- expanding authority on top of drift. These are hashes of exact prosrc text,
-- independent of pg_get_functiondef formatting and hosted PostgreSQL version.
do $$ declare expected record; actual text; begin
 for expected in select * from (values
  ('private.stage16_assert_package(uuid,jsonb)','b4deead86f36f940e1bb4260d7480a8444228bff1e73cd01f12263d09f8f7c71'),
  ('private.stage17_assert_sources(uuid,uuid,text,jsonb,text)','55dd1b63614e5bdd7620251b81154f76b77a3209ead6a16090d3b9ada8fa4409'),
  ('private.stage17_assert_catalog(text,jsonb)','3db7f7ad043962cc85c255bd55ef60253e50f574ec02e79e343b2b01e68c148f'),
  ('private.stage17_core_guard()','c234c2301802ef2c93b9d27075b606316b4ecf8c34b11f2f8e18cda8c609bcc0'),
  ('private.stage17_record_guard()','fbfc2c9e558296d06b0713e4837f66369158c3ac93abbd622d08b3bf90f2b743')
 ) as prerequisite(signature,sha256) loop
  select encode(extensions.digest(p.prosrc,'sha256'),'hex') into actual from pg_catalog.pg_proc p where p.oid=to_regprocedure(expected.signature) and not p.prosecdef;
  if actual is distinct from expected.sha256 then raise exception 'Stage18 migration refused unexpected prerequisite drift: %',expected.signature; end if;
  if has_function_privilege('anon',expected.signature,'EXECUTE') or has_function_privilege('authenticated',expected.signature,'EXECUTE') or has_function_privilege('service_role',expected.signature,'EXECUTE') then raise exception 'Stage18 migration refused unexpected prerequisite ACL: %',expected.signature; end if;
 end loop;
end $$;

create table private.etsy_publication_runs (
 id uuid primary key, business_id uuid not null references public.businesses(id) on delete restrict,
 owner_id uuid not null references auth.users(id) on delete restrict,
 draft_run_id uuid not null unique references private.etsy_draft_runs(id) on delete restrict,
 listing_run_id uuid not null references public.listing_runs(id) on delete restrict,
 connection_id uuid not null, connection_revision uuid not null, shop_id bigint not null check(shop_id>0),
 listing_id bigint not null check(listing_id>0), package_artifact_id uuid not null,
 package_hash text not null check(package_hash ~ '^[a-f0-9]{64}$'),
 review_hash text not null check(review_hash ~ '^[a-f0-9]{64}$'),
 draft_receipt_hash text not null check(draft_receipt_hash ~ '^[a-f0-9]{64}$'),
 approval_hash text not null check(approval_hash ~ '^[a-f0-9]{64}$'),
 disclosure_hash text not null check(disclosure_hash ~ '^[a-f0-9]{64}$'),
 request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
 preflight_hash text not null check(preflight_hash ~ '^[a-f0-9]{64}$'), preflight jsonb not null,
 package jsonb not null, draft jsonb not null, approval jsonb not null, disclosure jsonb not null,
 fee_evidence jsonb not null, financial_exposure jsonb not null,
 action_intent_id uuid not null, resource_id uuid not null unique, receipt_id uuid not null unique,
 state jsonb not null, revision integer not null default 0 check(revision>=0),
 approved_at timestamptz not null default clock_timestamp(), approval_expires_at timestamptz not null,
 stopped_at timestamptz, lease_hash text, lease_expires_at timestamptz,
 foreign key(connection_id,business_id) references private.etsy_connections(id,business_id) on delete restrict,
 foreign key(package_artifact_id,business_id) references public.artifacts(id,business_id) on delete restrict,
 foreign key(action_intent_id,business_id) references public.action_intents(id,business_id) on delete restrict,
 unique(business_id,shop_id,listing_id), unique(id,business_id)
);
create table private.etsy_publication_operations (
 publication_run_id uuid primary key references private.etsy_publication_runs(id) on delete restrict,
 business_id uuid not null, request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
 sent_at timestamptz not null, marker jsonb not null,
 foreign key(publication_run_id,business_id) references private.etsy_publication_runs(id,business_id) on delete restrict
);
create table private.etsy_publication_mutation_admissions (transaction_id bigint primary key);
do $$ declare n text; begin
 foreach n in array array['etsy_publication_runs','etsy_publication_operations','etsy_publication_mutation_admissions'] loop
  execute format('alter table private.%I enable row level security',n);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role',n);
 end loop;
end $$;

create function private.stage18_admitted() returns boolean language sql stable set search_path='' as $$
 select current_user not in ('anon','authenticated','service_role') and exists(select 1 from private.etsy_publication_mutation_admissions where transaction_id=txid_current());
$$;
create function private.stage18_record_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if not private.stage18_admitted() then raise exception 'publication_runtime_managed' using errcode='42501'; end if;
 if tg_op='DELETE' or (tg_table_name='etsy_publication_operations' and tg_op<>'INSERT') then raise exception 'publication_history_immutable'; end if;
 if tg_table_name='etsy_publication_runs' and tg_op='UPDATE' then
  if to_jsonb(new)-array['state','revision','stopped_at','lease_hash','lease_expires_at'] is distinct from to_jsonb(old)-array['state','revision','stopped_at','lease_hash','lease_expires_at'] then raise exception 'publication_identity_immutable'; end if;
  if old.stopped_at is not null and new.stopped_at is distinct from old.stopped_at then raise exception 'publication_stop_immutable'; end if;
 end if;
 return new;
end $$;
create trigger etsy_publication_runs_guard before insert or update or delete on private.etsy_publication_runs for each row execute function private.stage18_record_guard();
create trigger etsy_publication_operations_guard before insert or update or delete on private.etsy_publication_operations for each row execute function private.stage18_record_guard();

-- This fence also applies inside older generic SECURITY DEFINER entry points.
-- It identifies the lane by semantic type AND immutable recorded identities.
create function private.stage18_core_guard() returns trigger language plpgsql set search_path='' as $$
declare a jsonb; b jsonb; protected boolean:=false; inherited boolean:=false;
begin
 if tg_op<>'INSERT' then a:=to_jsonb(old); end if;
 if tg_op<>'DELETE' then b:=to_jsonb(new); end if;
 if tg_table_name='action_intents' then
  protected:=coalesce(a->>'action_type','') like 'etsy.publication.%' or coalesce(b->>'action_type','') like 'etsy.publication.%'
   or a->>'capability'='marketplace.etsy.publish' or b->>'capability'='marketplace.etsy.publish'
   or exists(select 1 from private.etsy_publication_runs where action_intent_id in ((a->>'id')::uuid,(b->>'id')::uuid));
  inherited:=exists(select 1 from private.etsy_publication_runs r join private.etsy_draft_runs d on d.id=r.draft_run_id where d.action_intent_id in ((a->>'id')::uuid,(b->>'id')::uuid));
 elsif tg_table_name='action_receipts' then
  protected:=exists(select 1 from private.etsy_publication_runs where action_intent_id in ((a->>'action_intent_id')::uuid,(b->>'action_intent_id')::uuid) or receipt_id in ((a->>'id')::uuid,(b->>'id')::uuid) or resource_id in ((a->>'external_resource_id')::uuid,(b->>'external_resource_id')::uuid))
   or a->'response_summary'->>'publicationMode'='assisted_api' or b->'response_summary'->>'publicationMode'='assisted_api';
  inherited:=exists(select 1 from private.etsy_publication_runs r where r.draft->>'receiptId' in (a->>'id',b->>'id'));
 elsif tg_table_name='external_resources' then
  protected:=(a->>'provider'='etsy' and coalesce(a->>'resource_type','')='published_listing') or (b->>'provider'='etsy' and coalesce(b->>'resource_type','')='published_listing')
   or exists(select 1 from private.etsy_publication_runs where resource_id in ((a->>'id')::uuid,(b->>'id')::uuid));
  inherited:=exists(select 1 from private.etsy_publication_runs r where r.draft->>'resourceId' in (a->>'id',b->>'id'));
 elsif tg_table_name='owner_interventions' then
  protected:=coalesce(a->>'intervention_type','') like 'etsy.publication.%' or coalesce(b->>'intervention_type','') like 'etsy.publication.%'
   or exists(select 1 from private.etsy_publication_runs where action_intent_id in ((a->>'action_intent_id')::uuid,(b->>'action_intent_id')::uuid));
 elsif tg_table_name='events' then
  protected:=coalesce(a->>'event_type','') like 'etsy.publication.%' or coalesce(b->>'event_type','') like 'etsy.publication.%';
 elsif tg_table_name='etsy_draft_runs' then
  inherited:=exists(select 1 from private.etsy_publication_runs where draft_run_id in ((a->>'id')::uuid,(b->>'id')::uuid));
 end if;
 if inherited and tg_table_name='etsy_draft_runs' and tg_op='UPDATE' then
  inherited:=a-array['lease_hash','lease_expires_at'] is distinct from b-array['lease_hash','lease_expires_at'];
 end if;
 if inherited and tg_op<>'INSERT' and a is distinct from b then raise exception 'publication_draft_history_immutable'; end if;
 if protected then
  if not private.stage18_admitted() then raise exception 'publication_core_runtime_managed' using errcode='42501'; end if;
  if tg_op='DELETE' or (tg_table_name in ('action_receipts','external_resources','events') and tg_op<>'INSERT') then raise exception 'publication_core_provenance_immutable'; end if;
  if tg_table_name='owner_interventions' then
   if tg_op='INSERT' and (b->>'intervention_type' is distinct from 'etsy.publication.reconcile' or b->>'status' is distinct from 'open' or b->'options' is distinct from '[]'::jsonb) then raise exception 'publication_intervention_invalid'; end if;
   if tg_op='UPDATE' and (a->>'status' is distinct from 'open' or b->>'status' is distinct from 'resolved' or b->>'resolved_at' is null
    or coalesce(b->'resolution'->>'result','') not in ('active_listing_verified','stopped_before_dispatch')
    or a-array['status','resolved_at','resolution','updated_at'] is distinct from b-array['status','resolved_at','resolution','updated_at']) then raise exception 'publication_intervention_immutable'; end if;
  end if;
  if tg_table_name='action_intents' and tg_op='UPDATE' and a-array['status','updated_at'] is distinct from b-array['status','updated_at'] then raise exception 'publication_intent_immutable'; end if;
 end if;
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
do $$ declare n text; begin
 foreach n in array array['action_intents','action_receipts','external_resources','events','owner_interventions'] loop
  execute format('create trigger %I before insert or update or delete on public.%I for each row execute function private.stage18_core_guard()','stage18_'||n||'_guard',n);
 end loop;
end $$;
create trigger stage18_draft_history_guard before update or delete on private.etsy_draft_runs for each row execute function private.stage18_core_guard();

create function private.stage18_source(p_business uuid,p_draft uuid,p_fresh boolean default true) returns jsonb language plpgsql set search_path='' as $$
declare d private.etsy_draft_runs%rowtype; c private.etsy_connections%rowtype; l public.listing_runs%rowtype;
 a public.artifacts%rowtype; r public.action_receipts%rowtype; x public.external_resources%rowtype;
 reviewed jsonb; draft jsonb; image jsonb; mapping jsonb;
begin
 select * into strict d from private.etsy_draft_runs where id=p_draft and business_id=p_business and owner_id=auth.uid();
 select * into strict c from private.etsy_connections where id=d.connection_id and business_id=p_business and owner_id=auth.uid();
 if c.status<>'connected' or c.revision is distinct from d.connection_revision or c.shop_id<>d.shop_id then raise exception 'account_access_revoked'; end if;
 if d.state->>'status' is distinct from 'verified' or d.state->>'id' is distinct from d.id::text or d.state->>'businessId' is distinct from p_business::text or d.package->>'businessId' is distinct from p_business::text or d.state->>'listingId' is null or d.package_hash is distinct from private.stage14_hash(d.package)
  or d.package_artifact_id::text is distinct from d.package->>'id' or d.state->>'packageHash' is distinct from d.package_hash
  or d.state->>'shopId' is distinct from d.shop_id::text or d.state->>'connectionId' is distinct from d.connection_id::text
  or d.state->>'connectionRevision' is distinct from d.connection_revision::text or d.state->>'identity' is distinct from d.identity
  or d.state->>'actionIntentId' is distinct from d.action_intent_id::text
  or jsonb_typeof(d.state->'operations') is distinct from 'array' or jsonb_array_length(d.state->'operations')<1
  or exists(select 1 from jsonb_array_elements(d.state->'operations') o where o->>'status' is distinct from 'verified')
  then raise exception 'publication_verified_draft_required'; end if;
 select * into strict a from public.artifacts where id=d.package_artifact_id and business_id=p_business and artifact_type='product.package.v1';
 select * into strict l from public.listing_runs where output_artifact_id=a.id and business_id=p_business and owner_id=auth.uid() and status='completed' and phase='terminal';
 reviewed:=a.content->'reviewedListing';
 if a.content->'product' is distinct from d.package or a.checksum is distinct from d.package_hash
  or coalesce(length(a.content->>'etsyDraftEnvelope'),0)<32 or coalesce(length(a.content->>'listingReviewEnvelope'),0)<32
  or reviewed->>'productPackageHash' is distinct from d.package_hash or reviewed->>'outputArtifactId' is distinct from a.id::text
  or reviewed->>'knowledgeHash' is distinct from l.knowledge_hash or reviewed->'input' is distinct from l.input
  or reviewed->'review'->>'verdict' is distinct from 'APPROVE' or reviewed->'publicationAllowed' is distinct from 'false'::jsonb
  or not exists(select 1 from public.listing_phase_outputs o where o.listing_run_id=l.id and role='reviewer' and o.output=reviewed->'review' and o.execution=reviewed->'reviewer')
  or not exists(select 1 from public.listing_phase_outputs o where o.listing_run_id=l.id and role='specialist' and o.output=reviewed->'proposal' and o.execution=reviewed->'specialist')
  then raise exception 'publication_completed_review_required'; end if;
 select * into strict r from public.action_receipts where id=(d.state->>'receiptId')::uuid and business_id=p_business and action_intent_id=d.action_intent_id
  and external_resource_id=(d.state->>'resourceId')::uuid and provider='etsy' and outcome='succeeded';
 if r.request_fingerprint is distinct from d.package_hash or r.response_summary->>'state' is distinct from 'draft'
  or r.response_summary->>'verifiedBy' is distinct from 'independent_get' or r.response_summary->'publicationAllowed' is distinct from 'false'::jsonb
  or r.response_summary->>'listingId' is distinct from d.state->>'listingId' or r.response_summary->>'shopId' is distinct from d.shop_id::text
  or r.response_summary->>'packageHash' is distinct from d.package_hash or coalesce(r.response_summary->>'responseHash','') !~ '^[a-f0-9]{64}$'
  or not exists(select 1 from public.action_intents where id=d.action_intent_id and business_id=p_business and action_type='etsy.draft.create' and status='completed')
  then raise exception 'publication_draft_receipt_mismatch'; end if;
 select * into strict x from public.external_resources where id=r.external_resource_id and business_id=p_business and provider='etsy' and resource_type='draft_listing' and status='active';
 if x.external_id is distinct from 'shop:'||d.shop_id||':listing:'||(d.state->>'listingId')
  or x.metadata->>'state' is distinct from 'draft' or x.metadata->>'packageHash' is distinct from d.package_hash
  or x.metadata->>'identity' is distinct from d.identity or x.metadata->'publicationAllowed' is distinct from 'false'::jsonb
  then raise exception 'publication_draft_resource_mismatch'; end if;
 if jsonb_typeof(r.response_summary->'imageMappings') is distinct from 'array' or jsonb_array_length(r.response_summary->'imageMappings')<>jsonb_array_length(d.package->'images') then raise exception 'publication_image_mapping_mismatch'; end if;
 for image in select value from jsonb_array_elements(d.package->'images') loop
  if (select count(*) from jsonb_array_elements(r.response_summary->'imageMappings') m where m->>'assetId'=image->>'assetId' and m->>'sha256'=image->>'sha256')<>1 then raise exception 'publication_image_mapping_mismatch'; end if;
  select m into strict mapping from jsonb_array_elements(r.response_summary->'imageMappings') m where m->>'assetId'=image->>'assetId' and m->>'sha256'=image->>'sha256';
  if coalesce((mapping->>'listingImageId')::bigint,0)<=0 or not exists(select 1 from jsonb_array_elements(d.state->'operations') o where o->>'key'='image:'||(image->>'assetId')||':'||(image->>'sha256') and o->'externalId'=mapping->'listingImageId' and o->>'status'='verified') then raise exception 'publication_image_mapping_mismatch'; end if;
 end loop;
 if (select count(*)<>count(distinct m->>'listingImageId') from jsonb_array_elements(r.response_summary->'imageMappings') m) then raise exception 'publication_image_mapping_mismatch'; end if;
 if p_fresh then
  perform private.stage16_assert_package(p_business,d.package);
  perform private.stage17_assert_sources(p_business,l.source_artifact_id,l.source_content_hash,l.input,l.input_hash);
  perform private.stage17_assert_catalog(l.knowledge_hash,l.worker_hashes);
 end if;
 draft:=jsonb_build_object('runId',d.id,'receiptId',r.id,'resourceId',x.id,'packageHash',d.package_hash,'responseHash',r.response_summary->>'responseHash',
  'listingId',(d.state->>'listingId')::bigint,'shopId',d.shop_id,'identity',d.identity,'imageMappings',r.response_summary->'imageMappings','verifiedAt',r.occurred_at);
 return jsonb_build_object('package',d.package,'draft',draft,'draftReceipt',to_jsonb(r),'draftReceiptHash',private.stage14_hash(to_jsonb(r)),
  'review',reviewed,'reviewHash',private.stage14_hash(reviewed),'listingRunId',l.id,'packageHash',d.package_hash,
  'artifactContent',a.content,'packageEnvelope',a.content->>'etsyDraftEnvelope','reviewEnvelope',a.content->>'listingReviewEnvelope','connectionId',c.id,'connectionRevision',c.revision,'shopId',c.shop_id);
end $$;

-- No current Etsy API supplies an authenticated account-specific all-in fee
-- ceiling including tax/FX/mandatory charges. A structurally valid quote is not
-- authority. Only a separately reviewed producer may replace this closed gate.
create function private.stage18_assert_fee_authority(p_business uuid,p_draft uuid,p_quote jsonb) returns void language plpgsql set search_path='' as $$
begin
 raise exception 'publication_all_in_fee_authority_unavailable';
end $$;

create function private.stage18_assert_financial(p_quote jsonb,p_approval jsonb,p_request text,p_approval_hash text,p_disclosure text,p_shop bigint,p_listing bigint,p_quantity integer,p_current boolean default true) returns void language plpgsql set search_path='' as $$
declare k text; total numeric:=0; amount numeric; approved timestamptz; expires timestamptz; quoted timestamptz; quote_expires timestamptz;
begin
 if jsonb_typeof(p_quote) is distinct from 'object' or jsonb_typeof(p_approval) is distinct from 'object'
  or p_quote->>'version' is distinct from '1.0' or p_quote->>'provider' is distinct from 'etsy' or p_quote->>'scope' is distinct from 'one_listing_activation'
  or coalesce(p_quote->>'sourceKind','') not in ('verified_provider_checkout','verified_account_specific_fee_bound')
  or coalesce(p_quote->>'sourceHash','') !~ '^[a-f0-9]{64}$' or nullif(p_quote->>'sourceReceiptId','')::uuid is null
  or p_quote->>'shopId' is distinct from p_shop::text or p_quote->>'listingId' is distinct from p_listing::text
  or coalesce(p_quote->>'billingCurrency','') !~ '^[A-Z]{3}$' then raise exception 'publication_fee_evidence_required'; end if;
 foreach k in array array['listingFeeMinor','taxMinor','fxMinor','otherMandatoryFeesMinor'] loop
  amount:=(p_quote->>k)::numeric;
  if jsonb_typeof(p_quote->k) is distinct from 'number' or amount<>trunc(amount) or amount<0 or amount>9007199254740991 then raise exception 'publication_fee_bound_invalid'; end if;
  total:=total+amount;
 end loop;
 if jsonb_typeof(p_quote->'maximumTotalMinor') is distinct from 'number' or total is distinct from (p_quote->>'maximumTotalMinor')::numeric or total<=0 or total>9007199254740991 then raise exception 'publication_fee_bound_invalid'; end if;
 if nullif(p_approval->>'id','')::uuid is null or p_approval->>'requestHash' is distinct from p_request or p_approval->>'quoteHash' is distinct from private.stage14_hash(p_quote)
  or private.stage14_hash(p_approval) is distinct from p_approval_hash or p_quote->>'disclosureHash' is distinct from p_disclosure or p_approval->>'disclosureHash' is distinct from p_disclosure
  or p_approval->>'billingCurrency' is distinct from p_quote->>'billingCurrency' or jsonb_typeof(p_approval->'maximumTotalMinor') is distinct from 'number'
  or coalesce((p_approval->>'maximumTotalMinor')::numeric,-1)<total or (p_approval->>'maximumTotalMinor')::numeric>9007199254740991 or (p_approval->>'maximumTotalMinor')::numeric<>trunc((p_approval->>'maximumTotalMinor')::numeric)
  or p_approval->>'approvedQuantity' is distinct from p_quantity::text or p_approval->>'paymentMethod' is distinct from 'etsy_payment_account'
  or p_approval->>'commitment' is distinct from 'publish_existing_quantity_manual_renewal' or p_approval->>'dataSharing' is distinct from 'make_exact_reviewed_listing_public'
  then raise exception 'publication_approval_binding_mismatch'; end if;
 approved:=(p_approval->>'approvedAt')::timestamptz; expires:=(p_approval->>'expiresAt')::timestamptz;
 quoted:=(p_quote->>'verifiedAt')::timestamptz; quote_expires:=(p_quote->>'expiresAt')::timestamptz;
 if approved is null or expires is null or quoted is null or quote_expires is null or quoted>approved or approved>clock_timestamp()
  or quote_expires<=approved or expires<=approved or expires>quote_expires or expires>approved+interval '1 hour'
  then raise exception 'publication_approval_time_invalid'; end if;
 if p_current and (expires<=clock_timestamp() or quote_expires<=clock_timestamp()) then raise exception 'publication_approval_expired'; end if;
end $$;

create function private.stage18_view(p_run uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',r.id,'title',r.package->>'title','status',r.state->>'status','providerState',r.state->>'providerState',
  'listingId',r.listing_id,'shopId',r.shop_id,'reason',r.state->'reason','stopRequested',r.stopped_at is not null,
  'approvedAt',r.approved_at,'expiresAt',r.approval_expires_at,'attemptedAt',o.sent_at,
  'verifiedAt',(select occurred_at from public.action_receipts where id=r.receipt_id),
  'feeExposure',r.financial_exposure||jsonb_build_object('chargeStatus',case when o.publication_run_id is null then 'not_attempted' else 'unknown' end))
 from private.etsy_publication_runs r left join private.etsy_publication_operations o on o.publication_run_id=r.id where r.id=p_run;
$$;

create function private.stage18_owner(p_business uuid,p_operation text,p_payload jsonb,p_server_key text) returns jsonb language plpgsql set search_path='' as $$
declare r private.etsy_publication_runs%rowtype; c private.etsy_connections%rowtype; source jsonb; s jsonb; next_activation jsonb; old_activation jsonb;
 v_id uuid:=gen_random_uuid(); intent uuid:=gen_random_uuid(); resource uuid:=gen_random_uuid(); receipt uuid:=gen_random_uuid();
 quote jsonb; approval jsonb; disclosure jsonb; preflight jsonb; request_hash text; expiry timestamptz; result jsonb;
 summary jsonb; actual_receipt jsonb; actual_resource jsonb; target_run uuid;
begin
 if p_operation='workspace' then
  if p_payload ? 'interventionId' then
   if jsonb_typeof(p_payload->'interventionId') is distinct from 'string' or coalesce(p_payload->>'interventionId','') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then raise exception 'publication_intervention_not_found'; end if;
   -- A resolved intervention remains a valid historical link. No arbitrary run
   -- identifier or foreign/ordinary intervention can broaden the owner read.
   select pr.id into target_run from public.owner_interventions oi
    join private.etsy_publication_runs pr on pr.action_intent_id=oi.action_intent_id and pr.business_id=oi.business_id
    join public.action_intents ai on ai.id=pr.action_intent_id and ai.business_id=pr.business_id
    where oi.id=(p_payload->>'interventionId')::uuid and oi.business_id=p_business and oi.intervention_type='etsy.publication.reconcile'
     and pr.business_id=p_business and pr.owner_id=auth.uid() and ai.action_type='etsy.publication.activate' and ai.capability='marketplace.etsy.publish';
   if target_run is null then raise exception 'publication_intervention_not_found'; end if;
  end if;
  return jsonb_build_object('drafts',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'title',d.package->>'title','packageArtifactId',d.package_artifact_id,
   'packageHash',d.package_hash,'listingId',(d.state->>'listingId')::bigint,'shopId',d.shop_id,'quantity',d.package->'quantity','priceMinor',d.package->'priceMinor',
   'currency',d.package->>'currency','verifiedAt',ar.occurred_at) order by d.approved_at desc)
   from private.etsy_draft_runs d join public.action_receipts ar on ar.id=(d.state->>'receiptId')::uuid and ar.business_id=d.business_id
   where d.business_id=p_business and d.owner_id=auth.uid() and d.state->>'status'='verified'
    and not exists(select 1 from private.etsy_publication_runs publication where publication.draft_run_id=d.id)),'[]'::jsonb),
   'runs',coalesce((select jsonb_agg(private.stage18_view(x.id) order by (x.id=target_run) desc nulls last,x.approved_at desc,x.id desc) from (select * from private.etsy_publication_runs where business_id=p_business and owner_id=auth.uid() order by (id=target_run) desc nulls last,approved_at desc,id desc limit 50) x),'[]'::jsonb),
   'feeAuthorityAvailable',false,'feeBlocker','publication_all_in_fee_authority_unavailable');
 end if;
 if p_operation='cancel' then
  select * into strict r from private.etsy_publication_runs where id=(p_payload->>'runId')::uuid and business_id=p_business and owner_id=auth.uid() for update;
  if r.state->>'status'='verified' or r.stopped_at is not null then return private.stage18_view(r.id); end if;
  s:=r.state||jsonb_build_object('status',case when r.state->'activation'='null'::jsonb then 'cancelled' else 'needs_owner' end,'stopRequested',true,
   'reason',case when r.state->'activation'='null'::jsonb then 'owner_cancel' else 'owner_cancel_after_dispatch' end);
  update private.etsy_publication_runs set stopped_at=clock_timestamp(),state=s where id=r.id;
  update public.action_intents set status=case when r.state->'activation'='null'::jsonb then 'expired' when r.state->>'status'='failed' and r.state->'activation'->>'status'='rejected' then 'failed' else 'executing' end where id=r.action_intent_id;
  if r.state->'activation'='null'::jsonb then
   update public.owner_interventions set status='resolved',resolved_at=clock_timestamp(),resolution='{"result":"stopped_before_dispatch","activationSent":false,"unpublishedClaimed":false}' where action_intent_id=r.action_intent_id and status='open';
  else
   if not exists(select 1 from public.owner_interventions where action_intent_id=r.action_intent_id and status='open') then
    insert into public.owner_interventions(business_id,action_intent_id,intervention_type,status,title,description,options)
     values(p_business,r.action_intent_id,'etsy.publication.reconcile','open','Etsy publication needs verification',
      'The saved publication could not be verified. A dispatched request may have activated the listing and incurred a fee. Review the saved result and use read-only verification. Stopping does not unpublish a listing or reverse a charge. No automatic repeat is permitted.','[]');
   end if;
  end if;
  insert into public.events(business_id,event_type,actor_type,actor_id,payload) values(p_business,'etsy.publication.stopped','owner',auth.uid()::text,jsonb_build_object('runId',r.id,'activationSent',r.state->'activation'<>'null'::jsonb,'unpublishedClaimed',false));
  return private.stage18_view(r.id);
 end if;
 if length(p_server_key)<32 or not exists(select 1 from private.etsy_server_authority where enabled and key_hash=private.stage13_hash(p_server_key)) then raise exception 'server_authority_required' using errcode='42501'; end if;
 perform 1 from public.businesses where id=p_business for update;
 if p_operation='source' then return private.stage18_source(p_business,(p_payload->>'draftRunId')::uuid,true); end if;
 if p_operation='prepare' then
  if p_payload->'approvePublication' is distinct from 'true'::jsonb or p_payload->'approveFee' is distinct from 'true'::jsonb then raise exception 'publication_and_fee_consent_required'; end if;
  -- A replay returns the original immutable run and never resets its approval,
  -- marker, resource identity or financial exposure.
  select * into r from private.etsy_publication_runs where draft_run_id=(p_payload->>'draftRunId')::uuid and business_id=p_business and owner_id=auth.uid();
  if r.id is not null then
   if r.approval_hash is distinct from p_payload->>'approvalHash' or r.request_hash is distinct from p_payload->>'requestHash' then raise exception 'publication_approval_replay_mismatch'; end if;
   return jsonb_build_object('runId',r.id,'created',false);
  end if;
  source:=private.stage18_source(p_business,(p_payload->>'draftRunId')::uuid,true);
  if source->>'packageHash' is distinct from p_payload->>'packageHash' or source->>'reviewHash' is distinct from p_payload->>'reviewHash'
   or source->>'draftReceiptHash' is distinct from p_payload->>'draftReceiptHash' or source->>'connectionRevision' is distinct from p_payload->>'connectionRevision'
   then raise exception 'publication_source_binding_mismatch'; end if;
  if source->'package'->'quantity' is distinct from '1'::jsonb then raise exception 'publication_single_quantity_required'; end if;
  preflight:=p_payload->'preflight'; disclosure:=p_payload->'disclosure'; quote:=p_payload->'feeEvidence'; approval:=p_payload->'approval';
  if jsonb_typeof(preflight) is distinct from 'object' or private.stage14_hash(preflight) is distinct from p_payload->>'preflightHash'
   or preflight->'quantity' is distinct from '1'::jsonb or preflight->'shouldAutoRenew' is distinct from 'false'::jsonb
   or preflight->'shippingProfileId' is distinct from source->'package'->'shippingProfileId'
   or coalesce((preflight->>'returnPolicyId')::bigint,0)<=0 or jsonb_typeof(preflight->'shippingProfile') is distinct from 'object'
   or jsonb_typeof(preflight->'returnPolicy') is distinct from 'object' or jsonb_typeof(preflight->'processingProfile') is distinct from 'object' or jsonb_typeof(disclosure) is distinct from 'object'
   or private.stage14_hash(disclosure) is distinct from p_payload->>'disclosureHash' then raise exception 'publication_preflight_or_disclosure_invalid'; end if;
  if preflight->'shippingProfile'->>'profile_type' is distinct from 'manual' then raise exception 'publication_calculated_shipping_not_supported'; end if;
  request_hash:=private.stage14_hash(jsonb_build_object('version','etsy-assisted-publication-1.0','businessId',p_business,'connectionId',source->'connectionId',
   'connectionRevision',source->'connectionRevision','shopId',source->'shopId','listingId',source->'draft'->'listingId','identity',source->'draft'->>'identity',
   'packageHash',source->>'packageHash','reviewHash',source->>'reviewHash','draftReceiptHash',source->>'draftReceiptHash','disclosureHash',p_payload->>'disclosureHash',
   'preflightHash',p_payload->>'preflightHash','method','PATCH','path','/shops/'||(source->>'shopId')||'/listings/'||(source->'draft'->>'listingId'),'body','{"state":"active"}'::jsonb));
  if request_hash is distinct from p_payload->>'requestHash' then raise exception 'publication_request_binding_mismatch'; end if;
  perform private.stage18_assert_financial(quote,approval,request_hash,p_payload->>'approvalHash',p_payload->>'disclosureHash',(source->>'shopId')::bigint,(source->'draft'->>'listingId')::bigint,1,true);
  perform private.stage18_assert_fee_authority(p_business,(p_payload->>'draftRunId')::uuid,quote);
  expiry:=least((approval->>'expiresAt')::timestamptz,(source->'package'->>'expiresAt')::timestamptz);
  s:=jsonb_build_object('id',v_id,'businessId',p_business,'connectionId',source->'connectionId','connectionRevision',source->'connectionRevision','shopId',source->'shopId',
   'actionIntentId',intent,'resourceId',resource,'receiptId',receipt,'packageHash',source->>'packageHash','reviewHash',source->>'reviewHash','draftReceiptHash',source->>'draftReceiptHash',
   'approvalHash',p_payload->>'approvalHash','disclosureHash',p_payload->>'disclosureHash','preflightHash',p_payload->>'preflightHash','requestHash',request_hash,
   'identity',source->'draft'->>'identity','listingId',source->'draft'->'listingId','status','ready','reason',null,'stopRequested',false,'providerState','unknown','activation',null);
  insert into public.action_intents(id,business_id,action_type,capability,status,request,risk,financial_impact,idempotency_key,created_by_type,created_by_id)
   values(intent,p_business,'etsy.publication.activate','marketplace.etsy.publish','approved',jsonb_build_object('runId',v_id,'draftRunId',p_payload->>'draftRunId',
    'packageHash',source->>'packageHash','reviewHash',source->>'reviewHash','draftReceiptHash',source->>'draftReceiptHash','approvalHash',p_payload->>'approvalHash',
    'requestHash',request_hash,'connectionId',source->'connectionId','connectionRevision',source->'connectionRevision','shopId',source->'shopId','listingId',source->'draft'->'listingId'),
    jsonb_build_object('publicationMode','assisted_api','singleAttempt',true,'automaticRetry',false,'quantity',1,'manualRenewal',true),
    jsonb_build_object('billingCurrency',quote->>'billingCurrency','maximumTotalMinor',approval->'maximumTotalMinor','chargeStatus','not_attempted','knownChargeMinor',null),
    'etsy-publication:'||(source->>'shopId')||':'||(source->'draft'->>'listingId'),'owner',auth.uid()::text);
  insert into private.etsy_publication_runs(id,business_id,owner_id,draft_run_id,listing_run_id,connection_id,connection_revision,shop_id,listing_id,package_artifact_id,
   package_hash,review_hash,draft_receipt_hash,approval_hash,disclosure_hash,request_hash,preflight_hash,preflight,package,draft,approval,disclosure,fee_evidence,financial_exposure,action_intent_id,resource_id,receipt_id,state,approval_expires_at)
  values(v_id,p_business,auth.uid(),(p_payload->>'draftRunId')::uuid,(source->>'listingRunId')::uuid,(source->>'connectionId')::uuid,(source->>'connectionRevision')::uuid,
   (source->>'shopId')::bigint,(source->'draft'->>'listingId')::bigint,(source->'package'->>'id')::uuid,source->>'packageHash',source->>'reviewHash',source->>'draftReceiptHash',
   p_payload->>'approvalHash',p_payload->>'disclosureHash',request_hash,p_payload->>'preflightHash',preflight,source->'package',source->'draft',approval,disclosure,quote,
   jsonb_build_object('billingCurrency',quote->>'billingCurrency','maximumTotalMinor',approval->'maximumTotalMinor','knownChargeMinor',null,'quoteHash',private.stage14_hash(quote)),
   intent,resource,receipt,s,expiry);
  insert into public.events(business_id,event_type,actor_type,actor_id,payload) values(p_business,'etsy.publication.approved','owner',auth.uid()::text,jsonb_build_object('runId',v_id,'listingId',source->'draft'->'listingId','requestHash',request_hash));
  return jsonb_build_object('runId',v_id,'created',true);
 end if;
 select * into strict r from private.etsy_publication_runs where id=(p_payload->>'runId')::uuid and business_id=p_business and owner_id=auth.uid() for update;
 if p_operation='acquire' then
  if r.lease_expires_at>clock_timestamp() then raise exception 'publication_in_progress'; end if;
  if coalesce(length(p_payload->>'lease'),0) not between 32 and 512 then raise exception 'invalid_lease'; end if;
  update private.etsy_publication_runs set lease_hash=private.stage13_hash(p_payload->>'lease'),lease_expires_at=clock_timestamp()+interval '10 minutes' where id=r.id;
  return jsonb_build_object('state',r.state,'revision',r.revision);
 end if;
 if r.lease_hash is distinct from private.stage13_hash(p_payload->>'lease') or coalesce(r.lease_expires_at,'-infinity')<=clock_timestamp() then raise exception 'publication_lease_expired'; end if;
 if p_operation='release' then
  update private.etsy_publication_runs set lease_hash=null,lease_expires_at=null where id=r.id; return '{}'::jsonb;
 elsif p_operation='guard' then
  if coalesce(p_payload->>'mode','') not in ('publish','reconcile') then raise exception 'publication_guard_mode_required'; end if;
  source:=private.stage18_source(p_business,r.draft_run_id,p_payload->>'mode'='publish');
  if source->>'packageHash' is distinct from r.package_hash or source->>'reviewHash' is distinct from r.review_hash or source->>'draftReceiptHash' is distinct from r.draft_receipt_hash then raise exception 'publication_source_binding_mismatch'; end if;
  if p_payload->>'mode'='publish' then
   if r.stopped_at is not null or r.approval_expires_at<=clock_timestamp() or r.state->>'status' in ('cancelled','failed','verified') then raise exception 'publication_stopped_or_approval_expired'; end if;
   perform private.stage18_assert_financial(r.fee_evidence,r.approval,r.request_hash,r.approval_hash,r.disclosure_hash,r.shop_id,r.listing_id,1,true);
   perform private.stage18_assert_fee_authority(p_business,r.draft_run_id,r.fee_evidence);
  end if;
  return source||jsonb_build_object('financial',jsonb_build_object('quote',r.fee_evidence,'approval',r.approval),'approvalHash',r.approval_hash,
   'disclosureHash',r.disclosure_hash,'disclosure',r.disclosure,'requestHash',r.request_hash,'preflightHash',r.preflight_hash,'preflight',r.preflight,'stopRequested',r.stopped_at is not null);
 elsif p_operation in ('save','finish') then
  if (p_payload->>'revision')::integer is distinct from r.revision then raise exception 'stale_publication_revision'; end if;
  s:=p_payload->'state'; old_activation:=r.state->'activation'; next_activation:=s->'activation';
  if jsonb_typeof(s) is distinct from 'object' or s-array['status','reason','stopRequested','providerState','activation'] is distinct from r.state-array['status','reason','stopRequested','providerState','activation']
   or coalesce(s->>'status','') not in ('ready','running','needs_owner','verified','cancelled','failed')
   or coalesce(s->>'providerState','') not in ('unknown','draft','active','inactive','sold_out','expired')
   or jsonb_typeof(s->'stopRequested') is distinct from 'boolean' or coalesce(jsonb_typeof(s->'reason'),'') not in ('null','string') or (s->'reason'<>'null'::jsonb and coalesce(length(s->>'reason'),0) not between 1 and 160)
   then raise exception 'publication_state_identity_immutable'; end if;
  if r.state->>'status'='verified' then
   if s is distinct from r.state then raise exception 'publication_verified_immutable'; end if;
   return jsonb_build_object('state',r.state,'revision',r.revision);
  end if;
  if old_activation='null'::jsonb and next_activation<>'null'::jsonb then
   if p_operation='finish' or next_activation->>'key' is distinct from 'activate' or next_activation->>'status' is distinct from 'sent'
    or next_activation->>'requestHash' is distinct from r.request_hash or next_activation->'responseHash' is distinct from 'null'::jsonb
    or next_activation->'reason' is distinct from 'null'::jsonb or next_activation-array['key','requestHash','status','sentAt','responseHash','reason']<>'{}'::jsonb
    or coalesce((next_activation->>'sentAt')::timestamptz,'-infinity')<r.approved_at or (next_activation->>'sentAt')::timestamptz>clock_timestamp()+interval '5 seconds'
    then raise exception 'publication_sent_marker_required'; end if;
   if r.stopped_at is not null or r.approval_expires_at<=clock_timestamp() or r.state->>'status' in ('cancelled','failed') then raise exception 'publication_stopped_or_approval_expired'; end if;
   source:=private.stage18_source(p_business,r.draft_run_id,true);
   if source->>'packageHash' is distinct from r.package_hash or source->>'reviewHash' is distinct from r.review_hash or source->>'draftReceiptHash' is distinct from r.draft_receipt_hash then raise exception 'publication_source_binding_mismatch'; end if;
   perform private.stage18_assert_financial(r.fee_evidence,r.approval,r.request_hash,r.approval_hash,r.disclosure_hash,r.shop_id,r.listing_id,1,true);
   perform private.stage18_assert_fee_authority(p_business,r.draft_run_id,r.fee_evidence);
   insert into private.etsy_publication_operations(publication_run_id,business_id,request_hash,sent_at,marker) values(r.id,p_business,r.request_hash,(next_activation->>'sentAt')::timestamptz,next_activation);
   update public.action_intents set status='executing' where id=r.action_intent_id;
  elsif old_activation<>'null'::jsonb then
   if next_activation is null or next_activation='null'::jsonb or next_activation-array['status','responseHash','reason'] is distinct from old_activation-array['status','responseHash','reason']
    or coalesce(next_activation->>'status','') not in ('sent','accepted','rejected','verified')
    or (old_activation->>'status' in ('accepted','rejected') and next_activation->>'status' not in (old_activation->>'status','verified'))
    or (old_activation->>'responseHash' is not null and next_activation->'responseHash' is distinct from old_activation->'responseHash')
    then raise exception 'publication_attempt_cannot_be_reset'; end if;
   if next_activation->>'responseHash' is not null and next_activation->>'responseHash' !~ '^[a-f0-9]{64}$' then raise exception 'publication_response_hash_invalid'; end if;
  elsif next_activation is distinct from 'null'::jsonb then raise exception 'publication_activation_invalid'; end if;
  if s->>'status'='verified' and p_operation<>'finish' then raise exception 'publication_readback_required'; end if;
  if r.state->>'providerState'='active' and s->>'providerState'<>'active' then raise exception 'publication_observed_active_immutable'; end if;
  if s->>'providerState'='active' and s->>'status'='cancelled' then raise exception 'publication_active_not_unpublished'; end if;
  if s->>'status'='failed' and next_activation<>'null'::jsonb and (next_activation->>'status'<>'rejected' or s->>'providerState'='active') then raise exception 'publication_failure_requires_rejection'; end if;
  if s->>'status'='cancelled' and next_activation<>'null'::jsonb then raise exception 'publication_dispatched_requires_reconciliation'; end if;
  if r.stopped_at is not null then
   s:=s||jsonb_build_object('stopRequested',true);
   if p_operation<>'finish' then s:=s||jsonb_build_object('status',case when next_activation='null'::jsonb then 'cancelled' else 'needs_owner' end); end if;
  elsif s->'stopRequested'='true'::jsonb then raise exception 'publication_stop_requires_cancel'; end if;
  if p_operation='finish' then
   -- Completion is a read-only reconciliation result. It may settle a dispatched
   -- attempt after stop/expiry without authorizing another PATCH or claiming undo.
   source:=private.stage18_source(p_business,r.draft_run_id,false);
   if source->>'packageHash' is distinct from r.package_hash or source->>'reviewHash' is distinct from r.review_hash or source->>'draftReceiptHash' is distinct from r.draft_receipt_hash then raise exception 'publication_source_binding_mismatch'; end if;
   if not exists(select 1 from private.etsy_publication_operations op where op.publication_run_id=r.id and op.request_hash=r.request_hash)
    or s->>'status' is distinct from 'verified' or s->>'providerState' is distinct from 'active' or next_activation->>'status' is distinct from 'verified'
    then raise exception 'publication_sent_and_readback_required'; end if;
   actual_receipt:=p_payload->'receipt'; actual_resource:=p_payload->'resource'; summary:=actual_receipt->'responseSummary';
   if actual_receipt->>'id' is distinct from r.receipt_id::text or actual_receipt->>'businessId' is distinct from p_business::text
    or actual_receipt->>'actionIntentId' is distinct from r.action_intent_id::text or actual_receipt->>'externalResourceId' is distinct from r.resource_id::text
    or actual_receipt->'attempt' is distinct from '1'::jsonb or actual_receipt->>'outcome' is distinct from 'succeeded' or actual_receipt->>'provider' is distinct from 'etsy'
    or actual_receipt->>'requestFingerprint' is distinct from r.request_hash or summary->>'state' is distinct from 'active'
    or summary->>'verifiedBy' is distinct from 'independent_get'
    or summary->>'listingId' is distinct from r.listing_id::text or summary->>'shopId' is distinct from r.shop_id::text
    or summary->>'packageHash' is distinct from r.package_hash or summary->>'reviewHash' is distinct from r.review_hash
    or summary->>'draftReceiptHash' is distinct from r.draft_receipt_hash or summary->>'approvalHash' is distinct from r.approval_hash
    or summary->>'disclosureHash' is distinct from r.disclosure_hash or summary->>'preflightHash' is distinct from r.preflight_hash
    or summary->>'requestHash' is distinct from r.request_hash or coalesce(summary->>'responseHash','') !~ '^[a-f0-9]{64}$'
    or summary->'imageMappings' is distinct from r.draft->'imageMappings'
    then raise exception 'publication_receipt_binding_invalid'; end if;
   if actual_resource->>'id' is distinct from r.resource_id::text or actual_resource->>'businessId' is distinct from p_business::text
    or actual_resource->>'provider' is distinct from 'etsy' or actual_resource->>'resourceType' is distinct from 'published_listing'
    or actual_resource->>'externalId' is distinct from 'shop:'||r.shop_id||':listing:'||r.listing_id or actual_resource->>'status' is distinct from 'active'
    or actual_resource->>'canonicalUrl' is distinct from 'https://www.etsy.com/listing/'||r.listing_id
    or actual_resource->'metadata'->>'state' is distinct from 'active' or actual_resource->'metadata'->>'packageHash' is distinct from r.package_hash
    or actual_resource->'metadata'->>'listingId' is distinct from r.listing_id::text or actual_resource->'metadata'->>'shopId' is distinct from r.shop_id::text
    then raise exception 'publication_resource_binding_invalid'; end if;
   if summary->>'feeStatus' is distinct from 'unreconciled' or summary->'feeAmountMinor' is distinct from 'null'::jsonb or summary->'feeCurrency' is distinct from 'null'::jsonb
    or summary->'approvedMaximumTotalMinor' is distinct from r.approval->'maximumTotalMinor' or summary->>'approvedBillingCurrency' is distinct from r.approval->>'billingCurrency'
    or summary->'stopRequested' is distinct from to_jsonb(r.stopped_at is not null) then raise exception 'publication_fee_charge_unknown'; end if;
   insert into public.external_resources(id,business_id,provider,resource_type,external_id,status,canonical_url,metadata)
    values(r.resource_id,p_business,'etsy','published_listing','shop:'||r.shop_id||':listing:'||r.listing_id,'active','https://www.etsy.com/listing/'||r.listing_id,actual_resource->'metadata');
   insert into public.action_receipts(id,business_id,action_intent_id,external_resource_id,attempt,outcome,provider,request_fingerprint,response_summary)
    values(r.receipt_id,p_business,r.action_intent_id,r.resource_id,1,'succeeded','etsy',r.request_hash,summary);
   update public.action_intents set status='completed' where id=r.action_intent_id;
   update public.owner_interventions set status='resolved',resolved_at=clock_timestamp(),resolution=jsonb_build_object('result','active_listing_verified','feeStatus','unreconciled','stopRequested',r.stopped_at is not null) where action_intent_id=r.action_intent_id and status='open';
   insert into public.events(business_id,event_type,actor_type,payload) values(p_business,'etsy.publication.verified','system',jsonb_build_object('runId',r.id,'listingId',r.listing_id,'stopRequested',r.stopped_at is not null,'feeChargeStatus','unknown'));
  end if;
  if p_operation='save' then
   if s->>'status'='failed' or (next_activation->>'status'='rejected' and s->>'providerState'<>'active') then
    update public.action_intents set status='failed' where id=r.action_intent_id;
   elsif s->>'status'='cancelled' and next_activation='null'::jsonb then
    update public.action_intents set status='expired' where id=r.action_intent_id;
   elsif next_activation<>'null'::jsonb then
    update public.action_intents set status='executing' where id=r.action_intent_id;
   end if;
  end if;
  if s->>'status'='needs_owner' then
   if not exists(select 1 from public.owner_interventions where action_intent_id=r.action_intent_id and status='open') then
    insert into public.owner_interventions(business_id,action_intent_id,intervention_type,status,title,description,options)
     values(p_business,r.action_intent_id,'etsy.publication.reconcile','open','Etsy publication needs verification',
      'The saved publication could not be verified. A dispatched request may have activated the listing and incurred a fee. Review the saved result and use read-only verification. Stopping does not unpublish a listing or reverse a charge. No automatic repeat is permitted.','[]');
   end if;
  end if;
  update private.etsy_publication_runs set state=s,revision=revision+1 where id=r.id;
  return jsonb_build_object('state',s,'revision',r.revision+1);
 end if;
 raise exception 'publication_operation_invalid';
end $$;

create function public.etsy_publication_owner_transition(p_business_id uuid,p_operation text,p_payload jsonb default '{}',p_server_key text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.is_business_owner(p_business_id) then raise exception 'owner_required' using errcode='42501'; end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>600000 then raise exception 'publication_request_invalid'; end if;
 insert into private.etsy_publication_mutation_admissions values(txid_current());
 result:=private.stage18_owner(p_business_id,p_operation,p_payload,p_server_key);
 delete from private.etsy_publication_mutation_admissions where transaction_id=txid_current();
 return result;
end $$;
revoke all on function public.etsy_publication_owner_transition(uuid,text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.etsy_publication_owner_transition(uuid,text,jsonb,text) to authenticated;
revoke all on function private.stage18_admitted(),private.stage18_record_guard(),private.stage18_core_guard(),private.stage18_source(uuid,uuid,boolean),private.stage18_assert_fee_authority(uuid,uuid,jsonb),private.stage18_assert_financial(jsonb,jsonb,text,text,text,bigint,bigint,integer,boolean),private.stage18_view(uuid),private.stage18_owner(uuid,text,jsonb,text) from public,anon,authenticated,service_role;
