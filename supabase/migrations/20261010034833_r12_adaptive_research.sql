-- Additive adaptive research authority.  The existing owner-initial and
-- owner-episode formats retain their exact five-call, zero-repair semantics.
-- This migration creates no grant, activation, action, request or enrollment.
begin;

-- A fresh reviewed grant on the existing cumulative root is required. Old
-- continuation grants do not acquire adaptive authority by renewal.
alter table private.r12_owner_bootstrap_grants add column adaptive_bounds jsonb;
alter table private.r12_owner_bootstrap_grants add constraint r12_owner_adaptive_bounds_exact check(adaptive_bounds is null or (
 jsonb_typeof(adaptive_bounds)='object' and adaptive_bounds ?& array['version','goalId','goalRevision','goalHash','profileHash','maximumActions','maximumRunMicrounits','expiresAt','rootRevision','rootRevisionHash','allowsPaidFollowups']
 and adaptive_bounds-array['version','goalId','goalRevision','goalHash','profileHash','maximumActions','maximumRunMicrounits','expiresAt','rootRevision','rootRevisionHash','allowsPaidFollowups']='{}'::jsonb
 and adaptive_bounds->>'version'='r12.owner-adaptive-grant.1'
 and adaptive_bounds->>'goalId' ~ '^[a-f0-9-]{36}$'
 and jsonb_typeof(adaptive_bounds->'goalRevision')='number' and adaptive_bounds->>'goalRevision' ~ '^[1-9][0-9]{0,8}$'
 and adaptive_bounds->>'goalHash' ~ '^[a-f0-9]{64}$' and adaptive_bounds->>'profileHash' ~ '^[a-f0-9]{64}$'
 and jsonb_typeof(adaptive_bounds->'maximumActions')='number' and (adaptive_bounds->>'maximumActions')::integer between 1 and 10
 and jsonb_typeof(adaptive_bounds->'maximumRunMicrounits')='string' and adaptive_bounds->>'maximumRunMicrounits' ~ '^[1-9][0-9]{0,7}$'
 and (adaptive_bounds->>'maximumRunMicrounits')::bigint between 1 and 10000000
 and jsonb_typeof(adaptive_bounds->'rootRevision')='number' and adaptive_bounds->>'rootRevision' ~ '^[1-9][0-9]?$'
 and adaptive_bounds->>'rootRevisionHash' ~ '^[a-f0-9]{64}$'
 and adaptive_bounds->'allowsPaidFollowups'='true'::jsonb
 and jsonb_typeof(adaptive_bounds->'expiresAt')='string' and isfinite((adaptive_bounds->>'expiresAt')::timestamptz)
 and (adaptive_bounds->>'expiresAt')::timestamptz>valid_from and (adaptive_bounds->>'expiresAt')::timestamptz<=valid_until
 and continuation_bounds is null and root_revision is not null
 and (adaptive_bounds->>'rootRevision')::integer=root_revision and adaptive_bounds->>'rootRevisionHash'=root_revision_hash));

create function private.r12_adaptive_grant_check(g private.r12_owner_bootstrap_grants,p private.r12_owner_profiles,
 goal private.r04_goal_versions,root private.r12_owner_grant_roots,at_time timestamptz) returns jsonb
 language plpgsql set search_path='' as $$
declare v jsonb:=g.adaptive_bounds;revision jsonb;rv private.r12_owner_grant_root_revisions;begin
 if g.id is null or v is null or p.id is null or goal.goal_id is null or root.id is null
 or g.root_id is distinct from root.id or g.profile_id is distinct from p.id
 or g.business_id is distinct from goal.business_id or g.owner_id is distinct from (select owner_user_id from public.businesses where id=g.business_id)
 or v->>'goalId' is distinct from goal.goal_id::text or (v->>'goalRevision')::integer<>goal.revision
 or v->>'goalHash' is distinct from goal.content_hash or v->>'profileHash' is distinct from p.profile_hash
 or g.valid_from>at_time or g.valid_until<=at_time or (v->>'expiresAt')::timestamptz<=at_time
 or exists(select 1 from private.r12_owner_grant_revocations r where r.grant_id=g.id and r.created_at<=at_time)
 then raise exception 'r12_adaptive_grant_unavailable';end if;
 select r.* into rv from private.r12_owner_grant_root_revisions r where r.root_id=root.id order by r.revision desc limit 1;
 if rv.root_id is null or rv.revision is distinct from g.root_revision
 or rv.content_hash is distinct from g.root_revision_hash or rv.expires_at<=at_time
 then raise exception 'r12_adaptive_grant_root_stale';end if;
 revision:=jsonb_build_object('rootId',root.id,'revision',rv.revision,'hash',rv.content_hash,
  'maximumScopes',rv.maximum_scopes,'maximumAllocationMicrounits',rv.maximum_allocation_microunits::text,
  'expiresAt',rv.expires_at);
 if revision is null or revision->>'hash' is distinct from v->>'rootRevisionHash'
 or (revision->>'revision')::integer<>(v->>'rootRevision')::integer
 or (revision->>'maximumAllocationMicrounits')::bigint<(v->>'maximumRunMicrounits')::bigint
 or (revision->>'expiresAt')::timestamptz<(v->>'expiresAt')::timestamptz
 then raise exception 'r12_adaptive_grant_root_stale';end if;
 return revision;
end $$;

-- Preserve the legacy extension guard's body except its grant-type gate. It
-- still checks the latest root revision, expiry and cumulative maxima.
do $adaptive_grant_patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_owner_extension_grant_guard()'::regprocedure);
 if position('or new.continuation_bounds is null' in d)=0 then raise exception 'r12_adaptive_extension_guard_changed';end if;
 d:=replace(d,'or new.continuation_bounds is null',
  'or (new.continuation_bounds is null and new.adaptive_bounds is null) or (new.continuation_bounds is not null and new.adaptive_bounds is not null)');
 d:=replace(d,$old$or (new.continuation_bounds->>'expiresAt')::timestamptz>rv.expires_at$old$,
  $new$or coalesce((new.continuation_bounds->>'expiresAt')::timestamptz,(new.adaptive_bounds->>'expiresAt')::timestamptz)>rv.expires_at$new$);
 execute d;
end $adaptive_grant_patch$;

-- Version 2 retains every catalog/pin/source check of version 1 and changes
-- only the reviewed run ceiling. A drifted predecessor fails migration.
do $adaptive_profile_patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_owner_profile_check(private.r12_owner_profiles,timestamp with time zone)'::regprocedure);
 if position($needle$v->>'version' is distinct from 'r12.owner-research-profile.1'$needle$ in d)=0
 or position($needle$v->>'maximumRunMicrousd' !~ '^[1-9][0-9]{0,6}$'$needle$ in d)=0
 or position($needle$(v->>'maximumRunMicrousd')::bigint not between 1 and 2000000$needle$ in d)=0
 or position($needle$private.r04_strings(v->'allowedDomains',4)$needle$ in d)=0
 then raise exception 'r12_adaptive_profile_source_changed';end if;
 d:=replace(d,'private.r12_owner_profile_check(', 'private.r12_adaptive_profile_check(');
 d:=replace(d,$old$'r12.owner-research-profile.1'$old$,$new$'r12.owner-research-profile.2'$new$);
 d:=replace(d,$old$'^[1-9][0-9]{0,6}$'$old$,$new$'^[1-9][0-9]{0,7}$'$new$);
 d:=replace(d,'not between 1 and 2000000','not between 1 and 10000000');
 d:=replace(d,$old$private.r04_strings(v->'allowedDomains',4)$old$,
  $new$private.r04_strings(v->'allowedDomains',6)$new$);
 execute d;
end $adaptive_profile_patch$;

create function private.r12_adaptive_quote_check(q jsonb,reviewed jsonb default null) returns void
 language plpgsql set search_path='' as $$
declare phase text;v bigint;route_name text;rate_name text;source_name text;limit_name text;begin
 perform private.r04_safe(q);
 perform private.r04_keys(q,array['version','baseQuoteHash','luna','reviewer','ceilings','maximumRunMicrousd','maximumExtraActions','requestBytes','outputTokens','retention','proposalOnly','dispatchAuthorized','quoteHash','verifiedAt','validUntil']);
 if q->>'version' is distinct from 'r12.adaptive-quote.1' or q->>'baseQuoteHash' !~ '^[a-f0-9]{64}$'
 or q->'maximumRunMicrousd' is distinct from to_jsonb(10000000) or q->'maximumExtraActions' is distinct from to_jsonb(10)
 or q->'proposalOnly' is distinct from 'true'::jsonb or q->'dispatchAuthorized' is distinct from 'false'::jsonb
 or q->>'quoteHash' is distinct from private.stage14_hash(q-array['quoteHash','verifiedAt','validUntil'])
 or (q->>'verifiedAt')::timestamptz>clock_timestamp() or (q->>'validUntil')::timestamptz<=clock_timestamp()
 or (q->>'validUntil')::timestamptz-(q->>'verifiedAt')::timestamptz>interval '5 minutes'
 or q->'retention' is distinct from '{"inference":"no_training_zdr","search":"query_retention_improvement_training_possible","schemas":"static_nonprivate_schema_only"}'::jsonb
 or q->'luna'->>'canonicalModelId' is distinct from 'openai/gpt-5.6-luna-20260709'
 or q->'luna'->'acceptedResponseModelIds' is distinct from '["openai/gpt-5.6-luna","openai/gpt-5.6-luna-20260709"]'::jsonb
 or q->'reviewer'->>'canonicalModelId' is distinct from 'anthropic/claude-4.5-haiku-20251001'
 or q->'reviewer'->'acceptedResponseModelIds' is distinct from '["anthropic/claude-haiku-4.5","anthropic/claude-4.5-haiku-20251001"]'::jsonb
 or q->'luna'->>'modelId' is distinct from 'openai/gpt-5.6-luna' or q->'luna'->>'endpoint' is distinct from 'azure/us'
 or q->'luna'->>'providerName' is distinct from 'Azure'
 or q->'reviewer'->>'modelId' is distinct from 'anthropic/claude-haiku-4.5' or q->'reviewer'->>'endpoint' is distinct from 'amazon-bedrock/us'
 or q->'reviewer'->>'providerName' is distinct from 'Amazon Bedrock'
 or q->'requestBytes' is distinct from '{"plan":24576,"search":8192,"select":24576,"strategy":65536,"review":65536}'::jsonb
 or q->'outputTokens' is distinct from '{"plan":1500,"search":4000,"select":1000,"strategy":5000,"review":4000}'::jsonb
 then raise exception 'r12_adaptive_fresh_quote_required';end if;
 perform private.r04_keys(q->'ceilings',array['plan','search','select','strategy','review']);
 foreach phase in array array['plan','search','select','strategy','review'] loop
  if jsonb_typeof(q->'ceilings'->phase) is distinct from 'number' or q->'ceilings'->>phase !~ '^[1-9][0-9]{0,7}$'
  then raise exception 'r12_adaptive_quote_ceiling_invalid';end if;
  v:=(q->'ceilings'->>phase)::bigint;
  if v>10000000 or (reviewed is not null and v>(reviewed->'ceilings'->>phase)::bigint)
  then raise exception 'r12_adaptive_quote_exceeds_reviewed';end if;
 end loop;
 foreach route_name in array array['luna','reviewer'] loop
  perform private.r04_keys(q->route_name,array['modelId','canonicalModelId','endpoint','providerName',
   'acceptedResponseModelIds','tokenPricesUsd','priceLimit','sourceHashes']);
  perform private.r04_keys(q->route_name->'tokenPricesUsd',array['prompt','completion','cacheRead','cacheWrite','reasoning']);
  perform private.r04_keys(q->route_name->'priceLimit',array['prompt','completion','request']);
  if route_name='luna' then
   perform private.r04_keys(q->route_name->'sourceHashes',array['modelIdentity','modelCatalog','canonicalModelCatalog','zdrCatalog']);
  else
   perform private.r04_keys(q->route_name->'sourceHashes',array['identity','alias','canonical','zdr']);
  end if;
  foreach source_name in array case when route_name='luna'
   then array['modelIdentity','modelCatalog','canonicalModelCatalog','zdrCatalog']
   else array['identity','alias','canonical','zdr'] end loop
   if q->route_name->'sourceHashes'->>source_name !~ '^[a-f0-9]{64}$'
   then raise exception 'r12_adaptive_quote_source_unverified';end if;
  end loop;
  foreach rate_name in array array['prompt','completion','cacheRead','cacheWrite','reasoning'] loop
   if jsonb_typeof(q->route_name->'tokenPricesUsd'->rate_name)<>'string'
    or q->route_name->'tokenPricesUsd'->>rate_name !~ '^[0-9]+(\.[0-9]+)?$'
    or (q->route_name->'tokenPricesUsd'->>rate_name)::numeric>1
    or (reviewed is not null and (q->route_name->'tokenPricesUsd'->>rate_name)::numeric
      >(reviewed->route_name->'tokenPricesUsd'->>rate_name)::numeric)
   then raise exception 'r12_adaptive_quote_price_exceeds_reviewed';end if;
  end loop;
  if q->route_name->'priceLimit'->'request' is distinct from '0'::jsonb
   then raise exception 'r12_adaptive_quote_request_price_invalid';end if;
  foreach limit_name in array array['prompt','completion'] loop
   if jsonb_typeof(q->route_name->'priceLimit'->limit_name)<>'number'
    or (q->route_name->'priceLimit'->>limit_name)::numeric<0
    or (reviewed is not null and (q->route_name->'priceLimit'->>limit_name)::numeric
      >(reviewed->route_name->'priceLimit'->>limit_name)::numeric)
   then raise exception 'r12_adaptive_quote_price_limit_exceeds_reviewed';end if;
  end loop;
  if reviewed is not null and (q->route_name)-array['sourceHashes','tokenPricesUsd','priceLimit']
    is distinct from (reviewed->route_name)-array['sourceHashes','tokenPricesUsd','priceLimit']
   then raise exception 'r12_adaptive_quote_route_changed';end if;
 end loop;
end $$;

-- A saved owner packet is immutable and independently hashable from its read
-- receipt. Preparing it does not create a scope, plan, action or dispatch.
create table private.r12_owner_observation_bundles (
 id uuid primary key,business_id uuid not null references public.businesses(id),
 owner_id uuid not null references auth.users(id),bundle jsonb not null,
 bundle_hash text not null check(bundle_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null,recorded_at timestamptz not null default clock_timestamp(),
 check(bundle_hash=private.stage14_hash(bundle-'bundleHash')),
 check(bundle->>'id'=id::text and bundle->>'businessId'=business_id::text
  and bundle->>'ownerId'=owner_id::text and bundle->>'bundleHash'=bundle_hash)
);
create index r12_owner_observation_bundles_owner on private.r12_owner_observation_bundles(business_id,owner_id,recorded_at desc);
alter table private.r12_owner_observation_bundles enable row level security;
revoke all on private.r12_owner_observation_bundles from public,anon,authenticated,service_role;
create trigger owner_observation_immutable before update or delete on private.r12_owner_observation_bundles
 for each row execute function private.r12_owner_immutable();

-- Provider capture is owner-reported, never provider-signed. The immutable
-- ledger still independently enforces its structure, privacy and content hash.
-- Use the same canonical ISO-UTC instants as the pure capture validator.
create function private.r12_owner_observation_instant(value jsonb) returns timestamptz
language plpgsql immutable set search_path='' as $$
declare stamp text:=value#>>'{}';parsed timestamptz;begin
 if jsonb_typeof(value) is distinct from 'string'
  or stamp !~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{3})?Z$'
 then raise exception 'r12_owner_observation_timestamp_invalid';end if;
 parsed:=stamp::timestamptz;
 if not isfinite(parsed) or to_char(parsed at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  is distinct from (case when length(stamp)=20 then left(stamp,19)||'.000Z' else stamp end)
 then raise exception 'r12_owner_observation_timestamp_invalid';end if;
 return parsed;
end $$;

create function private.r12_owner_observation_dimension(metric jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select case metric->>'kind'
  when 'statement' then jsonb_build_object('kind','statement')
  when 'money_range' then jsonb_build_object('kind','money_range','currency',metric->'currency','basis',metric->'basis')
  when 'ordinal' then jsonb_build_object('kind','ordinal','scale',metric->'scale','definition',metric->'definition')
  else jsonb_build_object('kind',metric->'kind','unit',metric->'unit') end
$$;
revoke all on function private.r12_owner_observation_instant(jsonb),private.r12_owner_observation_dimension(jsonb)
 from public,anon,authenticated,service_role;

create function private.r12_owner_observation_check(b jsonb,business uuid,owner uuid) returns void
language plpgsql set search_path='' as $$
declare o jsonb;m jsonb;g jsonb;x jsonb;ids text[]:=array[]::text[];sources text[]:=array[]::text[];
 chars text;span text;visible text;u text;metric_ids text[];amounts text[];n numeric;v numeric;
 baseline_dimensions jsonb;dimensions jsonb;compared jsonb;begin
 perform private.r04_safe(b);
 perform private.r04_keys(b,array['version','id','businessId','ownerId','createdAt','observations','baseline','privacyAttestation','bundleHash']);
 if exists(select 1 from jsonb_each(b) f where f.key in ('version','id','businessId','ownerId','createdAt','privacyAttestation','bundleHash') and jsonb_typeof(f.value) is distinct from 'string')
 or jsonb_typeof(b->'baseline') not in ('object','null')
 or octet_length(private.stage14_canonical(b))>16384 or b->>'version'<>'r12.owner-observations.1'
 or b->>'businessId' is distinct from business::text or b->>'ownerId' is distinct from owner::text
 or b->>'id' !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
 or b->>'bundleHash' is distinct from private.stage14_hash(b-'bundleHash')
 or b->>'privacyAttestation'<>'reviewed_aggregate_only_no_credentials_or_customer_data'
 or b->>'createdAt' !~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{3})?Z$'
 or private.r12_owner_observation_instant(b->'createdAt')>clock_timestamp()
 or jsonb_typeof(b->'observations')<>'array' or jsonb_array_length(b->'observations') not between 1 and 8
 then raise exception 'r12_owner_observation_unverified';end if;
 for o in select value from jsonb_array_elements(b->'observations') loop
  perform private.r04_keys(o,array['id','sourceId','provenance','source','context','content','contentHash','metrics','limitations','dataClass']);
  perform private.r04_keys(o->'source',array['url','interface','capturedAt','captureHash']);
  perform private.r04_keys(o->'context',array['productFormat','category','query','windowStart','windowEnd','locale','geography']);
  perform private.r04_keys(o->'context'->'geography',array['kind','countries','basis']);
  u:=o->'source'->>'url';chars:=o->>'content';
  if exists(select 1 from jsonb_each(o) f where f.key in ('id','sourceId','provenance','content','contentHash','dataClass') and jsonb_typeof(f.value) is distinct from 'string')
   or exists(select 1 from jsonb_each(o->'source') f where jsonb_typeof(f.value) is distinct from 'string')
   or exists(select 1 from jsonb_each(o->'context') f where f.key<>'geography' and jsonb_typeof(f.value) is distinct from 'string')
   or o->>'id'=b->>'id' or o->>'id' !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
   or o->>'id'=any(ids) or o->>'sourceId' !~ '^[A-Za-z0-9_-]{1,80}$' or o->>'sourceId'=any(sources)
   or o->>'provenance'<>'owner_reported_capture' or o->>'dataClass'<>'aggregate_nonpersonal'
   or length(btrim(chars))=0 or length(chars)>3000 or o->>'contentHash' is distinct from private.stage14_hash(to_jsonb(chars))
   or o->'source'->>'captureHash' !~ '^[a-f0-9]{64}$' or length(btrim(o->'source'->>'interface')) not between 1 and 160
   or u !~* '^https://[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(/[A-Za-z0-9._~!$&''()*+,;=:@%/-]*)?$'
   or length(u)>800 or u ~ '[@?#]' or u ~* '(^|\.)(localhost|local|internal)(/|$)'
   or o->'source'->>'capturedAt' !~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{3})?Z$'
   or private.r12_owner_observation_instant(o->'source'->'capturedAt')>private.r12_owner_observation_instant(b->'createdAt')
   or private.r12_owner_observation_instant(o->'context'->'windowStart')>private.r12_owner_observation_instant(o->'context'->'windowEnd')
   or private.r12_owner_observation_instant(o->'context'->'windowEnd')>private.r12_owner_observation_instant(o->'source'->'capturedAt')
   or jsonb_typeof(o->'metrics')<>'array' or jsonb_array_length(o->'metrics') not between 1 and 8
   or jsonb_typeof(o->'limitations')<>'array' or jsonb_array_length(o->'limitations') not between 1 and 8
   or exists(select 1 from jsonb_array_elements(o->'limitations') z where jsonb_typeof(z) is distinct from 'string' or length(btrim(z#>>'{}')) not between 1 and 300)
   or (select count(distinct z) from jsonb_array_elements(o->'limitations') z)<>jsonb_array_length(o->'limitations')
  then raise exception 'r12_owner_observation_unverified';end if;
  ids:=ids||(o->>'id');sources:=sources||(o->>'sourceId');
  foreach u in array array['productFormat','category','query','locale'] loop
   if length(btrim(o->'context'->>u)) not between 1 and 160 then raise exception 'r12_owner_observation_context_invalid';end if;
  end loop;
  g:=o->'context'->'geography';
  if jsonb_typeof(g->'kind') is distinct from 'string' or jsonb_typeof(g->'basis') is distinct from 'string'
   or g->>'kind' not in ('unknown','reported') or length(btrim(g->>'basis')) not between 1 and 300
   or jsonb_typeof(g->'countries')<>'array' or jsonb_array_length(g->'countries')>8
   or (g->>'kind'='unknown' and jsonb_array_length(g->'countries')<>0)
   or (g->>'kind'='reported' and jsonb_array_length(g->'countries')=0)
   or exists(select 1 from jsonb_array_elements(g->'countries') c where jsonb_typeof(c) is distinct from 'string' or c#>>'{}' !~ '^[A-Z]{2}$')
   or (select count(distinct c) from jsonb_array_elements(g->'countries') c)<>jsonb_array_length(g->'countries')
  then raise exception 'r12_owner_observation_geography_invalid';end if;
  visible:=(jsonb_build_object('content',chars,'context',o->'context','source',o->'source',
   'metrics',o->'metrics','limitations',o->'limitations'))::text;
  if visible ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(customer|buyer)[[:space:]]*(name|email|address|id)[[:space:]]*[:=]|(shipping|billing)[[:space:]]+address[[:space:]]*[:=]'
  then raise exception 'r12_owner_observation_private_content';end if;
  metric_ids:=array[]::text[];
  for m in select value from jsonb_array_elements(o->'metrics') loop
   if jsonb_typeof(m->'kind') is distinct from 'string' or m->>'kind' not in ('count','money_range','ordinal','statement') then raise exception 'r12_owner_observation_metric_invalid';end if;
   perform private.r04_keys(m,array['id','label','displayed','start','end','kind']||
    case m->>'kind' when 'count' then array['unit','value','precision']
     when 'money_range' then array['currency','lower','upper','basis']
     when 'ordinal' then array['scale','value','definition']
     when 'statement' then array[]::text[] else array['unit','numerator','denominator','value'] end);
   if exists(select 1 from jsonb_each(m) f where f.key in ('id','label','displayed','kind') and jsonb_typeof(f.value) is distinct from 'string')
    or jsonb_typeof(m->'start') is distinct from 'number' or jsonb_typeof(m->'end') is distinct from 'number'
    or m->>'id' !~ '^[A-Za-z0-9_-]{1,80}$' or m->>'id'=any(metric_ids)
    or length(btrim(m->>'label')) not between 1 and 100 or length(btrim(m->>'displayed')) not between 1 and 160
    or m->>'start' !~ '^(0|[1-9][0-9]{0,5})$' or m->>'end' !~ '^[1-9][0-9]{0,5}$'
    or (m->>'end')::integer<=(m->>'start')::integer or (m->>'end')::integer>length(chars)
    or (m->>'end')::integer-(m->>'start')::integer>600
    or position(m->>'displayed' in substr(chars,(m->>'start')::integer+1,(m->>'end')::integer-(m->>'start')::integer))=0
   then raise exception 'r12_owner_observation_metric_span_invalid';end if;
   metric_ids:=metric_ids||(m->>'id');
   if m->>'kind'='count' then
    if jsonb_typeof(m->'unit') is distinct from 'string' or length(btrim(m->>'unit')) not between 1 and 60
     or jsonb_typeof(m->'value') is distinct from 'number' or (m->>'value')::numeric not between 0 and 9007199254740991
     or jsonb_typeof(m->'precision') is distinct from 'string'
     or (m->>'precision'='exact' and (m->>'value')::numeric<>trunc((m->>'value')::numeric)) or m->>'precision' not in ('exact','rounded')
     or m->>'displayed' !~ '^([0-9]+|[0-9]{1,3}(,[0-9]{3})+)(\.[0-9]+)?[kKmMbB]?$'
    then raise exception 'r12_owner_observation_count_invalid';end if;
    span:=regexp_replace(m->>'displayed','[kKmMbB]$','');
    v:=replace(span,',','')::numeric;
    n:=case lower(right(m->>'displayed',1)) when 'k' then 1000 when 'm' then 1000000 when 'b' then 1000000000 else 1 end;
    if (m->>'value')::numeric<>v*n or (n>1 and m->>'precision'<>'rounded') then raise exception 'r12_owner_observation_count_invalid';end if;
   elsif m->>'kind'='money_range' then
    if jsonb_typeof(m->'currency') is distinct from 'string' or m->>'currency' !~ '^[A-Z]{3}$'
     or jsonb_typeof(m->'lower') is distinct from 'number' or jsonb_typeof(m->'upper') is distinct from 'number'
     or (m->>'lower')::numeric not between 0 and 9007199254740991 or (m->>'upper')::numeric not between 0 and 9007199254740991 or (m->>'upper')::numeric<(m->>'lower')::numeric
     or jsonb_typeof(m->'basis') is distinct from 'string' or length(btrim(m->>'basis')) not between 1 and 300 then raise exception 'r12_owner_observation_money_invalid';end if;
    select array_agg(distinct code order by code) into amounts from (
     select (token)[1] code from regexp_matches(m->>'displayed','\m([A-Z]{3})\M','g') token
     union all select 'NZD' where m->>'displayed' ~ 'NZ\$'
     union all select 'USD' where m->>'displayed' ~ 'US\$'
     union all select 'CAD' where m->>'displayed' ~ 'CA\$'
     union all select 'AUD' where m->>'displayed' ~ '(^|[^A-Za-z])(AU\$|A\$)'
     union all select 'GBP' where m->>'displayed' like '%£%'
     union all select 'EUR' where m->>'displayed' like '%€%') currency_witness;
    if amounts is distinct from array[m->>'currency']     or (select count(*) from regexp_matches(m->>'displayed','[0-9]+(,[0-9]{3})*(\.[0-9]+)?','g'))<>2
     or (select replace((z)[1],',','')::numeric from regexp_matches(m->>'displayed','([0-9]+(,[0-9]{3})*(\.[0-9]+)?)','g') with ordinality as amounts(z,ord) where ord=1) is distinct from (m->>'lower')::numeric
     or (select replace((z)[1],',','')::numeric from regexp_matches(m->>'displayed','([0-9]+(,[0-9]{3})*(\.[0-9]+)?)','g') with ordinality as amounts(z,ord) where ord=2) is distinct from (m->>'upper')::numeric
    then raise exception 'r12_owner_observation_money_invalid';end if;
   elsif m->>'kind'='statement' then
    null; -- Exact witnessed span only; no invented numeric interpretation.
   elsif m->>'kind'='ordinal' then
    if jsonb_typeof(m->'scale') is distinct from 'array'
     or jsonb_typeof(m->'value') is distinct from 'string' or jsonb_typeof(m->'definition') is distinct from 'string' or jsonb_array_length(m->'scale') not between 2 and 8
     or not m->'scale' ? (m->>'value') or m->>'displayed' is distinct from m->>'value'
     or length(btrim(m->>'definition')) not between 1 and 300
     or exists(select 1 from jsonb_array_elements(m->'scale') band where jsonb_typeof(band) is distinct from 'string' or length(btrim(band#>>'{}')) not between 1 and 300 or band#>>'{}' ~ '^[-+0-9.%[:space:]]+$')
     or (select count(distinct band) from jsonb_array_elements(m->'scale') band)<>jsonb_array_length(m->'scale') then raise exception 'r12_owner_observation_ordinal_invalid';end if;
   else
    if m->>'unit'<>'fraction' or (m->>'numerator')::numeric<0 or (m->>'denominator')::numeric<0
     or (m->>'numerator')::numeric>(m->>'denominator')::numeric
     or (m->>'denominator')::numeric=0 and m->'value'<>'null'::jsonb
     or (m->>'denominator')::numeric>0 and abs((m->>'value')::numeric-(m->>'numerator')::numeric/(m->>'denominator')::numeric)>0.000000000001
    then raise exception 'r12_owner_observation_rate_invalid';end if;
   end if;
  end loop;
 end loop;
 if b->'baseline'<>'null'::jsonb then
  x:=b->'baseline';
  perform private.r04_keys(x,array['version','declaredAt','timing','productFormat','category','windowStart','windowEnd','locale',
   'candidateObservationIds','referenceObservationId','hypothesis','positiveCriterion','negativeCriterion','inconclusiveCriterion']);
  if exists(select 1 from jsonb_each(x) f where f.key<>'candidateObservationIds' and jsonb_typeof(f.value) is distinct from 'string')
   or x->>'version'<>'r12.owner-observation-baseline.1' or x->>'timing' not in ('prospective','retrospective')
   or jsonb_typeof(x->'candidateObservationIds') is distinct from 'array' or jsonb_array_length(x->'candidateObservationIds') not between 2 and 3
   or not x->>'referenceObservationId'=any(ids)
   or exists(select 1 from jsonb_array_elements(x->'candidateObservationIds') z where jsonb_typeof(z) is distinct from 'string'
    or not (z#>>'{}')=any(ids) or z#>>'{}'=x->>'referenceObservationId')
   or (select count(distinct z) from jsonb_array_elements(x->'candidateObservationIds') z)<>jsonb_array_length(x->'candidateObservationIds')
   or private.r12_owner_observation_instant(x->'declaredAt')>private.r12_owner_observation_instant(b->'createdAt')
   or exists(select 1 from jsonb_each(x) f where f.key in ('hypothesis','positiveCriterion','negativeCriterion','inconclusiveCriterion')
    and length(btrim(f.value#>>'{}')) not between 1 and 600)
  then raise exception 'r12_owner_observation_baseline_invalid';end if;
  select jsonb_agg(observation) into compared from jsonb_array_elements(b->'observations') observation
   where x->'candidateObservationIds' ? (observation->>'id') or observation->>'id'=x->>'referenceObservationId';
  if jsonb_array_length(compared)<>jsonb_array_length(x->'candidateObservationIds')+1
   or (select count(distinct lower(regexp_replace(btrim(normalize(observation->'context'->>'query',NFC)),
       '[[:space:]]+',' ','g'))) from jsonb_array_elements(compared) observation)<>jsonb_array_length(compared)
  then raise exception 'r12_owner_observation_baseline_invalid';end if;
  for o in select value from jsonb_array_elements(compared) loop
   if exists(select 1 from unnest(array['productFormat','category','windowStart','windowEnd','locale']) field
      where x->field is distinct from o->'context'->field)
    or (x->>'timing'='prospective' and private.r12_owner_observation_instant(x->'declaredAt')>
      private.r12_owner_observation_instant(o->'source'->'capturedAt'))
   then raise exception 'r12_owner_observation_baseline_context_invalid';end if;
   select coalesce(jsonb_agg(dimension order by dimension::text),'[]'::jsonb) into dimensions from (
    select distinct private.r12_owner_observation_dimension(metric) dimension
    from jsonb_array_elements(o->'metrics') metric where metric->>'kind'<>'statement') observed;
   if baseline_dimensions is null then baseline_dimensions:=dimensions;
   elsif dimensions is distinct from baseline_dimensions then raise exception 'r12_owner_observation_baseline_dimensions_invalid';end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(compared) observation
   cross join lateral jsonb_array_elements(observation->'metrics') metric
   group by metric->>'id' having count(distinct private.r12_owner_observation_dimension(metric))>1)
  then raise exception 'r12_owner_observation_baseline_dimensions_invalid';end if;
 end if;
end $$;

create function public.r12_owner_observation_server(p_business_id uuid,p_operation text,p_payload jsonb,p_server_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b jsonb;row_bundle private.r12_owner_observation_bundles;begin
 perform private.r05_owner(p_business_id);perform private.r04_safe(p_payload);
 if auth.uid() is null or private.is_business_owner(p_business_id) is distinct from true
 then raise exception 'r12_owner_observation_owner_required' using errcode='42501';end if;
 if p_operation='save' then
  perform private.r04_keys(p_payload,array['bundle']);b:=p_payload->'bundle';
  perform private.r12_owner_observation_check(b,p_business_id,auth.uid());
  -- Private owner intake is not execution authority and requires no paid grant.
  select * into row_bundle from private.r12_owner_observation_bundles where id=(b->>'id')::uuid;
  if row_bundle.id is not null then
   if row_bundle.business_id is distinct from p_business_id or row_bundle.owner_id is distinct from auth.uid()
    or row_bundle.bundle is distinct from b then raise exception 'r12_owner_observation_idempotency_conflict';end if;
  else
   insert into private.r12_owner_observation_bundles(id,business_id,owner_id,bundle,bundle_hash,created_at)
   values((b->>'id')::uuid,p_business_id,auth.uid(),b,b->>'bundleHash',(b->>'createdAt')::timestamptz)
   returning * into row_bundle;
  end if;
 elsif p_operation='list' then
  perform private.r04_keys(p_payload,array[]::text[]);
  return jsonb_build_object('version','r12.owner-observation-list.1','bundles',coalesce((
   select jsonb_agg(saved.bundle order by saved.recorded_at desc,saved.id) from (
    select id,bundle,recorded_at from private.r12_owner_observation_bundles
    where business_id=p_business_id and owner_id=auth.uid() order by recorded_at desc,id limit 20
   ) saved),'[]'::jsonb));
 elsif p_operation='read' then
  perform private.r04_keys(p_payload,array['bundleId']);
  select * into row_bundle from private.r12_owner_observation_bundles where id=(p_payload->>'bundleId')::uuid
   and business_id=p_business_id and owner_id=auth.uid();
  if row_bundle.id is null then raise exception 'r12_owner_observation_unavailable';end if;
 else raise exception 'r12_owner_observation_operation_unavailable';end if;
 return jsonb_build_object('version','r12.owner-observation-receipt.1','bundle',row_bundle.bundle);
end $$;

create function private.r12_owner_observation_context(ref jsonb,business uuid,owner uuid,
 intent_id uuid,scope_id uuid,scope_hash text,approval_hash text) returns jsonb
language plpgsql stable set search_path='' as $$
declare entry jsonb;row_bundle private.r12_owner_observation_bundles;bundles jsonb:='[]'::jsonb;
 seen_bundle text[]:=array[]::text[];seen_artifact text[]:=array[]::text[];
 seen_source text[]:=array[]::text[];o jsonb;selected text;total integer:=0;bytes integer:=0;begin
 if ref='null'::jsonb then return 'null'::jsonb;end if;
 perform private.r04_safe(ref);perform private.r04_keys(ref,array['manifestHash','manifest']);
 if ref->>'manifestHash' is distinct from private.stage14_hash(ref->'manifest')
  or jsonb_typeof(ref->'manifest')<>'array' or jsonb_array_length(ref->'manifest') not between 1 and 8
 then raise exception 'r12_owner_observation_manifest_invalid';end if;
 for entry in select value from jsonb_array_elements(ref->'manifest') loop
  perform private.r04_keys(entry,array['bundleId','bundleHash','selectedObservationIds']);
  if entry->>'bundleId' !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
   or entry->>'bundleId'=any(seen_bundle) or entry->>'bundleHash' !~ '^[a-f0-9]{64}$'
   or jsonb_typeof(entry->'selectedObservationIds')<>'array'
   or jsonb_array_length(entry->'selectedObservationIds') not between 1 and 8
  then raise exception 'r12_owner_observation_manifest_invalid';end if;
  seen_bundle:=seen_bundle||(entry->>'bundleId');
  select * into row_bundle from private.r12_owner_observation_bundles where id=(entry->>'bundleId')::uuid
   and business_id=business and owner_id=owner and bundle_hash=entry->>'bundleHash';
  if row_bundle.id is null or row_bundle.bundle_hash is distinct from private.stage14_hash(row_bundle.bundle-'bundleHash')
  then raise exception 'r12_owner_observation_bundle_unavailable';end if;
  perform private.r12_owner_observation_check(row_bundle.bundle,business,owner);
  total:=total+jsonb_array_length(row_bundle.bundle->'observations');
  bytes:=bytes+octet_length(private.stage14_canonical(row_bundle.bundle));
  if total>8 or bytes>16384 then raise exception 'r12_owner_observation_bound_exceeded';end if;
  for o in select value from jsonb_array_elements(row_bundle.bundle->'observations') loop
   if o->>'id'=any(seen_artifact) or o->>'sourceId'=any(seen_source)
    or o->>'id'=any(seen_bundle) then raise exception 'r12_owner_observation_identity_collision';end if;
   seen_artifact:=seen_artifact||(o->>'id');seen_source:=seen_source||(o->>'sourceId');
  end loop;
  for selected in select value from jsonb_array_elements_text(entry->'selectedObservationIds') loop
   if not selected=any(seen_artifact) or (select count(*) from jsonb_array_elements_text(entry->'selectedObservationIds') x where x=selected)>1
    or not exists(select 1 from jsonb_array_elements(row_bundle.bundle->'observations') z where z->>'id'=selected)
   then raise exception 'r12_owner_observation_selection_invalid';end if;
  end loop;
  bundles:=bundles||jsonb_build_array(row_bundle.bundle);
 end loop;
 if exists(select 1 from unnest(seen_bundle) z where z=any(seen_artifact))
 then raise exception 'r12_owner_observation_identity_collision';end if;
 return jsonb_build_object('version','r12.owner-observation-context.1','intentId',intent_id,
  'businessId',business,'ownerId',owner,'scopeId',scope_id,'scopeHash',scope_hash,
  'approvalHash',approval_hash,'manifestHash',ref->>'manifestHash','manifest',ref->'manifest','bundles',bundles);
end $$;

create function private.r12_adaptive_setup_packet(selection jsonb,grant_id uuid,approval_hash text,
 quote jsonb,preview jsonb,submission_id uuid,owner_observation_ref jsonb) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('version','r12.owner-adaptive-setup.1','selection',selection,
  'grantId',grant_id,'approvalHash',approval_hash,'quote',quote,'preview',preview,'submissionId',submission_id,
  'ownerObservationRef',owner_observation_ref)
$$;
create table private.r12_adaptive_setups (
 id uuid primary key,business_id uuid not null references public.businesses(id),goal_id uuid not null,
 owner_id uuid not null references auth.users(id),scope_id uuid not null unique,
 profile_id uuid not null references private.r12_owner_profiles(id),
 grant_id uuid not null references private.r12_owner_bootstrap_grants(id),
 binding_id uuid not null references private.r12_owner_funding_bindings(id),
 installation_id uuid not null references public.installed_packs(id),
 policy_id uuid not null unique references private.r05_policies(id),policy_hash text not null check(policy_hash ~ '^[a-f0-9]{64}$'),
 input jsonb not null,selection jsonb not null,quote jsonb not null,preview jsonb not null,
 owner_observation_ref jsonb not null,
 approval_hash text not null check(approval_hash ~ '^[a-f0-9]{64}$'),
 submission_id uuid not null,setup_hash text not null,
 cutoff timestamptz not null check(isfinite(cutoff)),created_at timestamptz not null default clock_timestamp(),
 unique(business_id,submission_id),foreign key(goal_id,business_id) references private.r04_goal_state(goal_id,business_id),
 check(setup_hash=private.stage14_hash(private.r12_adaptive_setup_packet(selection,grant_id,approval_hash,quote,preview,submission_id,owner_observation_ref))),
 check(owner_observation_ref=preview->'ownerObservationRef')
);
create index r12_adaptive_setups_owner_goal_recent on private.r12_adaptive_setups(business_id,owner_id,goal_id,created_at desc,id desc);
alter table private.r12_adaptive_setups enable row level security;
revoke all on private.r12_adaptive_setups from public,anon,authenticated,service_role;
create trigger adaptive_immutable before insert or update or delete on private.r12_adaptive_setups
 for each row execute function private.r12_owner_immutable();

alter table private.r12_discovery_scopes add column adaptive_setup_id uuid references private.r12_adaptive_setups(id);
alter table private.r12_discovery_scopes drop constraint r12_discovery_scopes_origin_check;
alter table private.r12_discovery_scopes add constraint r12_discovery_scopes_origin_check check(origin in ('legacy','owner_initial','owner_episode','owner_adaptive'));
alter table private.r12_discovery_scopes drop constraint r12_owner_origin_exact;
alter table private.r12_discovery_scopes add constraint r12_owner_origin_exact check(
 (origin='legacy' and owner_setup_id is null and adaptive_setup_id is null and budget_authority_root_id is not null and prior_round_id is not null and amendment->>'version' not in ('r12.discovery-owner-initial.1','r12.discovery-owner-episode.1','r12.discovery-owner-adaptive.1')) or
 (origin='owner_initial' and owner_setup_id is not null and adaptive_setup_id is null and amendment->>'version'='r12.discovery-owner-initial.1' and
 ((amendment->'funding'->>'kind'='r05_business' and budget_authority_root_id is null and prior_round_id is null) or
 (amendment->'funding'->>'kind'='legacy_research_root' and budget_authority_root_id is not null and prior_round_id is not null))) or
 (origin='owner_episode' and owner_setup_id is not null and adaptive_setup_id is null and amendment->>'version'='r12.discovery-owner-episode.1' and
 ((amendment->'funding'->>'kind'='r05_business' and budget_authority_root_id is null and prior_round_id is null) or
 (amendment->'funding'->>'kind'='legacy_research_root' and budget_authority_root_id is not null and prior_round_id is not null))) or
 (origin='owner_adaptive' and owner_setup_id is null and adaptive_setup_id is not null and amendment->>'version'='r12.discovery-owner-adaptive.1' and
 ((amendment->'funding'->>'kind'='r05_business' and budget_authority_root_id is null and prior_round_id is null) or
 (amendment->'funding'->>'kind'='legacy_research_root' and budget_authority_root_id is not null and prior_round_id is not null))));

alter table private.r07_plans drop constraint r07_plans_version_check;
alter table private.r07_plans add constraint r07_plans_version_check check(
 version between 1 and 4 or
 (version between 5 and 9 and content->>'format' in ('r12.discovery-episode.1','r12.discovery-adaptive.1')));

create table private.r12_adaptive_activations (
 setup_id uuid not null unique references private.r12_adaptive_setups(id),
 scope_id uuid primary key references private.r12_discovery_scopes(id) deferrable initially deferred,
 business_id uuid not null references public.businesses(id),
 goal_id uuid not null,
 owner_id uuid not null references auth.users(id),
 plan_id uuid not null unique references private.r07_plans(id) deferrable initially deferred,
 predecessor_plan_id uuid not null unique references private.r07_plans(id),
 grant_id uuid not null references private.r12_owner_bootstrap_grants(id),
 grant_root_id uuid not null references private.r12_owner_grant_roots(id),
 binding_id uuid not null references private.r12_owner_funding_bindings(id),
 profile_id uuid not null references private.r12_owner_profiles(id),
 policy_id uuid not null references private.r05_policies(id),
 scope_hash text not null check(scope_hash ~ '^[a-f0-9]{64}$'),
 plan_hash text not null check(plan_hash ~ '^[a-f0-9]{64}$'),
 predecessor_closure jsonb not null,
 predecessor_closure_hash text not null check(predecessor_closure_hash=private.stage14_hash(predecessor_closure)),
 quote_hash text not null check(quote_hash ~ '^[a-f0-9]{64}$'),
 phase_ceilings jsonb not null,
 maximum_run_microusd bigint not null check(maximum_run_microusd between 1 and 10000000),
 maximum_extra_actions integer not null check(maximum_extra_actions between 1 and 10),
 maximum_paid_calls integer not null check(maximum_paid_calls between 5 and 64),
 expires_at timestamptz not null check(isfinite(expires_at)),
 content jsonb not null,
 content_hash text not null check(content_hash=private.stage14_hash(content)),
 created_at timestamptz not null default clock_timestamp(),
 foreign key(goal_id,business_id) references private.r04_goal_state(goal_id,business_id)
);
create table private.r12_adaptive_planner_receipts (
 scope_id uuid primary key references private.r12_adaptive_activations(scope_id) deferrable initially deferred,
 input_hash text not null check(input_hash ~ '^[a-f0-9]{64}$'),
 input_snapshot jsonb not null check(input_snapshot->>'inputHash'=input_hash
  and input_snapshot->>'version'='r12.owner-adaptive-planner-preflight-input.1'),
 quote_hash text not null check(quote_hash ~ '^[a-f0-9]{64}$'),
 action_hash text not null check(action_hash ~ '^[a-f0-9]{64}$'),
 binding_hash text not null check(binding_hash ~ '^[a-f0-9]{64}$'),
 knowledge_hash text not null check(knowledge_hash ~ '^[a-f0-9]{64}$'),
 request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
 wire_hash text not null check(wire_hash ~ '^[a-f0-9]{64}$'),
 request_bytes integer not null check(request_bytes between 1 and 24576),
 wire_bytes integer not null check(wire_bytes between 1 and 24576),
 content jsonb not null,content_hash text not null check(content_hash=private.stage14_hash(content)),
 created_at timestamptz not null default clock_timestamp()
);

-- One row is one approved investigation decision, including ordinal zero.
-- Calls are separate so an action can reserve a bounded sequence without
-- inventing terminal results for calls that have not run.
create table private.r12_adaptive_actions (
 scope_id uuid not null references private.r12_adaptive_activations(scope_id),
 ordinal integer not null check(ordinal between 0 and 10),
 kind text not null check(kind in ('initial','followup','repair','pivot','reasoning_review')),
 content jsonb not null,
 content_hash text not null check(content_hash=private.stage14_hash(content)),
 previous_action_hash text check(previous_action_hash ~ '^[a-f0-9]{64}$'),
 previous_review_hash text not null check(previous_review_hash ~ '^[a-f0-9]{64}$'),
 maximum_microusd bigint not null check(maximum_microusd between 1 and 10000000),
 created_at timestamptz not null default clock_timestamp(),
 primary key(scope_id,ordinal),unique(scope_id,content_hash)
);
create table private.r12_adaptive_action_dependencies (
 scope_id uuid not null,action_ordinal integer not null,
 step_key text not null check(step_key in ('plan','search1','select1','strategy','review')),
 source_attempt_id uuid not null references private.r07_attempts(id),
 response_hash text not null check(response_hash ~ '^[a-f0-9]{64}$'),
 primary key(scope_id,action_ordinal,step_key),
 foreign key(scope_id,action_ordinal) references private.r12_adaptive_actions(scope_id,ordinal)
);
create table private.r12_adaptive_action_closures (
 scope_id uuid not null,action_ordinal integer not null,
 action_hash text not null check(action_hash ~ '^[a-f0-9]{64}$'),
 state text not null check(state in ('completed','failed')),
 outcome text check(outcome in ('TEST','NEEDS_MORE_EVIDENCE','REJECT')),
 review_hash text check(review_hash ~ '^[a-f0-9]{64}$'),
 committed_microusd bigint not null check(committed_microusd between 0 and 10000000),
 created_at timestamptz not null default clock_timestamp(),
 primary key(scope_id,action_ordinal),
 foreign key(scope_id,action_ordinal) references private.r12_adaptive_actions(scope_id,ordinal)
);
-- A failed paid call records the actual screened diagnostic and final charge.
-- It is distinct from an accepted R07 response or completed research phase.
create table private.r12_adaptive_failed_calls (
 scope_id uuid not null,action_ordinal integer not null,
 attempt_id uuid primary key references private.r07_attempts(id),
 request_id uuid not null unique references private.r05_requests(id),
 diagnostic_hash text not null check(diagnostic_hash ~ '^[a-f0-9]{64}$'),
 settlement_hash text not null check(settlement_hash ~ '^[a-f0-9]{64}$'),
 defect text not null check(defect in ('schema','format','identified_reasoning')),
 failure_hash text not null check(failure_hash=private.stage14_hash(jsonb_build_object(
  'version','r12.adaptive-failed-call.1','scopeId',scope_id,'actionOrdinal',action_ordinal,
  'attemptId',attempt_id,'requestId',request_id,'diagnosticHash',diagnostic_hash,
  'settlementHash',settlement_hash,'defect',defect))),
 created_at timestamptz not null default clock_timestamp(),
 foreign key(scope_id,action_ordinal) references private.r12_adaptive_actions(scope_id,ordinal)
);
create table private.r12_adaptive_missing_recommendations (
 scope_id uuid not null references private.r12_adaptive_activations(scope_id),
 gap_hash text not null check(gap_hash ~ '^[a-f0-9]{64}$'),
 action_ordinal integer not null check(action_ordinal between 1 and 10),
 action_hash text not null check(action_hash ~ '^[a-f0-9]{64}$'),
 origin_review_hash text not null check(origin_review_hash ~ '^[a-f0-9]{64}$'),
 canonical_questions jsonb not null check(jsonb_typeof(canonical_questions)='array'),
 created_at timestamptz not null default clock_timestamp(),
 primary key(scope_id,gap_hash),unique(scope_id,action_ordinal)
);
alter table private.r12_adaptive_missing_recommendations enable row level security;
revoke all on private.r12_adaptive_missing_recommendations from public,anon,authenticated,service_role;
create trigger adaptive_missing_recommendations_immutable before insert or update or delete
 on private.r12_adaptive_missing_recommendations for each row execute function private.r12_owner_immutable();

create function private.r12_adaptive_missing_gap(scope uuid,review jsonb) returns jsonb
 language plpgsql immutable set search_path='' as $$
declare raw jsonb:=review->'rawResponse';q text;questions text[]:=array[]::text[];
 norm text;count_questions integer:=0;hash text;begin
 if review->>'outcome' is distinct from 'NEEDS_MORE_EVIDENCE'
 or jsonb_typeof(raw) is distinct from 'object' or raw ? 'recommendedNextAction'
 or jsonb_typeof(review->'inheritedQuestions') is distinct from 'array'
 or jsonb_typeof(review->'additionalQuestions') is distinct from 'array'
 then return null;end if;
 for q in select value from jsonb_array_elements_text((review->'inheritedQuestions')||(review->'additionalQuestions')) loop
  count_questions:=count_questions+1;
  if count_questions>150 or length(q)>600 then raise exception 'r12_adaptive_missing_gap_invalid';end if;
  norm:=btrim(regexp_replace(q,E'[ \\t\\r\\n]+',' ','g'));
  norm:=translate(norm,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz');
  if length(norm)>=10 then questions:=array_append(questions,norm);end if;
 end loop;
 select array_agg(x order by x collate "C") into questions from (select distinct unnest(questions) as x) z;
 if coalesce(array_length(questions,1),0)=0 then return null;end if;
 hash:=encode(extensions.digest(convert_to('r12.missing-recommendation.1'||E'\n'||scope::text||E'\n'||array_to_string(questions,E'\n'),'UTF8'),'sha256'),'hex');
 return jsonb_build_object('gapHash',hash,'questions',to_jsonb(questions));
end $$;

-- Only attempts on a proven adaptive activation carry these columns. Legacy
-- schedules retain the original 1..4 database constraint verbatim.
alter table private.r07_attempts add column adaptive_action_ordinal integer,
 add column adaptive_action_hash text;
alter table private.r07_attempts drop constraint r07_attempts_attempt_check;
alter table private.r07_attempts add constraint r07_attempts_attempt_check check(
 (adaptive_action_ordinal is null and adaptive_action_hash is null and attempt between 1 and 4) or
 (adaptive_action_ordinal between 0 and 10 and adaptive_action_hash ~ '^[a-f0-9]{64}$' and attempt between 1 and 47));
create unique index r12_adaptive_one_attempt_per_phase on private.r07_attempts(plan_id,adaptive_action_ordinal,step_key)
 where adaptive_action_ordinal is not null;
create function private.r12_adaptive_attempt_guard() returns trigger language plpgsql set search_path='' as $$
declare activation private.r12_adaptive_activations;decision private.r12_adaptive_actions;
 child private.r07_children;plan private.r07_plans;phase text;next_attempt integer;begin
 if tg_op<>'INSERT' then return new;end if;
 select * into plan from private.r07_plans where id=new.plan_id;
 if plan.content->>'format' is distinct from 'r12.discovery-adaptive.1' then
  if new.adaptive_action_ordinal is not null or new.adaptive_action_hash is not null
  then raise exception 'r12_adaptive_attempt_old_plan_spoof';end if;
  return new;
 end if;
 select * into activation from private.r12_adaptive_activations where plan_id=plan.id;
 select * into decision from private.r12_adaptive_actions where scope_id=activation.scope_id and ordinal=new.adaptive_action_ordinal;
 select * into child from private.r07_children where id=new.child_id;
 phase:=case new.step_key when 'search1' then 'search' when 'select1' then 'select' else new.step_key end;
 select count(*)+1 into next_attempt from private.r07_attempts prior where prior.plan_id=new.plan_id and prior.step_key=new.step_key;
 if activation.scope_id is null or decision.scope_id is null or child.id is null
 or decision.content_hash is distinct from new.adaptive_action_hash
 or activation.business_id is distinct from new.business_id or activation.goal_id is distinct from new.goal_id
 or child.plan_id is distinct from new.plan_id or child.step_key is distinct from new.step_key
 or not (decision.content->'phases' ? phase) or new.attempt<>next_attempt
 then raise exception 'r12_adaptive_attempt_unadmitted';end if;
 return new;
end $$;
create trigger adaptive_attempt_guard before insert on private.r07_attempts for each row
 execute function private.r12_adaptive_attempt_guard();

do $adaptive_snapshot_patch$ declare d text;begin
 d:=pg_get_functiondef('private.r07_snapshot(uuid,uuid,uuid)'::regprocedure);
 if position($old$'attempt',a.attempt,'status',a.status$old$ in d)=0
 then raise exception 'r12_adaptive_r07_snapshot_changed';end if;
 d:=replace(d,$old$'attempt',a.attempt,'status',a.status$old$,
  $new$'attempt',a.attempt,'adaptiveActionHash',a.adaptive_action_hash,
   'adaptiveActionOrdinal',a.adaptive_action_ordinal,'status',a.status$new$);
 execute d;
end $adaptive_snapshot_patch$;

create function private.r12_adaptive_action_context(p_scope uuid) returns jsonb language plpgsql stable
 set search_path='' as $$
declare a private.r12_adaptive_activations;decision private.r12_adaptive_actions;
 phase_keys jsonb;attempt_ids jsonb;reused jsonb;phase text;step_key text;
 total integer;terminal integer;pin private.r07_attempts;response private.r07_responses;begin
 select * into a from private.r12_adaptive_activations where scope_id=p_scope;
 if a.scope_id is null then raise exception 'r12_adaptive_activation_required';end if;
 select * into decision from private.r12_adaptive_actions where scope_id=p_scope order by ordinal desc limit 1;
 if decision.scope_id is null then return null;end if;
 select count(*),count(*) filter(where status in ('completed','rejected','failed','cancelled')) into total,terminal
 from private.r07_attempts where plan_id=a.plan_id and adaptive_action_ordinal=decision.ordinal;
 if exists(select 1 from private.r12_adaptive_action_closures cl
   where cl.scope_id=p_scope and cl.action_ordinal=decision.ordinal and cl.action_hash=decision.content_hash)
 then return null;end if;
 select coalesce(jsonb_agg(to_jsonb(private.r12_adaptive_step_key(value)) order by ord),'[]'::jsonb)
 into phase_keys from jsonb_array_elements_text(decision.content->'phases') with ordinality phases(value,ord);
 select coalesce(jsonb_agg(t.id order by t.created_at,t.id),'[]'::jsonb) into attempt_ids
 from private.r07_attempts t where t.plan_id=a.plan_id and t.adaptive_action_ordinal=decision.ordinal
 and t.adaptive_action_hash=decision.content_hash;
 select coalesce(jsonb_agg(jsonb_build_object('stepKey',d.step_key,'attemptId',d.source_attempt_id,
  'resultHash',d.response_hash) order by array_position(array['plan','search1','select1','strategy','review'],d.step_key)),'[]'::jsonb)
 into reused from private.r12_adaptive_action_dependencies d where d.scope_id=p_scope and d.action_ordinal=decision.ordinal;
 if jsonb_array_length(reused)<>5-jsonb_array_length(decision.content->'phases')
 then raise exception 'r12_adaptive_dependency_set_incomplete';end if;
 return jsonb_build_object('actionHash',decision.content_hash,'ordinal',decision.ordinal,
  'phaseKeys',phase_keys,'attemptIds',attempt_ids,'reused',reused);
end $$;

-- The caller names only an already admitted action. Every prerequisite is
-- recovered from that action's own attempt or its immutable omitted-phase pin.
create function private.r12_adaptive_schedule_pins(p private.r07_plans,s jsonb,body jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare activation private.r12_adaptive_activations;decision private.r12_adaptive_actions;
 prior private.r12_adaptive_actions;pin private.r12_adaptive_action_dependencies;
 t private.r07_attempts;r private.r07_responses;result jsonb:='[]'::jsonb;
 k text;phase text;action_number integer;begin
 select * into activation from private.r12_adaptive_activations where plan_id=p.id;
 if activation.plan_id is null or p.content->>'format' is distinct from 'r12.discovery-adaptive.1'
 or body->>'actionOrdinal' !~ '^(0|[1-9]|10)$' or body->>'actionHash' !~ '^[a-f0-9]{64}$'
 then raise exception 'r12_adaptive_schedule_identity_invalid';end if;
 action_number:=(body->>'actionOrdinal')::integer;
 select * into decision from private.r12_adaptive_actions
  where scope_id=activation.scope_id and ordinal=action_number;
 select * into prior from private.r12_adaptive_actions where scope_id=activation.scope_id order by ordinal desc limit 1;
 phase:=case s->>'key' when 'search1' then 'search' when 'select1' then 'select' else s->>'key' end;
 if decision.scope_id is null or prior.ordinal is distinct from decision.ordinal
 or decision.content_hash is distinct from body->>'actionHash'
 or not (decision.content->'phases' ? phase)
 or exists(select 1 from private.r12_adaptive_action_closures cl
  where cl.scope_id=activation.scope_id and cl.action_ordinal=action_number)
 or exists(select 1 from private.r07_attempts old
  where old.plan_id=p.id and old.adaptive_action_ordinal=action_number and old.step_key=s->>'key')
 then raise exception 'r12_adaptive_current_action_phase_required';end if;
 perform private.r12_adaptive_scope_resolve(activation.scope_id);
 for k in select jsonb_array_elements_text(s->'dependsOn') order by 1 loop
  select * into t from private.r07_attempts old where old.plan_id=p.id
   and old.adaptive_action_ordinal=action_number and old.adaptive_action_hash=decision.content_hash
   and old.step_key=k and old.status='completed';
  if t.id is null then
   select * into pin from private.r12_adaptive_action_dependencies d
    where d.scope_id=activation.scope_id and d.action_ordinal=action_number and d.step_key=k;
   if pin.scope_id is null then raise exception 'r12_adaptive_dependency_pin_required';end if;
   select * into t from private.r07_attempts where id=pin.source_attempt_id and plan_id=p.id
    and step_key=k and status='completed' and adaptive_action_ordinal<action_number;
  end if;
  select * into r from private.r07_responses where attempt_id=t.id;
  if t.id is null or r.attempt_id is null or r.content->>'outcome' is distinct from 'accepted'
   or (pin.scope_id is not null and pin.response_hash is distinct from r.content_hash)
  then raise exception 'r12_adaptive_dependency_unverified';end if;
  result:=result||jsonb_build_array(jsonb_build_object('stepKey',k,'attemptId',t.id,'resultHash',r.content_hash));
  pin:=null;t:=null;r:=null;
 end loop;
 return result;
end $$;

do $adaptive_r07_schedule_patch$ declare d text;begin
 d:=pg_get_functiondef('public.r07_controller(uuid,uuid,text,jsonb,uuid,text,text,bigint,text)'::regprocedure);
 if position($old$perform private.r04_keys(clean,array['stepKey','attemptId','reason','evidenceHash']);$old$ in d)=0
 or position($old$if private.r07_result_attempt(p.id,s->>'key') is not null then raise exception 'r07_success_already_persisted'; end if;$old$ in d)=0
 or position($old$insert into private.r07_attempts(id,business_id,goal_id,plan_id,child_id,step_key,attempt,input_hash,dependency_pins,status,reason,repair_evidence_hash)$old$ in d)=0
 then raise exception 'r12_adaptive_r07_schedule_changed';end if;
 d:=replace(d,$old$perform private.r04_keys(clean,array['stepKey','attemptId','reason','evidenceHash']);$old$,
  $new$if p.content->>'format'='r12.discovery-adaptive.1' then
 perform private.r04_keys(clean,array['stepKey','attemptId','reason','evidenceHash','actionHash','actionOrdinal']);
 else perform private.r04_keys(clean,array['stepKey','attemptId','reason','evidenceHash']);end if;$new$);
 d:=replace(d,$old$if private.r07_result_attempt(p.id,s->>'key') is not null then raise exception 'r07_success_already_persisted'; end if;
 select * into old from private.r07_attempts where plan_id=p.id and step_key=s->>'key' order by attempt desc limit 1;
 if old.id is not null and old.status not in ('rejected','failed') then raise exception 'r07_attempt_already_pending'; end if;
 if old.id is not null and (not exists(select 1 from private.r07_responses rr where rr.attempt_id=old.id and private.r04_hash(rr.content->'result')=clean->>'evidenceHash') or old.repair_evidence_hash=clean->>'evidenceHash' or old.attempt>(s->>'maximumRepairs')::integer or h.repairs_used>=(p.content->>'maximumRepairs')::integer) then raise exception 'r07_repair_exhausted_or_unchanged'; end if;
 pins:=private.r07_dependencies(p.id,s);
 if pins is null then raise exception 'r07_prerequisites_required'; end if;
 if old.id is not null then
 pins:=pins||jsonb_build_array(jsonb_build_object('stepKey','repair:'||old.step_key,'attemptId',old.id,'resultHash',(select content_hash from private.r07_responses where attempt_id=old.id)));
 end if;$old$,
  $new$select * into old from private.r07_attempts where plan_id=p.id and step_key=s->>'key' order by attempt desc limit 1;
 if p.content->>'format'='r12.discovery-adaptive.1' then
 pins:=private.r12_adaptive_schedule_pins(p,s,clean);
 else
 if private.r07_result_attempt(p.id,s->>'key') is not null then raise exception 'r07_success_already_persisted'; end if;
 if old.id is not null and old.status not in ('rejected','failed') then raise exception 'r07_attempt_already_pending'; end if;
 if old.id is not null and (not exists(select 1 from private.r07_responses rr where rr.attempt_id=old.id and private.r04_hash(rr.content->'result')=clean->>'evidenceHash') or old.repair_evidence_hash=clean->>'evidenceHash' or old.attempt>(s->>'maximumRepairs')::integer or h.repairs_used>=(p.content->>'maximumRepairs')::integer) then raise exception 'r07_repair_exhausted_or_unchanged'; end if;
 pins:=private.r07_dependencies(p.id,s);
 if pins is null then raise exception 'r07_prerequisites_required'; end if;
 if old.id is not null then
 pins:=pins||jsonb_build_array(jsonb_build_object('stepKey','repair:'||old.step_key,'attemptId',old.id,'resultHash',(select content_hash from private.r07_responses where attempt_id=old.id)));
 end if;
 end if;$new$);
 d:=replace(d,$old$insert into private.r07_attempts(id,business_id,goal_id,plan_id,child_id,step_key,attempt,input_hash,dependency_pins,status,reason,repair_evidence_hash) values(aid,p_business_id,p_goal_id,p.id,child,s->>'key',coalesce(old.attempt,0)+1,private.r04_hash(pins),pins,'scheduled',clean->>'reason',clean->>'evidenceHash') returning * into a;$old$,
  $new$insert into private.r07_attempts(id,business_id,goal_id,plan_id,child_id,step_key,attempt,input_hash,dependency_pins,status,reason,repair_evidence_hash,adaptive_action_ordinal,adaptive_action_hash)
 values(aid,p_business_id,p_goal_id,p.id,child,s->>'key',coalesce(old.attempt,0)+1,private.r04_hash(pins),pins,'scheduled',clean->>'reason',clean->>'evidenceHash',
 case when p.content->>'format'='r12.discovery-adaptive.1' then (clean->>'actionOrdinal')::integer else null end,
 case when p.content->>'format'='r12.discovery-adaptive.1' then clean->>'actionHash' else null end) returning * into a;$new$);
 d:=replace(d,$old$repairs_used=repairs_used+case when old.id is null then 0 else 1 end$old$,
  $new$repairs_used=repairs_used+case when p.content->>'format'='r12.discovery-adaptive.1' or old.id is null then 0 else 1 end$new$);
 execute d;
end $adaptive_r07_schedule_patch$;
create table private.r12_adaptive_call_admissions (
 scope_id uuid not null,
 action_ordinal integer not null,
 position integer not null check(position between 1 and 5),
 action_phase text not null check(action_phase in ('plan','search','select','strategy','review')),
 step_key text not null check(step_key in ('plan','search1','select1','strategy','review')),
 attempt_id uuid not null unique references private.r07_attempts(id),
 request_id uuid not null unique references private.r05_requests(id),
 maximum_microusd bigint not null check(maximum_microusd between 1 and 10000000),
 created_at timestamptz not null default clock_timestamp(),
 primary key(scope_id,action_ordinal,position),
 unique(scope_id,action_ordinal,action_phase),
 foreign key(scope_id,action_ordinal) references private.r12_adaptive_actions(scope_id,ordinal)
);
create index r12_adaptive_calls_scope on private.r12_adaptive_call_admissions(scope_id,action_ordinal,action_phase);

create function private.r12_adaptive_setup_receipt(s private.r12_adaptive_setups) returns jsonb
 language sql stable set search_path='' as $$
 select jsonb_build_object('version','r12.owner-adaptive-receipt.1',
  'businessId',s.business_id,'goalId',s.goal_id,'setupId',s.id,'setupHash',s.setup_hash,
  'scopeId',s.scope_id,'profileId',s.profile_id,'grantId',s.grant_id,'submissionId',s.submission_id,
  'policyId',s.policy_id,'policyHash',s.policy_hash,'preview',s.preview,'selection',s.selection,
  'quote',s.quote,'approvalHash',s.approval_hash,'ownerObservationRef',s.owner_observation_ref,
  'confirmed',exists(select 1 from private.r05_confirmations c where c.policy_id=s.policy_id),
  'activated',a.scope_id is not null,
  'stopped',exists(select 1 from private.r05_revocations r where r.policy_id=s.policy_id),
  'planId',a.plan_id,'planHash',a.plan_hash,
  'actions',coalesce((select jsonb_agg(jsonb_build_object(
    'action',x.content,'actionHash',x.content_hash,
    'state',case when exists(select 1 from private.r12_adaptive_call_admissions c join private.r07_attempts t on t.id=c.attempt_id
      where c.scope_id=x.scope_id and c.action_ordinal=x.ordinal and t.status in ('rejected','failed','cancelled')) then 'failed'
      when (select count(*) from private.r12_adaptive_call_admissions c where c.scope_id=x.scope_id and c.action_ordinal=x.ordinal)=jsonb_array_length(x.content->'phases')
       and not exists(select 1 from private.r12_adaptive_call_admissions c join private.r07_attempts t on t.id=c.attempt_id
       where c.scope_id=x.scope_id and c.action_ordinal=x.ordinal and t.status<>'completed') then 'completed'
      when exists(select 1 from private.r12_adaptive_call_admissions c where c.scope_id=x.scope_id and c.action_ordinal=x.ordinal) then 'running'
      else 'admitted' end,
    'outcome',(select r.content->'result'->>'outcome' from private.r12_adaptive_call_admissions c
     join private.r07_responses r on r.attempt_id=c.attempt_id
     where c.scope_id=x.scope_id and c.action_ordinal=x.ordinal and c.action_phase='review'),
    'committedMicrounits',coalesce((select sum(z.actual_microunits)::text from private.r12_adaptive_call_admissions c
     join lateral(select max(actual_microunits) actual_microunits from private.r05_settlements
      where request_id=c.request_id and actual_microunits is not null) z on true
     where c.scope_id=x.scope_id and c.action_ordinal=x.ordinal),'0'),
    'unresolvedQuestions',coalesce((select case when jsonb_typeof(r.content->'result'->'additionalQuestions')='array'
     then r.content->'result'->'additionalQuestions' else '[]'::jsonb end from private.r12_adaptive_call_admissions c
     join private.r07_responses r on r.attempt_id=c.attempt_id
     where c.scope_id=x.scope_id and c.action_ordinal=x.ordinal and c.action_phase='review'),'[]'::jsonb)) order by x.ordinal)
   from private.r12_adaptive_actions x where x.scope_id=s.scope_id),'[]'::jsonb))
 from (select 1) base left join private.r12_adaptive_activations a on a.setup_id=s.id
$$;

do $$ declare n text;begin
 foreach n in array array['r12_adaptive_activations','r12_adaptive_actions',
  'r12_adaptive_action_dependencies','r12_adaptive_action_closures','r12_adaptive_failed_calls','r12_adaptive_call_admissions',
  'r12_adaptive_planner_receipts'] loop
  execute format('alter table private.%I enable row level security',n);
  execute format('revoke all on private.%I from public,anon,authenticated,service_role',n);
  execute format('create trigger adaptive_immutable before insert or update or delete on private.%I for each row execute function private.r12_owner_immutable()',n);
 end loop;
end $$;

-- Structural validation is deliberately independent of the R07 generic
-- repair/pivot counters. A new action is an ordinal under this one approval.
create function private.r12_adaptive_action_phases(kind text,repair_phase text default null)
returns jsonb language plpgsql immutable set search_path='' as $$
declare all_phases text[]:=array['plan','search','select','strategy','review'];i integer;begin
 if kind in ('initial','pivot') then return to_jsonb(all_phases);end if;
 if kind='followup' then return to_jsonb(all_phases[2:5]);end if;
 if kind='reasoning_review' then return to_jsonb(all_phases[4:5]);end if;
 if kind<>'repair' or repair_phase is null then raise exception 'r12_adaptive_action_kind_invalid';end if;
 i:=array_position(all_phases,repair_phase);
 if i is null then raise exception 'r12_adaptive_repair_phase_invalid';end if;
 -- A failed selector cannot import a search prepared for a different action;
 -- a failed review likewise needs a fresh strategy tied to that action.
 if repair_phase='select' then return to_jsonb(all_phases[2:5]);end if;
 if repair_phase='review' then return to_jsonb(all_phases[4:5]);end if;
 return to_jsonb(all_phases[i:5]);
end $$;

create function private.r12_adaptive_step_key(action_phase text) returns text
language sql immutable set search_path='' as $$
 select case action_phase when 'search' then 'search1' when 'select' then 'select1'
  when 'plan' then 'plan' when 'strategy' then 'strategy' when 'review' then 'review' end
$$;

-- The old receipt's live status changes when the head advances. Persist its
-- immutable, independently validated proof while the predecessor is current.
create function private.r12_adaptive_imports(p_plan uuid,require_current boolean default true)
returns jsonb language plpgsql set search_path='' as $$
declare result jsonb:='[]'::jsonb;phase text;item jsonb;begin
 foreach phase in array array['plan','search1','select1','strategy','review'] loop
  select jsonb_build_object('phase',phase,'attemptId',t.id,'artifactId',response.artifact_id,
   'responseHash',response.content_hash,'receiptProofHash',observation.proof->>'proofHash') into item
  from private.r07_attempts t
  join private.r07_responses response on response.attempt_id=t.id and response.business_id=t.business_id
  join private.r12_discovery_wires wire on wire.attempt_id=t.id and wire.business_id=t.business_id
  join private.r12_discovery_candidates c on c.request_id=wire.request_id
  join private.r12_discovery_receipt_checks check_row on check_row.request_id=c.request_id
  join private.r12_discovery_receipt_observations observation on observation.check_id=check_row.id and observation.proof is not null
  join private.r05_markers marker on marker.request_id=wire.request_id
  join private.r05_settlements settlement on settlement.request_id=wire.request_id and settlement.actual_microunits is not null and settlement.provider_request_id is not null
  where t.plan_id=p_plan and t.step_key=phase and t.status='completed'
   and response.content->>'outcome'='accepted'
   and response.content->'result'->>'candidateHash'=c.candidate_hash
   and response.content->'result'->>'routeProofHash'=observation.proof->>'proofHash'
   and settlement.actual_microunits=(c.candidate->>'reportedMicrousd')::bigint
   and settlement.provider_request_id=c.candidate->>'providerRequestId'
   and marker.created_at<= (c.candidate->>'receivedAt')::timestamptz
   and (c.candidate->>'receivedAt')::timestamptz<c.receipt_expires_at
  order by t.attempt desc,check_row.attempt desc limit 1;
  if item is null or item->>'receiptProofHash' !~ '^[a-f0-9]{64}$' then raise exception 'r12_adaptive_imported_phase_unverified';end if;
  result:=result||jsonb_build_array(item);
 end loop;
 return result;
end $$;

-- Reads expose live eligibility and real residual root authority. Saved V2
-- profiles remain readable with their old packets after expiry or revocation.
create function public.r12_owner_adaptive_read(p_business_id uuid,p_goal_id uuid,p_setup_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare goal private.r04_goal_versions;br private.r04_business_versions;cap private.r05_cap_versions;
 binding private.r12_owner_funding_bindings;funding jsonb;exp bigint;unknown boolean;
 closure jsonb;imports jsonb:='[]'::jsonb;eligible boolean:=false;reason text;
 profiles jsonb;grants jsonb;setups jsonb;active jsonb;deadline timestamptz;
 pending_receipts integer:=0;begin
 if auth.uid() is null or private.is_business_owner(p_business_id) is distinct from true
 then raise exception 'r12_adaptive_owner_required' using errcode='42501';end if;
 if p_goal_id is null and p_setup_id is not null then
  select s.goal_id into p_goal_id from private.r12_adaptive_setups s
  where s.id=p_setup_id and s.business_id=p_business_id and s.owner_id=auth.uid();
 end if;
 if p_goal_id is null then raise exception 'r12_adaptive_goal_required';end if;
 select gv.* into goal from private.r04_goal_versions gv join private.r04_goal_state gs using(business_id,goal_id,revision)
  where gv.business_id=p_business_id and gv.goal_id=p_goal_id;
 if goal.goal_id is null then raise exception 'r12_adaptive_goal_unavailable';end if;
 if p_setup_id is not null and not exists(select 1 from private.r12_adaptive_setups s
  where s.id=p_setup_id and s.business_id=p_business_id and s.goal_id=p_goal_id and s.owner_id=auth.uid())
 then raise exception 'r12_adaptive_setup_unavailable';end if;
 select bv.* into br from private.r04_business_versions bv join private.r04_business_state bs using(business_id,revision)
  where bv.business_id=p_business_id;
 select * into cap from private.r05_cap_versions where business_id=p_business_id and currency='USD' order by revision desc limit 1;
 select coalesce(sum(e.held),0),coalesce(bool_or(e.unknown),false) into exp,unknown
  from private.r05_exposure(p_business_id)e where e.currency='USD';
 select * into binding from private.r12_owner_funding_bindings where business_id=p_business_id;
 if binding.id is not null then funding:=private.r12_owner_funding(binding);end if;
 deadline:=((goal.content->'parsed'->'deadline'->>'date')||' '||coalesce(goal.content->'parsed'->'deadline'->>'time','23:59:59'))::timestamp
  at time zone (goal.content->'parsed'->'deadline'->>'timezone');
 begin
  closure:=private.r12_owner_episode_predecessor(p_business_id,p_goal_id);
  imports:=private.r12_adaptive_imports((closure->>'predecessorPlanId')::uuid,true);
  eligible:=true;reason:=null;
 exception when others then closure:=null;imports:='[]'::jsonb;eligible:=false;reason:='closed_settled_lineage_required';end;
 select coalesce(jsonb_agg(jsonb_build_object('profile',p.profile,'profileHash',p.profile_hash) order by p.id),'[]'::jsonb)
 into profiles from (select p.* from private.r12_owner_profiles p where p.profile->>'version'='r12.owner-research-profile.2'
 and (exists(select 1 from private.r12_adaptive_setups s where s.business_id=p_business_id and s.goal_id=p_goal_id and s.profile_id=p.id)
  or exists(select 1 from private.r12_owner_bootstrap_grants g where g.profile_id=p.id and g.business_id=p_business_id and g.owner_id=auth.uid()
   and g.adaptive_bounds is not null and g.valid_from<=clock_timestamp() and g.valid_until>clock_timestamp()
   and not exists(select 1 from private.r12_owner_grant_revocations r where r.grant_id=g.id)))
 order by p.id limit 32) p;
 select coalesce(jsonb_agg(x.row order by x.created_at desc),'[]'::jsonb) into grants from (
  select g.created_at,jsonb_build_object('id',g.id,'profileId',g.profile_id,'businessId',g.business_id,'goalId',p_goal_id,
   'goalRevision',goal.revision,'goalHash',goal.content_hash,'approvalHash',g.approval_hash,
   'allowsPaidFollowups',true,'maximumActions',(g.adaptive_bounds->>'maximumActions')::integer,
   'maximumRunMicrounits',g.adaptive_bounds->>'maximumRunMicrounits',
   'remainingScopes',greatest(0,least(rv.maximum_scopes,coalesce(g.maximum_scopes,rv.maximum_scopes))-usage.scope_count),
   'remainingAllocationMicrounits',greatest(0,least(rv.maximum_allocation_microunits,coalesce(g.maximum_allocation_microunits,rv.maximum_allocation_microunits))-usage.allocation)::text,
   'expiresAt',g.adaptive_bounds->>'expiresAt') row
  from private.r12_owner_bootstrap_grants g join private.r12_owner_grant_roots rt on rt.id=g.root_id and rt.business_id=g.business_id
  join private.r12_owner_grant_root_revisions rv on rv.root_id=rt.id and rv.revision=g.root_revision and rv.content_hash=g.root_revision_hash
  cross join lateral(select
   (select count(*) from private.r12_owner_activations a where a.grant_root_id=rt.id)
   +(select count(*) from private.r12_owner_episode_activations a where a.grant_root_id=rt.id)
   +(select count(*) from private.r12_adaptive_activations a where a.grant_root_id=rt.id) scope_count,
   (select coalesce(sum(a.allocation_microunits),0) from private.r12_owner_activations a where a.grant_root_id=rt.id)
   +(select coalesce(sum(a.allocation_microunits),0) from private.r12_owner_episode_activations a where a.grant_root_id=rt.id)
   +(select coalesce(sum(a.maximum_run_microusd),0) from private.r12_adaptive_activations a where a.grant_root_id=rt.id) allocation) usage
  where g.business_id=p_business_id and g.owner_id=auth.uid() and g.adaptive_bounds is not null
   and g.adaptive_bounds->>'goalId'=p_goal_id::text and (g.adaptive_bounds->>'goalRevision')::integer=goal.revision
   and g.adaptive_bounds->>'goalHash'=goal.content_hash and g.valid_from<=clock_timestamp()
   and g.valid_until>clock_timestamp() and rv.expires_at>clock_timestamp()
   and not exists(select 1 from private.r12_owner_grant_root_revisions newer where newer.root_id=rt.id and newer.revision>rv.revision)
   and not exists(select 1 from private.r12_owner_grant_revocations revoked where revoked.grant_id=g.id)
   and usage.scope_count<least(rv.maximum_scopes,coalesce(g.maximum_scopes,rv.maximum_scopes))
   and usage.allocation+(g.adaptive_bounds->>'maximumRunMicrounits')::bigint<=least(rv.maximum_allocation_microunits,coalesce(g.maximum_allocation_microunits,rv.maximum_allocation_microunits))
  order by g.created_at desc,g.id limit 32) x;
 select coalesce(jsonb_agg(private.r12_adaptive_setup_receipt(s) order by s.created_at desc,s.id desc),'[]'::jsonb)
 into setups from (select * from private.r12_adaptive_setups where business_id=p_business_id and goal_id=p_goal_id and owner_id=auth.uid()
  and (p_setup_id is null or id=p_setup_id) order by created_at desc,id desc limit 20)s;
 select jsonb_build_object('setupId',a.setup_id,'scopeId',a.scope_id,
  'quote',(select setup.quote from private.r12_adaptive_setups setup where setup.id=a.setup_id),
  'stopped',exists(select 1 from private.r05_revocations r where r.policy_id=a.policy_id)) into active
  from private.r12_adaptive_activations a where a.business_id=p_business_id and a.goal_id=p_goal_id order by a.created_at desc limit 1;
 if active is not null and active->'stopped'='true'::jsonb then
  select count(*) into pending_receipts from private.r12_adaptive_call_admissions call
   join private.r12_adaptive_activations a on a.scope_id=call.scope_id
   join private.r07_attempts attempt on attempt.id=call.attempt_id
   join private.r05_markers marker on marker.request_id=call.request_id
   left join private.r12_discovery_candidates candidate on candidate.request_id=call.request_id
   where call.scope_id=(active->>'scopeId')::uuid
    and not exists(select 1 from private.r12_adaptive_action_closures closure
     where closure.scope_id=call.scope_id and closure.action_ordinal=call.action_ordinal)
    and (attempt.status not in ('completed','rejected','failed','cancelled')
     or not exists(select 1 from private.r05_settlements settled
      where settled.request_id=call.request_id and settled.actual_microunits is not null
       and settled.provider_request_id is not null))
    and clock_timestamp()<coalesce(candidate.receipt_expires_at,
      least(a.expires_at+interval '30 minutes',marker.created_at+interval '60 minutes'));
 end if;
 if active is not null then active:=active||jsonb_build_object('pendingReceiptReadback',pending_receipts>0,
  'pendingReceiptCount',pending_receipts);end if;
 return jsonb_build_object('version','r12.owner-adaptive-catalog.1','businessId',p_business_id,'goalId',p_goal_id,
  'eligible',eligible,'reason',reason,'predecessorClosure',closure,
  'predecessorClosureHash',case when closure is null then null else private.stage14_hash(closure) end,
  'imports',imports,'business',jsonb_build_object('capRevision',coalesce(cap.revision,0),
   'committedMicrounits',exp::text,'currentLimitMicrounits',coalesce(cap.maximum_microunits,0)::text,
   'hasUnknown',unknown,'revision',br.revision,'hash',br.content_hash),
  'funding',case when funding is null then null else jsonb_build_object('authorityRootId',binding.authority_root_id,
   'bindingHash',funding->>'hash','revision',(funding->>'revision')::integer,
   'committedMicrounits',funding->>'committedMicrounits','pendingMicrounits',funding->>'pendingMicrounits',
   'currentLimitMicrounits',funding->>'maximumMicrounits','hasUnknown',funding->'hasUnknown') end,
  'deadline',deadline,'profiles',profiles,'grants',grants,'setups',setups,'activation',active,
  'actions',coalesce((select receipt->'actions' from jsonb_array_elements(setups) receipt where receipt->>'activated'='true' limit 1),'[]'::jsonb));
end $$;

-- The existing owner catalog's version-1 parser must never be handed a V2
-- profile. All other historical initial/episode behavior stays unchanged.
do $adaptive_legacy_catalog_patch$ declare d text;begin
 d:=pg_get_functiondef('public.r12_owner_research_read(uuid,uuid,uuid)'::regprocedure);
 if position('where gr.business_id=p_business_id and gr.owner_id=auth.uid()' in d)=0
 then raise exception 'r12_adaptive_legacy_catalog_changed';end if;
 d:=replace(d,'where gr.business_id=p_business_id and gr.owner_id=auth.uid()',
  $new$where p.profile->>'version'='r12.owner-research-profile.1' and gr.business_id=p_business_id and gr.owner_id=auth.uid()$new$);
 execute d;
end $adaptive_legacy_catalog_patch$;

create function private.r12_adaptive_activation_check(a private.r12_adaptive_activations)
returns void language plpgsql set search_path='' as $$
declare s private.r12_discovery_scopes;p private.r07_plans;prior private.r07_plans;
 gr private.r12_owner_bootstrap_grants;rt private.r12_owner_grant_roots;
 pol private.r05_policies;q private.r12_discovery_authorities;profile private.r12_owner_profiles;
 goal private.r04_goal_versions;setup private.r12_adaptive_setups;k text;v jsonb;total bigint:=0;
 root_revision jsonb;maximum_scopes integer;maximum_allocation bigint;scope_count integer;allocated bigint;begin
 perform 1 from public.businesses where id=a.business_id for update;
 if not found then raise exception 'r12_adaptive_business_required';end if;
 perform 1 from private.r12_owner_grant_roots where id=a.grant_root_id and business_id=a.business_id for update;
 if not found then raise exception 'r12_adaptive_root_required';end if;
 select * into s from private.r12_discovery_scopes where id=a.scope_id and business_id=a.business_id and goal_id=a.goal_id;
 select * into p from private.r07_plans where id=a.plan_id and business_id=a.business_id and goal_id=a.goal_id;
 select * into prior from private.r07_plans where id=a.predecessor_plan_id and business_id=a.business_id and goal_id=a.goal_id;
 select * into gr from private.r12_owner_bootstrap_grants where id=a.grant_id and business_id=a.business_id;
 select * into rt from private.r12_owner_grant_roots where id=a.grant_root_id and business_id=a.business_id;
 select * into pol from private.r05_policies where id=a.policy_id and business_id=a.business_id and goal_id=a.goal_id;
 select * into q from private.r12_discovery_authorities where scope_id=a.scope_id and business_id=a.business_id and goal_id=a.goal_id;
 select * into profile from private.r12_owner_profiles where id=a.profile_id;
 select * into setup from private.r12_adaptive_setups where id=a.setup_id;
 select gv.* into goal from private.r04_goal_versions gv join private.r04_goal_state gs using(business_id,goal_id,revision)
  where gv.business_id=a.business_id and gv.goal_id=a.goal_id;
 if s.id is null or p.id is null or prior.id is null or gr.id is null or rt.id is null or pol.id is null or q.scope_id is null
 or profile.id is null or goal.goal_id is null or setup.id is null
 or s.origin is distinct from 'owner_adaptive' or s.amendment->>'version' is distinct from 'r12.discovery-owner-adaptive.1'
 or p.content->>'format' is distinct from 'r12.discovery-adaptive.1' or p.content->>'discoveryScopeId' is distinct from s.id::text
 or p.content->>'discoveryScopeHash' is distinct from s.amendment_hash or p.previous_plan_id is distinct from prior.id
 or p.owner_id is distinct from a.owner_id or p.policy_id is distinct from pol.id or p.content_hash is distinct from a.plan_hash
 or p.content_hash is distinct from private.r04_hash(p.content) or s.amendment_hash is distinct from a.scope_hash
 or s.amendment_hash is distinct from private.stage14_hash(s.amendment) or q.plan_hash is distinct from p.content_hash
 or q.plan is distinct from p.content or gr.root_id is distinct from rt.id or gr.profile_id is distinct from a.profile_id
 or rt.binding_id is distinct from a.binding_id or rt.business_id is distinct from a.business_id
 or pol.actor_id is distinct from a.owner_id or pol.content_hash is distinct from p.content->>'policyHash'
 or not exists(select 1 from public.businesses b where b.id=a.business_id and b.owner_user_id=a.owner_id)
 or a.predecessor_closure->>'predecessorPlanId' is distinct from prior.id::text
 or a.predecessor_closure->>'businessId' is distinct from a.business_id::text
 or a.predecessor_closure->>'goalId' is distinct from a.goal_id::text
 or s.amendment->'imports' is distinct from private.r12_adaptive_imports(prior.id,false)
 or a.maximum_paid_calls>64-(a.predecessor_closure->>'baseDispatches')::integer
 or 5>32-(a.predecessor_closure->>'baseChildren')::integer
 or a.expires_at>(s.amendment->>'expiresAt')::timestamptz
 or a.expires_at>(pol.payload->>'expiresAt')::timestamptz
 or a.maximum_run_microusd>private.r05_money(pol.payload->'policyLimitMicrounits')
 or (pol.payload->>'maximumDispatches')::integer<a.maximum_paid_calls
 or a.expires_at>q.valid_until then raise exception 'r12_adaptive_activation_binding_invalid';end if;
 if setup.business_id is distinct from a.business_id or setup.goal_id is distinct from a.goal_id
 or setup.owner_id is distinct from a.owner_id or setup.scope_id is distinct from a.scope_id
 or setup.profile_id is distinct from a.profile_id or setup.grant_id is distinct from a.grant_id
 or setup.binding_id is distinct from a.binding_id or setup.policy_id is distinct from a.policy_id
 or setup.policy_hash is distinct from pol.content_hash or setup.setup_hash is distinct from s.amendment->>'setupHash'
 or setup.preview->>'version' is distinct from 'r12.adaptive-research-preview.1'
 or setup.preview->'predecessor' is distinct from a.predecessor_closure
 or setup.preview->>'predecessorHash' is distinct from a.predecessor_closure_hash
 or setup.preview->'imports' is distinct from s.amendment->'imports'
 or setup.preview->>'quoteHash' is distinct from a.quote_hash
 or setup.quote->>'quoteHash' is distinct from a.quote_hash
 or setup.preview->>'maximumRunMicrounits' is distinct from a.maximum_run_microusd::text
 or (setup.preview->>'maximumActions')::integer is distinct from a.maximum_extra_actions
 or (setup.preview->>'maximumPaidCalls')::integer is distinct from a.maximum_paid_calls
 or setup.preview->>'expiresAt' is distinct from s.amendment->>'expiresAt'
 or jsonb_build_object('marketSetKey',setup.selection->>'marketSetKey',
  'topicKey',setup.selection->>'topicKey') is distinct from s.amendment->'selection'
 or setup.selection->>'approvedQuery' is distinct from s.amendment->>'approvedQuery'
 or setup.selection->'allowedDomains' is distinct from s.amendment->'allowedDomains'
 or setup.selection->'excludedDomains' is distinct from s.amendment->'excludedDomains'
 or setup.approval_hash is distinct from s.amendment->>'approvalHash'
 or setup.quote->'ceilings' is distinct from jsonb_build_object('plan',a.phase_ceilings->'plan',
  'search',a.phase_ceilings->'search1','select',a.phase_ceilings->'select1',
  'strategy',a.phase_ceilings->'strategy','review',a.phase_ceilings->'review')
 then raise exception 'r12_adaptive_saved_packet_mismatch';end if;
 if gr.owner_id is distinct from a.owner_id or gr.root_id is distinct from rt.id
 or gr.valid_from>clock_timestamp() or gr.valid_until<a.expires_at
 or exists(select 1 from private.r12_owner_grant_revocations r where r.grant_id=gr.id)
 then raise exception 'r12_adaptive_grant_unavailable';end if;
 perform private.r12_adaptive_profile_check(profile,clock_timestamp());
 perform private.r12_owner_pins_check(profile);
 root_revision:=private.r12_adaptive_grant_check(gr,profile,goal,rt,clock_timestamp());
 if gr.adaptive_bounds is null or (gr.adaptive_bounds->>'maximumActions')::integer<a.maximum_extra_actions
 or (gr.adaptive_bounds->>'maximumRunMicrounits')::bigint<a.maximum_run_microusd
 or (gr.adaptive_bounds->>'expiresAt')::timestamptz<a.expires_at
 or p.content->>'goalHash' is distinct from goal.content_hash
 or (p.content->>'goalRevision')::integer is distinct from goal.revision
 then raise exception 'r12_adaptive_grant_envelope_invalid';end if;
 maximum_scopes:=least(coalesce((root_revision->>'maximumScopes')::integer,rt.maximum_scopes),
  coalesce(gr.maximum_scopes,(root_revision->>'maximumScopes')::integer,rt.maximum_scopes));
 maximum_allocation:=least(coalesce((root_revision->>'maximumAllocationMicrounits')::bigint,rt.maximum_allocation_microunits),
  coalesce(gr.maximum_allocation_microunits,(root_revision->>'maximumAllocationMicrounits')::bigint,rt.maximum_allocation_microunits));
 select (select count(*) from private.r12_owner_activations where grant_root_id=rt.id)
   +(select count(*) from private.r12_owner_episode_activations where grant_root_id=rt.id)
   +(select count(*) from private.r12_adaptive_activations where grant_root_id=rt.id),
  (select coalesce(sum(allocation_microunits),0) from private.r12_owner_activations where grant_root_id=rt.id)
   +(select coalesce(sum(allocation_microunits),0) from private.r12_owner_episode_activations where grant_root_id=rt.id)
   +(select coalesce(sum(maximum_run_microusd),0) from private.r12_adaptive_activations where grant_root_id=rt.id)
 into scope_count,allocated;
 if scope_count>maximum_scopes or allocated>maximum_allocation then raise exception 'r12_adaptive_grant_exhausted';end if;
 perform private.r04_keys(a.content,array['version','setupId','scopeId','businessId','goalId','planId','predecessorPlanId','grantId','grantRootId','bindingId','profileId','policyId','scopeHash','planHash','predecessorClosureHash','quoteHash','phaseCeilings','maximumRunMicrousd','maximumExtraActions','maximumPaidCalls','expiresAt']);
 if a.content->>'version' is distinct from 'r12.adaptive-activation.1' or a.content->>'scopeId' is distinct from a.scope_id::text
 or a.content->>'setupId' is distinct from a.setup_id::text
 or a.content->>'businessId' is distinct from a.business_id::text or a.content->>'goalId' is distinct from a.goal_id::text
 or a.content->>'planId' is distinct from a.plan_id::text or a.content->>'predecessorPlanId' is distinct from a.predecessor_plan_id::text
 or a.content->>'grantId' is distinct from a.grant_id::text or a.content->>'grantRootId' is distinct from a.grant_root_id::text
 or a.content->>'bindingId' is distinct from a.binding_id::text or a.content->>'profileId' is distinct from a.profile_id::text
 or a.content->>'policyId' is distinct from a.policy_id::text or a.content->>'scopeHash' is distinct from a.scope_hash
 or a.content->>'planHash' is distinct from a.plan_hash or a.content->>'predecessorClosureHash' is distinct from a.predecessor_closure_hash
 or a.content->>'quoteHash' is distinct from a.quote_hash or a.content->'phaseCeilings' is distinct from a.phase_ceilings
 or a.content->'maximumRunMicrousd' is distinct from to_jsonb(a.maximum_run_microusd)
 or a.content->'maximumExtraActions' is distinct from to_jsonb(a.maximum_extra_actions)
 or a.content->'maximumPaidCalls' is distinct from to_jsonb(a.maximum_paid_calls)
 or (a.content->>'expiresAt')::timestamptz is distinct from a.expires_at then raise exception 'r12_adaptive_activation_content_invalid';end if;
 perform private.r04_keys(a.phase_ceilings,array['plan','search1','select1','strategy','review']);
 foreach k in array array['plan','search1','select1','strategy','review'] loop
  v:=a.phase_ceilings->k;
  if jsonb_typeof(v) is distinct from 'number' or v::text !~ '^[1-9][0-9]{0,7}$' or (v::text)::bigint>a.maximum_run_microusd then raise exception 'r12_adaptive_phase_ceiling_invalid';end if;
  total:=total+(v::text)::bigint;
 end loop;
 if total>a.maximum_run_microusd or p.content->'steps' is null or jsonb_array_length(p.content->'steps')<>5
 or exists(select 1 from jsonb_array_elements(p.content->'steps') with ordinality z(step,ord)
   where step->>'key' is distinct from (array['plan','search1','select1','strategy','review'])[ord]
   or step->>'operationKey' is distinct from 'research.r12.'||a.scope_id::text||'.'||(step->>'key')
   or step->>'adapter' is distinct from 'r12.discovery.'||a.scope_id::text||'.'||(step->>'key'))
 then raise exception 'r12_adaptive_five_slots_required';end if;
end $$;

create function private.r12_adaptive_activation_guard() returns trigger language plpgsql set search_path='' as $$
begin
 perform private.r12_adaptive_activation_check(new);
 return new;
end $$;
create constraint trigger adaptive_activation_guard after insert on private.r12_adaptive_activations
deferrable initially deferred
for each row execute function private.r12_adaptive_activation_guard();

create function private.r12_adaptive_call_guard() returns trigger language plpgsql set search_path='' as $$
declare a private.r12_adaptive_activations;decision private.r12_adaptive_actions;
 t private.r07_attempts;r private.r05_requests;begin
 if tg_op<>'INSERT' then raise exception 'r12_adaptive_immutable';end if;
 select * into a from private.r12_adaptive_activations where scope_id=new.scope_id;
 select * into decision from private.r12_adaptive_actions where scope_id=new.scope_id and ordinal=new.action_ordinal;
 select * into t from private.r07_attempts where id=new.attempt_id and business_id=a.business_id;
 select * into r from private.r05_requests where id=new.request_id and business_id=a.business_id;
 if a.scope_id is null or decision.scope_id is null or t.id is null or r.id is null
 or decision.content->'phases'->(new.position-1) is distinct from to_jsonb(new.action_phase)
 or new.step_key is distinct from private.r12_adaptive_step_key(new.action_phase)
 or t.plan_id is distinct from a.plan_id or t.step_key is distinct from new.step_key
 or t.adaptive_action_ordinal is distinct from new.action_ordinal
 or t.adaptive_action_hash is distinct from decision.content_hash
 or r.workflow_run_id is distinct from t.id or r.policy_id is distinct from a.policy_id
 or r.payload->>'operationKey' is distinct from 'research.r12.'||a.scope_id::text||'.'||new.step_key
 or r.source_key is distinct from 'r05:'||t.id||':'||r.idempotency_key
 or r.liability_microunits is distinct from new.maximum_microusd
 or new.maximum_microusd>(a.phase_ceilings->>new.step_key)::bigint
 then raise exception 'r12_adaptive_exact_call_required';end if;
 return new;
end $$;
create trigger adaptive_call_guard before insert or update or delete on private.r12_adaptive_call_admissions
for each row execute function private.r12_adaptive_call_guard();

-- Open actions reserve the quoted liability of every phase not yet converted
-- to an R05 request. The action and conversion ledger are both append-only;
-- closing an action releases only its undispatched remainder. Business locks
-- in R05 and R07 serialize the derived hold with competing requests.
create function private.r12_adaptive_outstanding_hold(b uuid,policy uuid default null)
returns bigint language sql stable set search_path='' as $$
 select coalesce(sum(greatest(0,decision.maximum_microusd-coalesce(issued.liability,0))),0)::bigint
 from private.r12_adaptive_actions decision
 join private.r12_adaptive_activations activation on activation.scope_id=decision.scope_id
 left join lateral(select sum(c.maximum_microusd) liability
  from private.r12_adaptive_call_admissions c
  where c.scope_id=decision.scope_id and c.action_ordinal=decision.ordinal) issued on true
 where activation.business_id=b and (policy is null or activation.policy_id=policy)
  and clock_timestamp()<activation.expires_at
  and not exists(select 1 from private.r05_revocations rev where rev.policy_id=activation.policy_id)
  and not exists(select 1 from private.r12_adaptive_action_closures closure
   where closure.scope_id=decision.scope_id and closure.action_ordinal=decision.ordinal);
$$;

create function private.r12_adaptive_outstanding_root_hold(binding_id uuid)
returns bigint language sql stable set search_path='' as $$
 select coalesce(sum(greatest(0,decision.maximum_microusd-coalesce(issued.liability,0))),0)::bigint
 from private.r12_adaptive_actions decision
 join private.r12_adaptive_activations activation on activation.scope_id=decision.scope_id
 left join lateral(select sum(c.maximum_microusd) liability
  from private.r12_adaptive_call_admissions c
  where c.scope_id=decision.scope_id and c.action_ordinal=decision.ordinal) issued on true
 where activation.binding_id=binding_id
  and clock_timestamp()<activation.expires_at
  and not exists(select 1 from private.r05_revocations rev where rev.policy_id=activation.policy_id)
  and not exists(select 1 from private.r12_adaptive_action_closures closure
   where closure.scope_id=decision.scope_id and closure.action_ordinal=decision.ordinal);
$$;

create function private.r12_adaptive_original_root_hold(b uuid,root_id uuid)
returns bigint language sql stable set search_path='' as $$
 select coalesce((select private.r12_adaptive_outstanding_root_hold(binding.id)
  from private.r12_owner_funding_bindings binding
  where binding.business_id=b and binding.kind='legacy_research_root'
   and binding.authority_root_id=root_id),0)::bigint;
$$;

create function private.r12_adaptive_hold_conversion(r private.r05_requests)
returns bigint language sql stable set search_path='' as $$
 select coalesce((select r.liability_microunits
  from private.r07_attempts attempt
  join private.r12_adaptive_activations activation on activation.plan_id=attempt.plan_id
  join private.r12_adaptive_actions decision on decision.scope_id=activation.scope_id
   and decision.ordinal=attempt.adaptive_action_ordinal
   and decision.content_hash=attempt.adaptive_action_hash
  where attempt.id=r.workflow_run_id and attempt.business_id=r.business_id
   and attempt.status='scheduled' and activation.policy_id=r.policy_id
   and r.idempotency_key='r07:'||attempt.id
   and decision.content->'phases' ? (case attempt.step_key
    when 'search1' then 'search' when 'select1' then 'select' else attempt.step_key end)
   and r.liability_microunits<=(activation.phase_ceilings->>attempt.step_key)::bigint
   and not exists(select 1 from private.r12_adaptive_call_admissions c where c.attempt_id=attempt.id)
   and not exists(select 1 from private.r12_adaptive_action_closures closure
    where closure.scope_id=decision.scope_id and closure.action_ordinal=decision.ordinal)),0)::bigint;
$$;

-- R05's cap and policy checks account for held downstream phases for every
-- competing request. The currently converting adaptive call discounts exactly
-- its own phase hold until R07 records its request in the action ledger.
do $adaptive_r05_hold_patch$ declare d text;begin
 d:=pg_get_functiondef('private.r05_admissible(private.r05_requests)'::regprocedure);
 if position($old$total-own+r.liability_microunits>cap or policy_total-own+r.liability_microunits>private.r05_money(p.payload->'policyLimitMicrounits')$old$ in d)=0
 then raise exception 'r12_adaptive_r05_cap_changed';end if;
 d:=replace(d,$old$total-own+r.liability_microunits>cap or policy_total-own+r.liability_microunits>private.r05_money(p.payload->'policyLimitMicrounits')$old$,
  $new$total-own+r.liability_microunits+private.r12_adaptive_outstanding_hold(r.business_id)
  -private.r12_adaptive_hold_conversion(r)>cap
  or policy_total-own+r.liability_microunits+private.r12_adaptive_outstanding_hold(r.business_id,r.policy_id)
  -private.r12_adaptive_hold_conversion(r)>private.r05_money(p.payload->'policyLimitMicrounits')$new$);
 execute d;
end $adaptive_r05_hold_patch$;

create function private.r12_adaptive_financial_guard(r private.r05_requests,t private.r07_attempts,
 p private.r07_plans,s private.r12_discovery_scopes,is_marker boolean) returns void
 language plpgsql set search_path='' as $$
declare activation private.r12_adaptive_activations;decision private.r12_adaptive_actions;
 binding private.r12_owner_funding_bindings;funding jsonb;phase text;held bigint;unknown boolean;
 own_held bigint:=0;other_unknown boolean:=false;begin
 select * into activation from private.r12_adaptive_activations where scope_id=s.id and plan_id=p.id;
 select * into decision from private.r12_adaptive_actions where scope_id=s.id and ordinal=t.adaptive_action_ordinal;
 select * into binding from private.r12_owner_funding_bindings where id=activation.binding_id;
 phase:=case t.step_key when 'search1' then 'search' when 'select1' then 'select' else t.step_key end;
 if activation.scope_id is null or decision.scope_id is null or binding.id is null
 or decision.content_hash is distinct from t.adaptive_action_hash or not(decision.content->'phases' ? phase)
 or r.policy_id is distinct from activation.policy_id or r.workflow_run_id is distinct from t.id
 or r.liability_microunits>(activation.phase_ceilings->>t.step_key)::bigint
 or exists(select 1 from private.r12_adaptive_action_closures cl
   where cl.scope_id=s.id and cl.action_ordinal=decision.ordinal)
 then raise exception 'r12_adaptive_exact_financial_call_required';end if;
 perform private.r12_adaptive_scope_resolve(s.id);
 select coalesce(sum(e.held),0),coalesce(bool_or(e.unknown),false) into held,unknown
  from private.r05_exposure(activation.business_id)e where e.policy_id=activation.policy_id;
 if unknown or held+private.r12_adaptive_outstanding_hold(activation.business_id,activation.policy_id)
  -private.r12_adaptive_hold_conversion(r)>activation.maximum_run_microusd
 or exists(select 1 from private.r05_exposure(activation.business_id)e where e.unknown)
 then raise exception 'r12_adaptive_run_budget_unavailable';end if;
 funding:=private.r12_owner_funding(binding);
 if binding.kind='legacy_research_root' then
  select coalesce(sum(e.held) filter(where e.request_id=r.id),0),
   coalesce(bool_or(e.is_pending and e.request_id<>r.id),false)
   into own_held,other_unknown from private.r12_discovery_exposure(binding.authority_root_id)e;
 else
  select coalesce(sum(e.held) filter(where e.source_key=r.source_key),0),
   coalesce(bool_or(e.unknown and e.source_key is distinct from r.source_key),false)
   into own_held,other_unknown from private.r05_exposure(activation.business_id)e where e.currency='USD';
 end if;
 if other_unknown or (funding->>'pendingMicrounits')::bigint>own_held
 or (funding->>'committedMicrounits')::bigint+private.r12_adaptive_outstanding_root_hold(binding.id)
  -private.r12_adaptive_hold_conversion(r)
  >(funding->>'maximumMicrounits')::bigint
 then raise exception 'r12_adaptive_root_budget_unavailable';end if;
 if is_marker then perform private.r12_discovery_mark_guard(r,t,p,s);end if;
end $$;

do $adaptive_financial_guard_patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_discovery_financial_guard()'::regprocedure);
 if position($old$if scope.origin in ('owner_initial','owner_episode') then$old$ in d)=0
 then raise exception 'r12_adaptive_financial_guard_changed';end if;
 d:=replace(d,$old$if scope.origin in ('owner_initial','owner_episode') then$old$,
  $new$if scope.origin='owner_adaptive' then
 perform private.r12_adaptive_financial_guard(r,a,p,scope,tg_table_name='r05_markers');
 return new;end if;
 if scope.origin in ('owner_initial','owner_episode') then$new$);
 execute d;
end $adaptive_financial_guard_patch$;

-- An older route sharing a legacy original root cannot spend phase liability
-- already held for the adaptive successor, even when the Business cap is wider.
do $adaptive_original_root_hold_patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_discovery_financial_guard()'::regprocedure);
 if position($old$(budget->>'committedMicrousd')::bigint-own_held+r.liability_microunits>(budget->>'maximumMicrousd')::bigint$old$ in d)=0
 then raise exception 'r12_adaptive_original_root_guard_changed';end if;
 d:=replace(d,$old$(budget->>'committedMicrousd')::bigint-own_held+r.liability_microunits>(budget->>'maximumMicrousd')::bigint$old$,
  $new$(budget->>'committedMicrousd')::bigint-own_held+r.liability_microunits
  +private.r12_adaptive_original_root_hold(r.business_id,scope.budget_authority_root_id)
  >(budget->>'maximumMicrousd')::bigint$new$);
 execute d;
end $adaptive_original_root_hold_patch$;

create function private.r12_adaptive_reserve_call(t private.r07_attempts,r private.r05_requests)
returns void language plpgsql set search_path='' as $$
declare activation private.r12_adaptive_activations;decision private.r12_adaptive_actions;
 phase text;position integer;h private.r07_heads;begin
 select * into activation from private.r12_adaptive_activations where plan_id=t.plan_id;
 if activation.scope_id is null then raise exception 'r12_adaptive_activation_required';end if;
 select * into decision from private.r12_adaptive_actions
  where scope_id=activation.scope_id and ordinal=t.adaptive_action_ordinal
   and content_hash=t.adaptive_action_hash;
 select * into h from private.r07_heads where business_id=t.business_id and goal_id=t.goal_id;
 phase:=case t.step_key when 'search1' then 'search' when 'select1' then 'select' else t.step_key end;
 select ord into position from jsonb_array_elements_text(decision.content->'phases')
  with ordinality phases(value,ord) where value=phase;
 if decision.scope_id is null or position is null or r.id is null or h.plan_id is distinct from t.plan_id
 or h.reason='owner_stopped' or h.dispatches>=64
 or (select count(*) from private.r12_adaptive_call_admissions where scope_id=activation.scope_id)>=activation.maximum_paid_calls
 then raise exception 'r12_adaptive_reservation_unadmitted';end if;
 insert into private.r12_adaptive_call_admissions(scope_id,action_ordinal,position,action_phase,
  step_key,attempt_id,request_id,maximum_microusd)
 values(activation.scope_id,decision.ordinal,position,phase,t.step_key,t.id,r.id,r.liability_microunits);
end $$;

do $adaptive_r07_reserve_patch$ declare d text;begin
 d:=pg_get_functiondef('public.r07_controller(uuid,uuid,text,jsonb,uuid,text,text,bigint,text)'::regprocedure);
 if position($old$update private.r07_attempts set status='reserved',reason='admitted' where id=a.id;$old$ in d)=0
 then raise exception 'r12_adaptive_r07_reserve_changed';end if;
 d:=replace(d,$old$update private.r07_attempts set status='reserved',reason='admitted' where id=a.id;$old$,
  $new$if p.content->>'format'='r12.discovery-adaptive.1' then
 perform private.r12_adaptive_reserve_call(a,request);end if;
 update private.r07_attempts set status='reserved',reason='admitted' where id=a.id;$new$);
 execute d;
end $adaptive_r07_reserve_patch$;

-- A previously marked adaptive call remains reconcilable after owner Stop or
-- a Goal revision. This changes no admission, bind, dispatch or send gate.
do $adaptive_receipt_status_patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_discovery_receipt_status(private.r12_discovery_candidates)'::regprocedure);
 if position($old$if h.reason='owner_stopped' or$old$ in d)=0
 then raise exception 'r12_adaptive_receipt_status_changed';end if;
 d:=replace(d,$old$if h.reason='owner_stopped' or$old$,
  $new$if p.content->>'format'='r12.discovery-adaptive.1' then
  if clock_timestamp()>=c.receipt_expires_at then state:='expired';
  elsif o.proof is not null then state:='verified';
  elsif o.terminal then state:='terminal';
  elsif q.attempt=3 and (o.check_id is not null or clock_timestamp()>=n) then state:='exhausted';
  elsif q.id is not null and o.check_id is null and clock_timestamp()<n then state:='checking_receipt';
  else state:='awaiting_receipt';end if;
  return jsonb_build_object('requestId',c.request_id,'candidateHash',c.candidate_hash,
   'status',state,'attempts',coalesce(q.attempt,0),'nextCheckAt',
   case when state in ('awaiting_receipt','checking_receipt') then n else null end,
   'receiptExpiresAt',c.receipt_expires_at,'diagnostic',o.diagnostic,
   'proofHash',o.proof->>'proofHash');
 end if;
 if h.reason='owner_stopped' or$new$);
 execute d;
end $adaptive_receipt_status_patch$;

do $adaptive_r12_format_patch$ declare d text;name text;begin
 foreach name in array array[
  'public.r12_discovery_server(uuid,uuid,text,jsonb,text)',
  'private.r12_discovery_response_guard()',
  'private.r12_discovery_completed_phase(private.r07_attempts,private.r07_plans)'] loop
  d:=pg_get_functiondef(name::regprocedure);
  if position($old$'r12.discovery.1','r12.discovery-episode.1','r12.discovery-review.1'$old$ in d)=0
  then raise exception 'r12_adaptive_r12_format_changed: %',name;end if;
  d:=replace(d,$old$'r12.discovery.1','r12.discovery-episode.1','r12.discovery-review.1'$old$,
   $new$'r12.discovery.1','r12.discovery-episode.1','r12.discovery-adaptive.1','r12.discovery-review.1'$new$);
  execute d;
 end loop;
end $adaptive_r12_format_patch$;

-- A marked call has a separate, bounded receipt authority. Owner Stop and a
-- later Goal revision revoke fresh execution, but cannot erase its paid proof.
do $adaptive_r12_receipt_authority_patch$ declare d text;begin
 d:=pg_get_functiondef('public.r12_discovery_server(uuid,uuid,text,jsonb,text)'::regprocedure);
 if position($old$and private.r12_authority_owner_current(scoped_auth))$old$ in d)=0
 then raise exception 'r12_adaptive_scoped_authority_changed';end if;
 d:=replace(d,$old$and private.r12_authority_owner_current(scoped_auth))$old$,
  $new$and (private.r12_authority_owner_current(scoped_auth)
  or (p.content->>'format'='r12.discovery-adaptive.1'
   and p_operation in ('inputs','load','stage','claim','record','observe','diagnose')
   and exists(select 1 from private.r07_bindings receipt_binding
    join private.r05_markers paid_marker on paid_marker.request_id=receipt_binding.request_id
    join private.r07_markers dispatch_marker on dispatch_marker.attempt_id=a.id
    where receipt_binding.attempt_id=a.id and receipt_binding.business_id=p_business_id)
   and scoped_auth.receipt_until>clock_timestamp())))$new$);
 execute d;
end $adaptive_r12_receipt_authority_patch$;

-- Observation and diagnosis use the same bounded, screened records for every
-- paid adaptive phase. Legacy scopes remain review-only.
do $adaptive_r12_observation_patch$ declare d text;begin
 d:=pg_get_functiondef('public.r12_discovery_server(uuid,uuid,text,jsonb,text)'::regprocedure);
 if position($old$if not (a.step_key='review' or (a.step_key='strategy' and exists(select 1 from private.r12_pilot_research_authorizations(w.scope_id,p_business_id) authz where authz.scope_id=w.scope_id and authz.business_id=p_business_id))) or w.business_id$old$ in d)=0
 or position($old$'research.r12.'||w.scope_id::text||'.'||a.step_key$old$ in d)=0
 or position($old$w.binding->>'phase' is distinct from a.step_key$old$ in d)=0
 then raise exception 'r12_adaptive_observation_identity_changed';end if;
 d:=replace(d,$old$if not (a.step_key='review' or (a.step_key='strategy' and exists(select 1 from private.r12_pilot_research_authorizations(w.scope_id,p_business_id) authz where authz.scope_id=w.scope_id and authz.business_id=p_business_id))) or w.business_id$old$,
  $new$if not (a.step_key='review' or (a.step_key='strategy' and exists(select 1 from private.r12_pilot_research_authorizations(w.scope_id,p_business_id) authz where authz.scope_id=w.scope_id and authz.business_id=p_business_id))
 or (p.content->>'format'='r12.discovery-adaptive.1' and exists(
  select 1 from private.r12_adaptive_call_admissions admitted
  where admitted.attempt_id=a.id and admitted.request_id=r.id and admitted.scope_id=w.scope_id
   and admitted.step_key=a.step_key and admitted.action_ordinal=a.adaptive_action_ordinal
   and exists(select 1 from private.r12_adaptive_actions decision
    where decision.scope_id=w.scope_id and decision.ordinal=admitted.action_ordinal
     and decision.content_hash=a.adaptive_action_hash))))
 or w.business_id$new$);
 execute d;
end $adaptive_r12_observation_patch$;

create function private.r12_adaptive_wire_validate(r private.r05_requests,a private.r07_attempts,
 p private.r07_plans,s private.r12_discovery_scopes,v jsonb) returns void
 language plpgsql set search_path='' as $$
declare activation private.r12_adaptive_activations;decision private.r12_adaptive_actions;
 call private.r12_adaptive_call_admissions;planner private.r12_adaptive_planner_receipts;
 setup private.r12_adaptive_setups;request jsonb;body jsonb;q jsonb;route jsonb;
 phase text;approved_query text;tokens integer;maximum_bytes integer;schema_name text;begin
 select * into activation from private.r12_adaptive_activations where scope_id=s.id and plan_id=p.id;
 select * into decision from private.r12_adaptive_actions where scope_id=s.id and ordinal=a.adaptive_action_ordinal;
 select * into call from private.r12_adaptive_call_admissions where attempt_id=a.id and request_id=r.id;
 select * into setup from private.r12_adaptive_setups where id=activation.setup_id;
 phase:=case a.step_key when 'search1' then 'search' when 'select1' then 'select' else a.step_key end;
 if activation.scope_id is null or decision.scope_id is null or call.attempt_id is null or setup.id is null
 or a.adaptive_action_hash is distinct from decision.content_hash
 or call.action_phase is distinct from phase or call.action_ordinal is distinct from decision.ordinal
 or r.workflow_run_id is distinct from a.id or r.policy_id is distinct from activation.policy_id
 or p.content_hash is distinct from activation.plan_hash or s.amendment_hash is distinct from activation.scope_hash
 then raise exception 'r12_adaptive_wire_activation_required';end if;
 perform private.r04_keys(v,array['version','scopeId','scopeHash','attemptId','requestId','phase',
  'actionHash','actionOrdinal','requestJson','requestHash','wireBody','wireHash','quote','dependencyPins']);
 if v->>'version' is distinct from 'r12.adaptive-wire.1' or v->>'scopeId' is distinct from s.id::text
 or v->>'scopeHash' is distinct from s.amendment_hash or v->>'attemptId' is distinct from a.id::text
 or v->>'requestId' is distinct from r.id::text or v->>'phase' is distinct from a.step_key
 or v->>'actionHash' is distinct from decision.content_hash
 or v->'actionOrdinal' is distinct from to_jsonb(decision.ordinal)
 or v->'dependencyPins' is distinct from a.dependency_pins
 or v->>'requestHash' is distinct from private.stage14_hash((v->>'requestJson')::jsonb)
 or r.payload->>'requestHash' is distinct from v->>'requestHash'
 or v->>'wireHash' is distinct from encode(extensions.digest(convert_to(v->>'wireBody','UTF8'),'sha256'),'hex')
 or r.payload->>'wireRequestHash' is distinct from v->>'wireHash'
 then raise exception 'r12_adaptive_wire_binding_invalid';end if;
 request:=(v->>'requestJson')::jsonb;body:=(v->>'wireBody')::jsonb;q:=v->'quote';
 perform private.r12_adaptive_quote_check(q,setup.quote);
 tokens:=(q->'outputTokens'->>phase)::integer;maximum_bytes:=(q->'requestBytes'->>phase)::integer;
 route:=q->(case when phase='review' then 'reviewer' else 'luna' end);
 if r.liability_microunits is distinct from (q->'ceilings'->>phase)::bigint
 or r.liability_microunits>call.maximum_microusd
 or octet_length(v->>'requestJson')>maximum_bytes
 or octet_length(v->>'wireBody')>maximum_bytes
 or octet_length(v->>'wireBody') is distinct from (r.payload->>'wireRequestBytes')::integer
 or (r.payload->>'maximumOutputTokens')::integer is distinct from tokens
 or r.payload->>'providerModelId' is distinct from route->>'modelId'
 or r.payload->'sourceDomains' is distinct from s.amendment->'allowedDomains'
 or request->'model'->>'provider' is distinct from 'openrouter'
 or request->'model'->>'providerModelId' is distinct from route->>'modelId'
 or body->>'model' is distinct from route->>'modelId'
 or body->'max_tokens' is distinct from to_jsonb(tokens)
 or body->'stream' is distinct from 'false'::jsonb
 or body->'provider'->'only' is distinct from jsonb_build_array(route->>'endpoint')
 or body->'provider'->'allow_fallbacks' is distinct from 'false'::jsonb
 or body->'provider'->'require_parameters' is distinct from 'true'::jsonb
 or body->'provider'->'data_collection' is distinct from '"deny"'::jsonb
 or body->'provider'->'zdr' is distinct from 'true'::jsonb
 or body->'provider'->'max_price' is distinct from route->'priceLimit'
 then raise exception 'r12_adaptive_wire_route_invalid';end if;
 perform private.r04_keys(body->'provider',array['only','allow_fallbacks','require_parameters','data_collection','zdr','max_price']);
 approved_query:=s.amendment->>'approvedQuery';
 if decision.ordinal>0 then approved_query:=approved_query||E'\nInvestigate: '||(decision.content->>'question');end if;
 if phase='search' then
  perform private.r04_keys(body,array['model','provider','messages','tools','tool_choice','max_tool_calls','max_tokens','stream']);
  if request->>'query' is distinct from approved_query
   or request->'allowedDomains' is distinct from s.amendment->'allowedDomains'
   or request->'excludedDomains' is distinct from s.amendment->'excludedDomains'
   or body->'messages'->1->>'content' is distinct from approved_query
   or body->'tools' is distinct from jsonb_build_array(jsonb_build_object('type','openrouter:web_search',
    'parameters',jsonb_build_object('engine','exa','mode','fast','max_uses',1,'max_results',4,
     'max_total_results',4,'max_characters',1800,'allowed_domains',s.amendment->'allowedDomains',
     'excluded_domains',s.amendment->'excludedDomains')))
   or body->>'tool_choice' is distinct from 'required' or body->'max_tool_calls' is distinct from '1'::jsonb
  then raise exception 'r12_adaptive_search_scope_invalid';end if;
 else
  perform private.r04_keys(body,array['model','provider','messages','response_format','max_tokens','stream']
   ||case when phase='select' then array['reasoning'] else array[]::text[] end);
  schema_name:=case phase when 'plan' then 'geographic_discovery_plan_v2'
   when 'select' then 'discovery_evidence_selection_v2'
   when 'strategy' then 'r12_adaptive_strategy_v1'
   when 'review' then 'r12_adaptive_review_v1' end;
  if jsonb_typeof(body->'messages') is distinct from 'array' or jsonb_array_length(body->'messages') not between 1 and 4
   or exists(select 1 from jsonb_array_elements(body->'messages') m
    where jsonb_typeof(m->'content') is distinct from 'string' or m->>'role' not in ('system','user'))
   or body->'response_format'->>'type' is distinct from 'json_schema'
   or body->'response_format'->'json_schema'->>'name' is distinct from schema_name
   or body->'response_format'->'json_schema'->'strict' is distinct from 'true'::jsonb
   or request->'requestMetadata'->>'adaptiveActionHash' is distinct from decision.content_hash
   or request->'requestMetadata'->'adaptiveActionOrdinal' is distinct from to_jsonb(decision.ordinal)
   or request->'requestMetadata'->>'adaptiveScopeHash' is distinct from s.amendment_hash
   or request->'requestMetadata'->>'adaptiveBindingHash' !~ '^[a-f0-9]{64}$'
   or (phase='select' and body->'reasoning' is distinct from '{"effort":"none"}'::jsonb)
   or (phase<>'select' and body ? 'reasoning')
  then raise exception 'r12_adaptive_structured_scope_invalid';end if;
  if phase='plan' and decision.ordinal=0 then
   select * into planner from private.r12_adaptive_planner_receipts where scope_id=s.id;
   if planner.scope_id is null or v->>'requestHash' is distinct from planner.request_hash
    or v->>'wireHash' is distinct from planner.wire_hash
    or request->'requestMetadata'->>'adaptiveBindingHash' is distinct from planner.binding_hash
   then raise exception 'r12_adaptive_initial_preflight_wire_required';end if;
  end if;
 end if;
end $$;

do $adaptive_wire_patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_discovery_wire_validate(private.r05_requests,private.r07_attempts,private.r07_plans,private.r12_discovery_scopes,jsonb)'::regprocedure);
 if position($old$if not coalesce(p.content->>'format' in ($old$ in d)=0
 then raise exception 'r12_adaptive_wire_validator_changed';end if;
 d:=replace(d,$old$if not coalesce(p.content->>'format' in ($old$,
  $new$if p.content->>'format'='r12.discovery-adaptive.1' then
 perform private.r12_adaptive_wire_validate(r,a,p,s,v);return;end if;
 if not coalesce(p.content->>'format' in ($new$);
 execute d;
end $adaptive_wire_patch$;

create function private.r12_adaptive_dependency_guard() returns trigger language plpgsql set search_path='' as $$
declare a private.r12_adaptive_activations;decision private.r12_adaptive_actions;
 t private.r07_attempts;r private.r07_responses;begin
 if tg_op<>'INSERT' then raise exception 'r12_adaptive_immutable';end if;
 select * into a from private.r12_adaptive_activations where scope_id=new.scope_id;
 select * into decision from private.r12_adaptive_actions where scope_id=new.scope_id and ordinal=new.action_ordinal;
 select * into t from private.r07_attempts where id=new.source_attempt_id;
 select * into r from private.r07_responses where attempt_id=t.id;
 if a.scope_id is null or decision.scope_id is null or t.id is null or r.attempt_id is null
 or t.plan_id is distinct from a.plan_id or t.step_key is distinct from new.step_key
 or t.adaptive_action_ordinal>=new.action_ordinal or t.status<>'completed'
 or (decision.content->'phases' ? (case new.step_key when 'search1' then 'search' when 'select1' then 'select' else new.step_key end))
 or r.content_hash is distinct from new.response_hash
 then raise exception 'r12_adaptive_dependency_unverified';end if;
 return new;
end $$;
create trigger adaptive_dependency_guard before insert on private.r12_adaptive_action_dependencies
 for each row execute function private.r12_adaptive_dependency_guard();

-- Reconstruct current capacity from actual R07/R05 ledgers. This is a private
-- diagnostic and admission input, never a cached or owner-supplied balance.
create function private.r12_adaptive_snapshot(scope uuid) returns jsonb
language plpgsql set search_path='' as $$
declare a private.r12_adaptive_activations;h private.r07_heads;used_actions integer;used_calls integer;
 exposure bigint;unknown boolean;begin
 select * into a from private.r12_adaptive_activations where scope_id=scope;
 if a.scope_id is null then raise exception 'r12_adaptive_activation_required';end if;
 select * into h from private.r07_heads where business_id=a.business_id and goal_id=a.goal_id;
 select count(*) filter(where ordinal>0) into used_actions from private.r12_adaptive_actions where scope_id=scope;
 select count(*) into used_calls from private.r12_adaptive_call_admissions where scope_id=scope;
 select coalesce(sum(e.held),0),coalesce(bool_or(e.unknown),false) into exposure,unknown
 from private.r05_exposure(a.business_id)e where e.policy_id=a.policy_id;
 return jsonb_build_object('version','r12.adaptive-snapshot.1','scopeId',scope,'planId',a.plan_id,
  'actionsUsed',used_actions,'callsUsed',used_calls,'childrenUsed',h.children_created,
  'dispatchesUsed',h.dispatches,'remainingChildren',greatest(0,32-h.children_created),
  'remainingDispatches',greatest(0,64-h.dispatches),'runExposureMicrousd',exposure,
  'runRemainingMicrousd',greatest(0,a.maximum_run_microusd-exposure),
  'unknownLiability',unknown,'expiresAt',a.expires_at);
end $$;

create function private.r12_adaptive_scope_resolve(scope uuid) returns jsonb
language plpgsql set search_path='' as $$
declare a private.r12_adaptive_activations;s private.r12_discovery_scopes;
 h private.r07_heads;g private.r04_goal_versions;b private.r04_business_versions;begin
 select * into a from private.r12_adaptive_activations where scope_id=scope;
 select * into s from private.r12_discovery_scopes where id=scope;
 select * into h from private.r07_heads where business_id=a.business_id and goal_id=a.goal_id;
 select gv.* into g from private.r04_goal_versions gv join private.r04_goal_state gs using(business_id,goal_id,revision)
  where gv.business_id=a.business_id and gv.goal_id=a.goal_id;
 select bv.* into b from private.r04_business_versions bv join private.r04_business_state bs using(business_id,revision)
  where bv.business_id=a.business_id;
 if a.scope_id is null or s.id is null or h.goal_id is null or g.goal_id is null or b.business_id is null
 or s.origin is distinct from 'owner_adaptive' or s.amendment_hash is distinct from a.scope_hash
 or h.plan_id is distinct from a.plan_id or h.state in ('stopped','completed')
 or g.revision is distinct from (s.amendment->>'goalRevision')::integer
 or g.content_hash is distinct from s.amendment->>'goalHash' or g.preference<>'ready'
 or b.revision is distinct from (s.amendment->>'businessRevision')::integer
 or b.content_hash is distinct from s.amendment->>'businessHash' or b.preference<>'setup'
 or clock_timestamp()>=a.expires_at
 or not exists(select 1 from public.businesses where id=a.business_id and owner_user_id=a.owner_id)
 or not exists(select 1 from private.r05_confirmations c where c.policy_id=a.policy_id and c.actor_id=a.owner_id)
 or exists(select 1 from private.r05_revocations r where r.policy_id=a.policy_id)
 or private.r05_paused(a.business_id,'business',a.business_id)
 or private.r05_paused(a.business_id,'quest',a.goal_id)
 then raise exception 'r12_adaptive_current_scope_required';end if;
 return jsonb_build_object('executionAuthorized',true,'scopeHash',a.scope_hash,
  'scopeId',a.scope_id,'planId',a.plan_id,'planHash',a.plan_hash);
end $$;

-- The shared R07/R05 key bridges predate this format. Accept only the exact
-- saved adaptive authority; keep their old-format branches unchanged. Fresh
-- R05 work also rechecks current scope, while marked paid receipts survive Stop.
do $adaptive_scoped_keys_patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_controller_keys(uuid,uuid,jsonb,text,text)'::regprocedure);
 if position($old$if v is not null and not coalesce(v->>'format' in ($old$ in d)=0
 then raise exception 'r12_adaptive_controller_keys_changed';end if;
 d:=replace(d,$old$if v is not null and not coalesce(v->>'format' in ($old$,
  $new$if v->>'format'='r12.discovery-adaptive.1' then
  if not exists(select 1 from private.r12_discovery_authorities q
   join private.r12_adaptive_activations activation on activation.scope_id=q.scope_id
   where q.business_id=b and q.goal_id=g and q.plan=v
    and q.plan_hash=activation.plan_hash and activation.business_id=b and activation.goal_id=g
    and q.controller_key_hash=controller_hash and q.admission_key_hash=admission_hash
    and q.receipt_until>clock_timestamp())
  then raise exception 'r12_exact_scoped_controller_authority_required';end if;
  return;
 end if;
 if v is not null and not coalesce(v->>'format' in ($new$);
 execute d;
 d:=pg_get_functiondef('private.r12_admission_key_scope(uuid,text,jsonb,text)'::regprocedure);
 if position($old$if a.id is null or not coalesce(p.content->>'format' in ($old$ in d)=0
 then raise exception 'r12_adaptive_admission_keys_changed';end if;
 d:=replace(d,$old$if a.id is null or not coalesce(p.content->>'format' in ($old$,
  $new$if p.content->>'format'='r12.discovery-adaptive.1' then
  if a.id is null or not exists(select 1 from private.r12_discovery_authorities q
   join private.r12_adaptive_activations activation on activation.scope_id=q.scope_id
   where q.business_id=b and q.goal_id=p.goal_id and q.plan=p.content
    and q.plan_hash=p.content_hash and activation.plan_id=p.id
    and q.admission_key_hash=key_hash and q.receipt_until>clock_timestamp())
   or (op in ('prepare','guard') and (request_payload->>'operationKey' is distinct from
    'research.r12.'||(p.content->>'discoveryScopeId')||'.'||a.step_key
    or request_payload->'accounting' is distinct from '{"kind":"r05"}'::jsonb))
   or (r.id is not null and (r.policy_id is distinct from p.policy_id
    or r.workflow_run_id is distinct from a.id
    or r.payload->>'operationKey' is distinct from
     'research.r12.'||(p.content->>'discoveryScopeId')||'.'||a.step_key))
  then raise exception 'r12_exact_scoped_admission_authority_required';end if;
  if op in ('prepare','guard','reserve','dispatch') then
   perform private.r12_adaptive_scope_resolve((p.content->>'discoveryScopeId')::uuid);
  elsif op in ('settle','readback') and not exists(select 1 from private.r07_markers marked
    join private.r05_markers paid on paid.request_id=r.id
    where marked.attempt_id=a.id) then
   raise exception 'r12_adaptive_marked_receipt_required';
  end if;
  return;
 end if;
 if a.id is null or not coalesce(p.content->>'format' in ($new$);
 execute d;
end $adaptive_scoped_keys_patch$;

do $adaptive_r07_gate_patch$ declare d text;begin
 d:=pg_get_functiondef('private.r07_gate(private.r07_plans,jsonb)'::regprocedure);
 if position($old$if not coalesce(p.content->>'format' in ($old$ in d)=0
 or position($old$a.mode='qualification' and not coalesce(p.content->>'format' in ($old$ in d)=0
 then raise exception 'r12_adaptive_r07_gate_changed';end if;
 d:=replace(d,$old$if not coalesce(p.content->>'format' in ($old$,
  $new$if p.content->>'format'<>'r12.discovery-adaptive.1' and not coalesce(p.content->>'format' in ($new$);
 d:=replace(d,$old$a.mode='qualification' and not coalesce(p.content->>'format' in ($old$,
  $new$a.mode='qualification' and p.content->>'format'<>'r12.discovery-adaptive.1' and not coalesce(p.content->>'format' in ($new$);
 execute d;
end $adaptive_r07_gate_patch$;

create function private.r12_adaptive_action_check(a private.r12_adaptive_activations,body jsonb)
returns bigint language plpgsql set search_path='' as $$
declare n integer;kind text;prior private.r12_adaptive_actions;phase text;quoted bigint:=0;
 repair_phase text;repair jsonb;expected jsonb;scope private.r12_discovery_scopes;begin
 perform private.r04_safe(body);
 perform private.r04_keys(body,array['version','scopeId','scopeHash','ordinal','kind','previousActionHash','previousReviewHash','question','hypothesis','expectedInformationGain','counterevidenceQuestion','phases','repair']);
 if body->>'version' is distinct from 'r12.adaptive-action.1' or body->>'scopeId' is distinct from a.scope_id::text
 or body->>'scopeHash' is distinct from a.scope_hash or jsonb_typeof(body->'ordinal') is distinct from 'number'
 or body->>'ordinal' !~ '^(0|[1-9]|10)$' or body->>'kind' not in ('initial','followup','repair','pivot','reasoning_review')
 or body->>'previousReviewHash' !~ '^[a-f0-9]{64}$' or jsonb_typeof(body->'phases') is distinct from 'array'
 then raise exception 'r12_adaptive_action_identity_invalid';end if;
 n:=(body->>'ordinal')::integer;kind:=body->>'kind';
 if n>a.maximum_extra_actions or (n=0 and kind<>'initial') or (n>0 and kind='initial') then raise exception 'r12_adaptive_action_limit';end if;
 foreach phase in array array['question','hypothesis','expectedInformationGain','counterevidenceQuestion'] loop
  if jsonb_typeof(body->phase) is distinct from 'string' or length(btrim(body->>phase)) not between 1 and 500 then raise exception 'r12_adaptive_action_explanation_required';end if;
 end loop;
 select * into scope from private.r12_discovery_scopes where id=a.scope_id;
 if scope.id is null or length(scope.amendment->>'approvedQuery') not between 20 and 800
 or (n=0 and body->>'question' is distinct from scope.amendment->>'approvedQuery')
 or (n>0 and length((scope.amendment->>'approvedQuery')||E'\nInvestigate: '||(body->>'question'))>800)
 then raise exception 'r12_adaptive_public_query_bound';end if;
 if n=0 then
  if body->'previousActionHash' is distinct from 'null'::jsonb or exists(select 1 from private.r12_adaptive_actions where scope_id=a.scope_id)
  then raise exception 'r12_adaptive_first_action_required';end if;
 else
  select * into prior from private.r12_adaptive_actions where scope_id=a.scope_id and ordinal=n-1;
  if prior.scope_id is null or body->>'previousActionHash' is distinct from prior.content_hash
  or exists(select 1 from private.r12_adaptive_actions where scope_id=a.scope_id and ordinal>=n)
  then raise exception 'r12_adaptive_action_chain_invalid';end if;
 end if;
 repair:=body->'repair';
 if kind='repair' then
  perform private.r04_keys(repair,array['failedAttemptId','failureHash','defect']);
  if repair->>'failedAttemptId' is null or repair->>'failureHash' !~ '^[a-f0-9]{64}$'
  or repair->>'defect' not in ('schema','format','identified_reasoning')
  then raise exception 'r12_adaptive_repair_evidence_required';end if;
  select c.action_phase into repair_phase from private.r12_adaptive_call_admissions c
   join private.r07_attempts t on t.id=c.attempt_id
   join private.r12_adaptive_failed_calls failure on failure.attempt_id=t.id
   where c.scope_id=a.scope_id and c.action_ordinal=n-1 and c.attempt_id=(repair->>'failedAttemptId')::uuid
   and t.status='failed' and failure.scope_id=c.scope_id and failure.action_ordinal=c.action_ordinal
   and failure.request_id=c.request_id and failure.failure_hash=repair->>'failureHash'
   and failure.defect=repair->>'defect';
  if repair_phase is null then raise exception 'r12_adaptive_verified_failure_required';end if;
 elsif repair is distinct from 'null'::jsonb then raise exception 'r12_adaptive_nonrepair_payload_invalid';end if;
 expected:=private.r12_adaptive_action_phases(kind,repair_phase);
 if body->'phases' is distinct from expected then raise exception 'r12_adaptive_action_topology_invalid';end if;
 for phase in select jsonb_array_elements_text(expected) loop
  quoted:=quoted+(a.phase_ceilings->>private.r12_adaptive_step_key(phase))::bigint;
 end loop;
 if quoted>a.maximum_run_microusd then raise exception 'r12_adaptive_action_quote_exceeded';end if;
 return quoted;
end $$;

-- Each prior action is closed by real R07 terminal attempts and known R05
-- settlement. A fresh independent review permits the next investigation;
-- only an exact, classified failed attempt permits a repair from the last
-- already accepted review. No requested review hash is trusted on its own.
create function private.r12_adaptive_previous_review(a private.r12_adaptive_activations,body jsonb)
returns void language plpgsql set search_path='' as $$
declare n integer:=(body->>'ordinal')::integer;latest_hash text;old_review private.r07_responses;
 prior private.r12_adaptive_actions;bad integer;done integer;expected integer;
 failed uuid;failure text;recommended jsonb;fallback private.r12_adaptive_missing_recommendations;begin
 select r.* into old_review from private.r07_responses r
  where r.attempt_id=(select (s.amendment->'imports'->4->>'attemptId')::uuid
    from private.r12_discovery_scopes s where s.id=a.scope_id)
  and r.content_hash=(select s.amendment->'imports'->4->>'responseHash'
    from private.r12_discovery_scopes s where s.id=a.scope_id);
 if old_review.attempt_id is null then raise exception 'r12_adaptive_imported_review_required';end if;
 latest_hash:=old_review.content_hash;
 if n>0 then
  select * into prior from private.r12_adaptive_actions where scope_id=a.scope_id and ordinal=n-1;
  if not exists(select 1 from private.r12_adaptive_action_closures cl
    where cl.scope_id=a.scope_id and cl.action_ordinal=prior.ordinal and cl.action_hash=prior.content_hash
    and cl.state=case when body->>'kind'='repair' then 'failed' else 'completed' end)
  then raise exception 'r12_adaptive_previous_action_open';end if;
  select count(*),count(*) filter(where t.status in ('completed','rejected','failed','cancelled'))
   into expected,done from private.r12_adaptive_call_admissions c
   join private.r07_attempts t on t.id=c.attempt_id
   where c.scope_id=a.scope_id and c.action_ordinal=prior.ordinal;
  if expected=0 or expected<>done
   or exists(select 1 from private.r12_adaptive_call_admissions c
    join private.r07_attempts t on t.id=c.attempt_id
    left join private.r05_markers marker on marker.request_id=c.request_id
    where c.scope_id=a.scope_id and c.action_ordinal=prior.ordinal
    and (marker.request_id is null or not exists(select 1 from private.r05_settlements z
      where z.request_id=c.request_id and z.actual_microunits is not null)))
   or exists(select 1 from private.r07_attempts t where t.plan_id=a.plan_id
      and t.status in ('scheduled','reserved','dispatched','uncertain','responded'))
  then raise exception 'r12_adaptive_previous_action_unsettled';end if;
  select r.content_hash into latest_hash from private.r12_adaptive_call_admissions c
   join private.r07_attempts t on t.id=c.attempt_id
   join private.r07_responses r on r.attempt_id=t.id
   join private.r12_discovery_candidates candidate on candidate.request_id=c.request_id
   where c.scope_id=a.scope_id and c.action_phase='review' and c.action_ordinal<n
   and t.status='completed' and r.content->>'outcome'='accepted'
   and private.r12_discovery_receipt_status(candidate.*)->>'status'='verified'
   order by c.action_ordinal desc limit 1;
  latest_hash:=coalesce(latest_hash,old_review.content_hash);
  if body->>'kind'<>'repair' then
   if not exists(select 1 from private.r12_adaptive_call_admissions c
    join private.r07_attempts t on t.id=c.attempt_id
    join private.r07_responses r on r.attempt_id=t.id
    join private.r12_discovery_candidates candidate on candidate.request_id=c.request_id
    where c.scope_id=a.scope_id and c.action_ordinal=prior.ordinal and c.action_phase='review'
    and t.status='completed' and r.content->>'outcome'='accepted'
    and private.r12_discovery_receipt_status(candidate.*)->>'status'='verified')
   then raise exception 'r12_adaptive_new_independent_review_required';end if;
   select r.content->'result'->'review'->'recommendedNextAction' into recommended
   from private.r12_adaptive_call_admissions c
    join private.r07_attempts t on t.id=c.attempt_id
    join private.r07_responses r on r.attempt_id=t.id
   where c.scope_id=a.scope_id and c.action_ordinal=prior.ordinal and c.action_phase='review'
    and t.status='completed' and r.content->>'outcome'='accepted';
   select * into fallback from private.r12_adaptive_missing_recommendations
    where scope_id=a.scope_id and action_ordinal=n and action_hash=private.stage14_hash(body)
    and origin_review_hash=latest_hash;
   if (recommended is null or recommended='null'::jsonb) and fallback.scope_id is not null
    and body->>'kind'='reasoning_review' and body->'phases'='["strategy","review"]'::jsonb
    and private.r12_adaptive_missing_gap(a.scope_id,(select r.content->'result'->'review'
      from private.r07_attempts t join private.r07_responses r on r.attempt_id=t.id
      where t.plan_id=a.plan_id and t.adaptive_action_ordinal=prior.ordinal
       and t.step_key='review' and t.status='completed'))->>'gapHash'=fallback.gap_hash
   then null;
   elsif recommended is null or recommended='null'::jsonb
    or recommended->>'kind' is distinct from body->>'kind'
    or recommended->>'publicQuestion' is distinct from body->>'question'
    or recommended->>'hypothesis' is distinct from body->>'hypothesis'
    or recommended->>'expectedInformationGain' is distinct from body->>'expectedInformationGain'
    or recommended->>'counterevidenceQuestion' is distinct from body->>'counterevidenceQuestion'
   then raise exception 'r12_adaptive_review_recommendation_required';end if;
  else
   failed:=(body->'repair'->>'failedAttemptId')::uuid;failure:=body->'repair'->>'failureHash';
   if not exists(select 1 from private.r12_adaptive_call_admissions c
    join private.r07_attempts t on t.id=c.attempt_id
    join private.r12_adaptive_failed_calls saved on saved.attempt_id=t.id
    where c.scope_id=a.scope_id and c.action_ordinal=prior.ordinal
    and c.attempt_id=failed and t.status='failed' and saved.scope_id=c.scope_id
    and saved.action_ordinal=c.action_ordinal and saved.request_id=c.request_id
    and saved.failure_hash=failure)
   then raise exception 'r12_adaptive_exact_repair_failure_required';end if;
  end if;
 end if;
 if body->>'previousReviewHash' is distinct from latest_hash
 then raise exception 'r12_adaptive_review_pin_invalid';end if;
end $$;

create function private.r12_adaptive_complete_action(p_scope uuid,p_action_hash text,p_ordinal integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare activation private.r12_adaptive_activations;decision private.r12_adaptive_actions;
 closure private.r12_adaptive_action_closures;h private.r07_heads;
 count_attempts integer;terminal integer;failures integer;open_requests integer;
 review private.r07_responses;review_candidate private.r12_discovery_candidates;
 committed bigint;outcome text;state text;begin
 select * into activation from private.r12_adaptive_activations where scope_id=p_scope;
 if activation.scope_id is null then raise exception 'r12_adaptive_activation_required';end if;
 perform 1 from public.businesses where id=activation.business_id and owner_user_id=activation.owner_id for update;
 if not found then raise exception 'r12_adaptive_owner_changed';end if;
 select * into h from private.r07_heads where business_id=activation.business_id and goal_id=activation.goal_id for update;
 select * into decision from private.r12_adaptive_actions where scope_id=p_scope and ordinal=p_ordinal;
 if h.plan_id is distinct from activation.plan_id or decision.scope_id is null or decision.content_hash is distinct from p_action_hash
 then raise exception 'r12_adaptive_current_action_required';end if;
 select * into closure from private.r12_adaptive_action_closures where scope_id=p_scope and action_ordinal=p_ordinal;
 if closure.scope_id is not null then
  return jsonb_build_object('closed',true,'state',closure.state,'outcome',closure.outcome,
   'actionHash',closure.action_hash,'committedMicrounits',closure.committed_microusd::text,
   'replayed',true,'shouldDispatch',false);
 end if;
 select count(*),count(*) filter(where status in ('completed','rejected','failed','cancelled')),
  count(*) filter(where status in ('rejected','failed','cancelled')) into count_attempts,terminal,failures
 from private.r07_attempts where plan_id=activation.plan_id and adaptive_action_ordinal=p_ordinal
 and adaptive_action_hash=p_action_hash;
 if count_attempts=0 or terminal<>count_attempts or count_attempts>jsonb_array_length(decision.content->'phases')
 then raise exception 'r12_adaptive_action_unsettled';end if;
 select count(*) into open_requests from private.r12_adaptive_call_admissions c
  where c.scope_id=p_scope and c.action_ordinal=p_ordinal
  and not (exists(select 1 from private.r05_settlements z where z.request_id=c.request_id
    and z.actual_microunits is not null and z.provider_request_id is not null)
   or exists(select 1 from private.r05_releases rel where rel.request_id=c.request_id));
 if open_requests<>0 or exists(select 1 from private.r05_exposure(activation.business_id)e where e.unknown)
 then raise exception 'r12_adaptive_action_liability_unknown';end if;
 select coalesce(sum(z.actual_microunits),0) into committed from private.r12_adaptive_call_admissions c
  join lateral(select max(actual_microunits) actual_microunits from private.r05_settlements
      where request_id=c.request_id and actual_microunits is not null) z on true
  where c.scope_id=p_scope and c.action_ordinal=p_ordinal;
 if failures>0 then state:='failed';outcome:=null;
 else
  if count_attempts<>jsonb_array_length(decision.content->'phases') then raise exception 'r12_adaptive_action_incomplete';end if;
  select r.* into review from private.r07_attempts t join private.r07_responses r on r.attempt_id=t.id
  where t.plan_id=activation.plan_id and t.adaptive_action_ordinal=p_ordinal and t.step_key='review' and t.status='completed';
  select c.* into review_candidate from private.r12_adaptive_call_admissions admission
   join private.r12_discovery_candidates c on c.request_id=admission.request_id
   where admission.scope_id=p_scope and admission.action_ordinal=p_ordinal and admission.action_phase='review';
  if review.attempt_id is null or review.content->>'outcome'<>'accepted' or review_candidate.request_id is null
   or private.r12_discovery_receipt_status(review_candidate)->>'status'<>'verified'
  then raise exception 'r12_adaptive_independent_review_required';end if;
  outcome:=review.content->'result'->>'outcome';
  if outcome not in ('TEST','NEEDS_MORE_EVIDENCE','REJECT') then raise exception 'r12_adaptive_review_outcome_invalid';end if;
  state:='completed';
 end if;
 insert into private.r12_adaptive_action_closures(scope_id,action_ordinal,action_hash,state,outcome,review_hash,committed_microusd)
 values(p_scope,p_ordinal,p_action_hash,state,outcome,review.content_hash,committed);
 return jsonb_build_object('closed',true,'state',state,'outcome',outcome,'actionHash',p_action_hash,'committedMicrounits',committed::text,
  'shouldDispatch',false);
end $$;

-- Classify only a saved, screened response failure with an exact known paid
-- settlement. A failed call has no accepted R07 response or research artifact.
create function private.r12_adaptive_diagnosed_failure(p_scope uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare activation private.r12_adaptive_activations;decision private.r12_adaptive_actions;
 call private.r12_adaptive_call_admissions;failed private.r12_adaptive_failed_calls;
 attempt private.r07_attempts;request private.r05_requests;h private.r07_heads;
 diagnostic private.r12_discovery_response_observations;
 observed private.r12_discovery_response_observations;charge private.r05_settlements;
 candidate private.r12_discovery_candidates;defect text;body jsonb;failure_hash text;
 parsed jsonb;invalid_json boolean:=false;
begin
 select * into activation from private.r12_adaptive_activations where scope_id=p_scope;
 if activation.scope_id is null then raise exception 'r12_adaptive_activation_required';end if;
 perform 1 from public.businesses where id=activation.business_id and owner_user_id=activation.owner_id for update;
 if not found then raise exception 'r12_adaptive_owner_changed';end if;
 perform 1 from private.r12_owner_grant_roots where id=activation.grant_root_id and business_id=activation.business_id for update;
 if not found then raise exception 'r12_adaptive_grant_root_changed';end if;
 select * into h from private.r07_heads where business_id=activation.business_id and goal_id=activation.goal_id for update;
 if h.plan_id is distinct from activation.plan_id then raise exception 'r12_adaptive_current_head_required';end if;
 select * into decision from private.r12_adaptive_actions where scope_id=p_scope order by ordinal desc limit 1;
 if decision.scope_id is null then return jsonb_build_object('handled',false,'reason','no_action');end if;
 select * into failed from private.r12_adaptive_failed_calls where scope_id=p_scope
  and action_ordinal=decision.ordinal order by created_at desc limit 1;
 if failed.attempt_id is not null then
  return jsonb_build_object('handled',true,'reason','diagnosed_failure_recorded',
   'failureHash',failed.failure_hash,'replayed',true);
 end if;
 if exists(select 1 from private.r12_adaptive_action_closures where scope_id=p_scope and action_ordinal=decision.ordinal)
 then return jsonb_build_object('handled',false,'reason','action_closed');end if;
 select c.* into call from private.r12_adaptive_call_admissions c
  join private.r07_attempts t on t.id=c.attempt_id
  where c.scope_id=p_scope and c.action_ordinal=decision.ordinal
   and t.status in ('dispatched','uncertain')
  order by c.position desc limit 1;
 if call.attempt_id is null then return jsonb_build_object('handled',false,'reason','no_marked_failure');end if;
 select * into attempt from private.r07_attempts where id=call.attempt_id for update;
 select * into request from private.r05_requests where id=call.request_id;
 select * into diagnostic from private.r12_discovery_response_observations
  where request_id=call.request_id and kind='rejected';
 select * into observed from private.r12_discovery_response_observations
  where request_id=call.request_id and kind='received';
 select * into charge from private.r05_settlements where request_id=call.request_id
  and actual_microunits is not null and provider_request_id is not null
  order by created_at desc,id desc limit 1;
 select * into candidate from private.r12_discovery_candidates where request_id=call.request_id;
 if attempt.plan_id is distinct from activation.plan_id or attempt.adaptive_action_hash is distinct from decision.content_hash
  or attempt.adaptive_action_ordinal is distinct from decision.ordinal
  or request.workflow_run_id is distinct from attempt.id or request.policy_id is distinct from activation.policy_id
  or not exists(select 1 from private.r05_markers where request_id=request.id and business_id=activation.business_id)
  or not exists(select 1 from private.r07_markers where attempt_id=attempt.id and business_id=activation.business_id)
  or not exists(select 1 from private.r12_discovery_transport_claims where request_id=request.id)
  or diagnostic.request_id is null or observed.request_id is null or charge.request_id is null
  or diagnostic.payload->'observationSaved' is distinct from 'true'::jsonb
  or observed.payload->>'contentState' is distinct from 'complete'
  or observed.payload->>'providerRequestId' is distinct from charge.provider_request_id
  or charge.actual_microunits>request.liability_microunits
  or exists(select 1 from private.r05_exposure(activation.business_id)e where e.unknown)
  or exists(select 1 from private.r12_adaptive_call_admissions c
   join private.r07_attempts t on t.id=c.attempt_id
   where c.scope_id=p_scope and c.action_ordinal=decision.ordinal and c.attempt_id<>attempt.id
    and t.status in ('scheduled','reserved','dispatched','uncertain','responded'))
  or (candidate.request_id is not null and private.r12_discovery_receipt_status(candidate)->>'status'<>'verified')
 then return jsonb_build_object('handled',false,'reason','paid_failure_unverified');end if;
 defect:=case diagnostic.payload->>'code' when 'response_schema' then 'schema'
  when 'json_parse' then 'format'
  when 'domain_validation' then case when attempt.step_key in ('strategy','review') then 'identified_reasoning' else null end
  else null end;
 if defect is null then return jsonb_build_object('handled',false,'reason','failure_not_repairable');end if;
 begin parsed:=(observed.payload->>'content')::jsonb;
 exception when invalid_text_representation then invalid_json:=true;end;
 if (defect='format' and not invalid_json)
  or (defect='schema' and (invalid_json or jsonb_array_length(diagnostic.payload->'issues')=0))
  or (defect='identified_reasoning' and (invalid_json or candidate.request_id is null
   or private.r12_discovery_receipt_status(candidate)->>'status'<>'verified'))
 then return jsonb_build_object('handled',false,'reason','failure_classification_unverified');end if;
 body:=jsonb_build_object('version','r12.adaptive-failed-call.1','scopeId',p_scope,
  'actionOrdinal',decision.ordinal,'attemptId',attempt.id,'requestId',request.id,
  'diagnosticHash',diagnostic.payload_hash,'settlementHash',charge.receipt_hash,'defect',defect);
 failure_hash:=private.stage14_hash(body);
 insert into private.r12_adaptive_failed_calls(scope_id,action_ordinal,attempt_id,request_id,
  diagnostic_hash,settlement_hash,defect,failure_hash)
 values(p_scope,decision.ordinal,attempt.id,request.id,diagnostic.payload_hash,charge.receipt_hash,defect,failure_hash);
 insert into private.r07_core_admissions values(txid_current(),attempt.id) on conflict do nothing;
 update private.r07_attempts set status='failed',reason='adaptive_diagnosed_'||defect where id=attempt.id;
 update public.workflow_runs set status='failed',completed_at=clock_timestamp() where id=attempt.id;
 update public.task_contracts set status='failed' where id=private.stage4_deterministic_uuid('r07:task:'||attempt.id);
 update public.worker_runs set status='failed',failure=jsonb_build_object('code','adaptive_paid_output_invalid',
  'diagnosticHash',diagnostic.payload_hash),completed_at=clock_timestamp()
  where id=private.stage4_deterministic_uuid('r07:worker:'||attempt.id);
 update public.workflow_stage_runs set status='failed',failure=jsonb_build_object('code','adaptive_paid_output_invalid',
  'diagnosticHash',diagnostic.payload_hash),completed_at=clock_timestamp()
  where id=private.stage4_deterministic_uuid('r07:stage:'||attempt.id);
 delete from private.r07_core_admissions where transaction_id=txid_current() and workflow_run_id=attempt.id;
 update private.r07_heads set revision=revision+1 where business_id=activation.business_id and goal_id=activation.goal_id;
 insert into private.r07_events(business_id,goal_id,plan_id,attempt_id,operation,payload)
 values(activation.business_id,activation.goal_id,activation.plan_id,attempt.id,'adaptive_diagnosed_failure',
  jsonb_build_object('failureHash',failure_hash,'defect',defect,'shouldDispatch',false));
 perform private.r12_adaptive_complete_action(p_scope,decision.content_hash,decision.ordinal);
 return jsonb_build_object('handled',true,'reason','diagnosed_failure_recorded',
  'failureHash',failure_hash,'defect',defect,'shouldDispatch',false);
end $$;

create function public.r12_adaptive_controller_server(p_business_id uuid,p_scope_id uuid,p_operation text,
 p_payload jsonb,p_server_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a private.r12_adaptive_activations;q private.r12_discovery_authorities;
 v_key_hash text;h private.r07_heads;begin
 if p_server_key is null or length(p_server_key) not between 32 and 200
 then raise exception 'r12_adaptive_controller_capability_required' using errcode='42501';end if;
 v_key_hash:=encode(extensions.digest(convert_to(p_server_key,'UTF8'),'sha256'),'hex');
 select * into a from private.r12_adaptive_activations where scope_id=p_scope_id and business_id=p_business_id;
 select * into q from private.r12_discovery_authorities where scope_id=p_scope_id and business_id=p_business_id;
 if a.scope_id is null or q.scope_id is null or q.controller_key_hash is distinct from v_key_hash
 or not exists(select 1 from private.r07_server_keys k where k.key_hash=v_key_hash and k.expires_at>clock_timestamp()
  and not exists(select 1 from private.r07_server_revocations r where r.key_hash=k.key_hash))
 then raise exception 'r12_adaptive_controller_capability_required' using errcode='42501';end if;
 select * into h from private.r07_heads where business_id=p_business_id and goal_id=a.goal_id;
 if h.plan_id is distinct from a.plan_id
 then raise exception 'r12_adaptive_current_head_required';end if;
 if p_operation='action_context' then
  if p_payload is distinct from '{}'::jsonb then raise exception 'r12_adaptive_action_context_payload_invalid';end if;
  return private.r12_adaptive_action_context(p_scope_id);
 elsif p_operation='admit_next' then
  if p_payload is distinct from '{}'::jsonb then raise exception 'r12_adaptive_admit_next_payload_invalid';end if;
  if h.reason='owner_stopped' or exists(select 1 from private.r05_revocations r where r.policy_id=a.policy_id)
  then return jsonb_build_object('admitted',false,'stopped',true,'reason','owner_stopped');end if;
  return private.r12_adaptive_admit_next(p_scope_id);
 elsif p_operation='complete_action' then
  perform private.r04_keys(p_payload,array['actionHash','actionOrdinal']);
  if p_payload->>'actionHash' !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_payload->'actionOrdinal')<>'number'
   or p_payload->>'actionOrdinal' !~ '^(0|[1-9]|10)$'
  then raise exception 'r12_adaptive_complete_action_payload_invalid';end if;
  return private.r12_adaptive_complete_action(p_scope_id,p_payload->>'actionHash',(p_payload->>'actionOrdinal')::integer);
 elsif p_operation='diagnosed_failure' then
  if p_payload is distinct from '{}'::jsonb then raise exception 'r12_adaptive_diagnosed_failure_payload_invalid';end if;
  return private.r12_adaptive_diagnosed_failure(p_scope_id);
 else raise exception 'r12_adaptive_controller_operation_unavailable';end if;
end $$;

-- The independent review and prior paid effects must be reconstructed by the
-- integrated resolver. This private RPC only inserts a decision after that
-- resolver succeeds under the same Business/root/head transaction locks.
create function private.r12_adaptive_admit_action(p_scope uuid,p_body jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a private.r12_adaptive_activations;rt private.r12_owner_grant_roots;
 binding private.r12_owner_funding_bindings;h private.r07_heads;prior private.r12_adaptive_actions;
 decision private.r12_adaptive_actions;state jsonb;stagnation jsonb;funding jsonb;quoted bigint;
 exposure bigint;unknown boolean;used integer;calls integer;reserved bigint;
 phase text;v_step_key text;pin private.r07_attempts;response private.r07_responses;begin
 select * into a from private.r12_adaptive_activations where scope_id=p_scope;
 if a.scope_id is null then raise exception 'r12_adaptive_activation_required';end if;
 perform 1 from public.businesses where id=a.business_id and owner_user_id=a.owner_id for update;
 if not found then raise exception 'r12_adaptive_owner_changed';end if;
 select * into rt from private.r12_owner_grant_roots where id=a.grant_root_id and business_id=a.business_id for update;
 select * into binding from private.r12_owner_funding_bindings where id=a.binding_id and business_id=a.business_id;
 if rt.id is null or binding.id is null then raise exception 'r12_adaptive_funding_root_required';end if;
 if binding.kind='legacy_research_root' then
  perform 1 from public.product_experiments where id=binding.authority_root_id and business_id=a.business_id for update;
  if not found then raise exception 'r12_adaptive_original_root_required';end if;
 end if;
 select * into h from private.r07_heads where business_id=a.business_id and goal_id=a.goal_id for update;
 select * into decision from private.r12_adaptive_actions where scope_id=p_scope and ordinal=(p_body->>'ordinal')::integer;
 if decision.scope_id is not null then
  if decision.content_hash is distinct from private.stage14_hash(p_body) or decision.content is distinct from p_body
  then raise exception 'r12_adaptive_action_idempotency_conflict';end if;
  return jsonb_build_object('version','r12.adaptive-action-admission.1','scopeId',p_scope,'ordinal',decision.ordinal,
   'actionHash',decision.content_hash,'maximumMicrousd',decision.maximum_microusd,'replayed',true,'shouldDispatch',false);
 end if;
 if h.goal_id is null or h.plan_id is distinct from a.plan_id or h.children_created>32 or h.dispatches>64
 or h.state in ('stopped','completed') or clock_timestamp()>=a.expires_at
 then raise exception 'r12_adaptive_head_unavailable';end if;
 perform private.r12_adaptive_activation_check(a);
 state:=private.r12_adaptive_scope_resolve(p_scope);
 if state->>'executionAuthorized' is distinct from 'true' or state->>'scopeHash' is distinct from a.scope_hash
 then raise exception 'r12_adaptive_current_scope_required';end if;
 quoted:=private.r12_adaptive_action_check(a,p_body);
 perform private.r12_adaptive_previous_review(a,p_body);
 stagnation:=private.r12_adaptive_stagnation_gate(p_scope,p_body);
 if stagnation->'allowed' is distinct from 'true'::jsonb
 then raise exception 'r12_adaptive_stagnation_denied: %',stagnation->>'reason';end if;
 select count(*) filter(where ordinal>0) into used from private.r12_adaptive_actions where scope_id=p_scope;
 select count(*) into calls from private.r12_adaptive_call_admissions where scope_id=p_scope;
 if used>=a.maximum_extra_actions and (p_body->>'ordinal')::integer>0
 or h.dispatches+jsonb_array_length(p_body->'phases')>64
 or calls+jsonb_array_length(p_body->'phases')>a.maximum_paid_calls
 then raise exception 'r12_adaptive_lifetime_bound';end if;
 if (select count(*) from private.r07_children where plan_id=a.plan_id)<>5
 or h.children_created<(a.predecessor_closure->>'baseChildren')::integer+5
 then raise exception 'r12_adaptive_five_children_required';end if;
 select coalesce(sum(e.held),0),coalesce(bool_or(e.unknown),false) into exposure,unknown
 from private.r05_exposure(a.business_id)e where e.policy_id=a.policy_id;
 if unknown or exists(select 1 from private.r05_exposure(a.business_id)e where e.unknown)
 or exposure+private.r12_adaptive_outstanding_hold(a.business_id,a.policy_id)+quoted>a.maximum_run_microusd
 then raise exception 'r12_adaptive_run_budget_unavailable';end if;
 funding:=private.r12_owner_funding(binding);
 if funding->'hasUnknown' is distinct from 'false'::jsonb
 or (funding->>'pendingMicrounits')::bigint<>0
 or (funding->>'committedMicrounits')::bigint+private.r12_adaptive_outstanding_root_hold(binding.id)+quoted
  >(funding->>'maximumMicrounits')::bigint
 then raise exception 'r12_adaptive_root_budget_unavailable';end if;
 select coalesce(sum(e.held),0) into reserved from private.r05_exposure(a.business_id)e where e.currency='USD';
 if reserved+private.r12_adaptive_outstanding_hold(a.business_id)+quoted>(select maximum_microunits from private.r05_cap_versions
   where business_id=a.business_id and currency='USD' order by revision desc limit 1)
 then raise exception 'r12_adaptive_business_budget_unavailable';end if;
 insert into private.r12_adaptive_actions(scope_id,ordinal,kind,content,content_hash,previous_action_hash,previous_review_hash,maximum_microusd)
 values(p_scope,(p_body->>'ordinal')::integer,p_body->>'kind',p_body,private.stage14_hash(p_body),p_body->>'previousActionHash',p_body->>'previousReviewHash',quoted)
 returning * into decision;
 foreach phase in array array['plan','search','select','strategy','review'] loop
  if p_body->'phases' ? phase then continue;end if;
  v_step_key:=private.r12_adaptive_step_key(phase);
  select * into pin from private.r07_attempts t where t.plan_id=a.plan_id and t.step_key=v_step_key
   and t.adaptive_action_ordinal<decision.ordinal and t.status='completed'
   order by t.adaptive_action_ordinal desc,t.attempt desc limit 1;
  select * into response from private.r07_responses where attempt_id=pin.id;
  if pin.id is null or response.attempt_id is null then raise exception 'r12_adaptive_omitted_phase_unverified';end if;
  insert into private.r12_adaptive_action_dependencies(scope_id,action_ordinal,step_key,source_attempt_id,response_hash)
  values(p_scope,decision.ordinal,v_step_key,pin.id,response.content_hash);
 end loop;
 return jsonb_build_object('version','r12.adaptive-action-admission.1','scopeId',p_scope,'ordinal',decision.ordinal,
  'actionHash',decision.content_hash,'maximumMicrousd',quoted,'shouldDispatch',false);
end $$;

-- A browser cannot nominate a new paid question. The next action is rebuilt
-- from the exact persisted independent review or classified failure.
create function private.r12_adaptive_admit_next(p_scope uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare a private.r12_adaptive_activations;s private.r12_discovery_scopes;
 binding private.r12_owner_funding_bindings;h private.r07_heads;
 prior private.r12_adaptive_actions;closure private.r12_adaptive_action_closures;
 review private.r07_responses;failed private.r07_attempts;saved_failure private.r12_adaptive_failed_calls;
 recommendation jsonb;body jsonb;stagnation jsonb;repair jsonb:='null'::jsonb;kind text;
 ordinal integer;question text;hypothesis text;gain text;counter text;
 previous_review text;phases jsonb;defect text;gap jsonb;fallback boolean:=false;begin
 select * into a from private.r12_adaptive_activations where scope_id=p_scope;
 select * into s from private.r12_discovery_scopes where id=p_scope;
 if a.scope_id is null or s.id is null then raise exception 'r12_adaptive_activation_required';end if;
 perform 1 from public.businesses where id=a.business_id and owner_user_id=a.owner_id for update;
 if not found then raise exception 'r12_adaptive_owner_changed';end if;
 perform 1 from private.r12_owner_grant_roots where id=a.grant_root_id and business_id=a.business_id for update;
 if not found then raise exception 'r12_adaptive_grant_root_changed';end if;
 select * into binding from private.r12_owner_funding_bindings where id=a.binding_id and business_id=a.business_id;
 if binding.id is null then raise exception 'r12_adaptive_funding_changed';end if;
 if binding.kind='legacy_research_root' then
  perform 1 from public.product_experiments where id=binding.authority_root_id and business_id=a.business_id for update;
  if not found then raise exception 'r12_adaptive_original_root_changed';end if;
 end if;
 select * into h from private.r07_heads where business_id=a.business_id and goal_id=a.goal_id for update;
 if h.plan_id is distinct from a.plan_id or h.reason='owner_stopped'
 or exists(select 1 from private.r05_revocations where policy_id=a.policy_id)
 then return jsonb_build_object('admitted',false,'stopped',true,'reason','owner_stopped');end if;
 select * into prior from private.r12_adaptive_actions where scope_id=p_scope order by ordinal desc limit 1;
 if prior.scope_id is null then
  ordinal:=0;kind:='initial';question:=s.amendment->>'approvedQuery';
  hypothesis:=left(s.amendment->'intent'->>'objective',500);
  gain:='Identify dated public evidence and the main uncertainty in this original POD research question.';
  counter:='What reliable public evidence would contradict the proposed opportunity and require a narrower conclusion?';
  previous_review:=s.amendment->'imports'->4->>'responseHash';
  phases:=private.r12_adaptive_action_phases(kind);
 else
  select * into closure from private.r12_adaptive_action_closures
   where scope_id=p_scope and action_ordinal=prior.ordinal and action_hash=prior.content_hash;
  if closure.scope_id is null then return jsonb_build_object('admitted',false,'reason','current_action_open');end if;
  if prior.ordinal>=a.maximum_extra_actions then return jsonb_build_object('admitted',false,'reason','action_limit');end if;
  ordinal:=prior.ordinal+1;
  if closure.state='completed' then
   select r.* into review from private.r07_attempts t join private.r07_responses r on r.attempt_id=t.id
   where t.plan_id=a.plan_id and t.adaptive_action_ordinal=prior.ordinal and t.step_key='review' and t.status='completed';
   if review.attempt_id is null or review.content_hash is distinct from closure.review_hash
   then raise exception 'r12_adaptive_closed_review_changed';end if;
   recommendation:=review.content->'result'->'review'->'recommendedNextAction';
   if recommendation is null or recommendation='null'::jsonb then
    gap:=private.r12_adaptive_missing_gap(p_scope,review.content->'result'->'review');
    if gap is null then return jsonb_build_object('admitted',false,'reason','no_reviewed_next_action');end if;
    if exists(select 1 from private.r12_adaptive_missing_recommendations used
      where used.scope_id=p_scope and used.gap_hash=gap->>'gapHash')
    then return jsonb_build_object('admitted',false,'reason','missing_recommendation_gap_already_used');end if;
    fallback:=true;kind:='reasoning_review';question:=gap->'questions'->>0;
    hypothesis:='The saved evidence leaves this specific public research question unresolved.';
    gain:='Determine a feasible next investigation for the named gap using the saved evidence and contrary facts.';
    counter:='Which reliable contrary facts would change the assessment of the named unresolved gap?';
    previous_review:=closure.review_hash;phases:=private.r12_adaptive_action_phases(kind);
   else
    if recommendation->>'kind'='close' then return jsonb_build_object('admitted',false,'reason','no_reviewed_next_action');end if;
    kind:=recommendation->>'kind';question:=recommendation->>'publicQuestion';
    hypothesis:=recommendation->>'hypothesis';gain:=recommendation->>'expectedInformationGain';
    counter:=recommendation->>'counterevidenceQuestion';previous_review:=closure.review_hash;
    phases:=private.r12_adaptive_action_phases(kind);
   end if;
  else
   select t.* into failed from private.r07_attempts t where t.plan_id=a.plan_id
    and t.adaptive_action_ordinal=prior.ordinal and t.status='failed'
    order by array_position(array['plan','search1','select1','strategy','review'],t.step_key),t.attempt limit 1;
   select * into saved_failure from private.r12_adaptive_failed_calls where attempt_id=failed.id;
   defect:=saved_failure.defect;
   if failed.id is null or saved_failure.attempt_id is null or defect not in ('schema','format','identified_reasoning')
   then return jsonb_build_object('admitted',false,'reason','unclassified_failure');end if;
   kind:='repair';question:=prior.content->>'question';hypothesis:=prior.content->>'hypothesis';
   gain:=prior.content->>'expectedInformationGain';counter:=prior.content->>'counterevidenceQuestion';
   repair:=jsonb_build_object('failedAttemptId',failed.id,
    'failureHash',saved_failure.failure_hash,'defect',defect);
   select cl.review_hash into previous_review from private.r12_adaptive_action_closures cl
    where cl.scope_id=p_scope and cl.action_ordinal<prior.ordinal and cl.review_hash is not null
    order by cl.action_ordinal desc limit 1;
   previous_review:=coalesce(previous_review,s.amendment->'imports'->4->>'responseHash');
   phases:=private.r12_adaptive_action_phases(kind,case failed.step_key
     when 'search1' then 'search' when 'select1' then 'select' else failed.step_key end);
  end if;
 end if;
 body:=jsonb_build_object('version','r12.adaptive-action.1','scopeId',p_scope,'scopeHash',a.scope_hash,
  'ordinal',ordinal,'kind',kind,'previousActionHash',prior.content_hash,'previousReviewHash',previous_review,
  'question',question,'hypothesis',hypothesis,'expectedInformationGain',gain,
  'counterevidenceQuestion',counter,'phases',phases,'repair',repair);
 stagnation:=private.r12_adaptive_stagnation_gate(p_scope,body);
 if stagnation->'allowed' is distinct from 'true'::jsonb
 then return jsonb_build_object('admitted',false,'reason',stagnation->>'reason',
  'stagnation',stagnation->'stagnation');end if;
 if fallback then
  insert into private.r12_adaptive_missing_recommendations(scope_id,gap_hash,action_ordinal,
   action_hash,origin_review_hash,canonical_questions)
  values(p_scope,gap->>'gapHash',ordinal,private.stage14_hash(body),closure.review_hash,gap->'questions');
 end if;
 return private.r12_adaptive_admit_action(p_scope,body)||jsonb_build_object('admitted',true);
end $$;

-- Preparation saves the exact owner-reviewed packet and a proposed R05 policy.
-- It creates neither an R07 plan nor a provider request. All scope and root
-- arithmetic is repeated at confirmation under the same lock order.
create function private.r12_owner_adaptive_prepare(p_business_id uuid,p_payload jsonb,p_server_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare input jsonb:=p_payload->'input';q jsonb:=p_payload->'quote';
 g private.r12_owner_bootstrap_grants;rt private.r12_owner_grant_roots;
 profile private.r12_owner_profiles;binding private.r12_owner_funding_bindings;
 goal private.r04_goal_versions;br private.r04_business_versions;cap private.r05_cap_versions;
 setup private.r12_adaptive_setups;installed public.installed_packs;
 funding jsonb;selected jsonb;closure jsonb;imports jsonb;preview jsonb;
 policy_body jsonb;proposed jsonb;ops jsonb:='[]'::jsonb;classes jsonb;
 phase text;step_key text;operation_key text;adapter_key text;purpose text;model text;
 submission uuid;scope_id uuid;setup_id uuid;installation_id uuid;
 stamp timestamptz:=date_trunc('milliseconds',clock_timestamp());cutoff timestamptz;
 committed bigint;unknown boolean;amount bigint;business_limit bigint;research_limit bigint;
 used_scopes bigint;used_allocation bigint;revision jsonb;begin
 perform private.r05_owner(p_business_id);
 perform private.r04_safe(p_payload);perform private.r04_keys(p_payload,array['input','quote']);
 perform private.r04_keys(input,array['businessId','goalId','goalRevision','profileId','profileHash','grantId',
  'marketSetKey','topicKey','businessLifetimeLimitMicrounits','researchLifetimeLimitMicrounits',
 'submissionId','predecessorPlanId','predecessorPlanHash','predecessorScopeId','predecessorScopeHash',
  'maximumActions','maximumRunMicrounits','ownerObservationRef']);
 if input->>'businessId' is distinct from p_business_id::text
 or input->>'goalRevision' !~ '^[1-9][0-9]{0,8}$'
 or input->>'maximumActions' !~ '^([1-9]|10)$'
 or input->>'maximumRunMicrounits' !~ '^[1-9][0-9]{0,7}$'
 or input->>'profileHash' !~ '^[a-f0-9]{64}$'
 or input->>'predecessorPlanHash' !~ '^[a-f0-9]{64}$'
 or input->>'predecessorScopeHash' !~ '^[a-f0-9]{64}$'
 then raise exception 'r12_adaptive_preparation_input_invalid';end if;
 if input->'ownerObservationRef' is null then raise exception 'r12_owner_observation_ref_required';end if;
 submission:=(input->>'submissionId')::uuid;
 select * into setup from private.r12_adaptive_setups where business_id=p_business_id and submission_id=submission;
 if setup.id is not null then
  if setup.input is distinct from input or setup.quote is distinct from q or setup.owner_id is distinct from auth.uid()
  then raise exception 'r12_adaptive_prepare_idempotency_conflict';end if;
  return private.r12_adaptive_setup_receipt(setup);
 end if;
 select * into g from private.r12_owner_bootstrap_grants where id=(input->>'grantId')::uuid and business_id=p_business_id;
 if g.id is null or g.owner_id is distinct from auth.uid() or length(coalesce(p_server_key,''))<32
 or g.server_key_hash is distinct from encode(extensions.digest(convert_to(p_server_key,'UTF8'),'sha256'),'hex')
 then raise exception 'r12_adaptive_bootstrap_capability_required' using errcode='42501';end if;
 select * into rt from private.r12_owner_grant_roots where id=g.root_id and business_id=p_business_id for update;
 select * into binding from private.r12_owner_funding_bindings where id=rt.binding_id and business_id=p_business_id;
 if rt.id is null or binding.id is null then raise exception 'r12_adaptive_funding_root_required';end if;
 if binding.kind='legacy_research_root' then
  perform 1 from public.product_experiments where id=binding.authority_root_id and business_id=p_business_id for update;
  if not found then raise exception 'r12_adaptive_original_root_required';end if;
 end if;
 select * into profile from private.r12_owner_profiles where id=g.profile_id;
 perform private.r12_adaptive_profile_check(profile,stamp);perform private.r12_owner_pins_check(profile);
 if input->>'profileId' is distinct from profile.id::text or input->>'profileHash' is distinct from profile.profile_hash
 then raise exception 'r12_adaptive_profile_changed';end if;
 select v.* into goal from private.r04_goal_versions v join private.r04_goal_state s using(business_id,goal_id,revision)
  where v.business_id=p_business_id and v.goal_id=(input->>'goalId')::uuid;
 select v.* into br from private.r04_business_versions v join private.r04_business_state s using(business_id,revision)
  where v.business_id=p_business_id;
 if goal.goal_id is null or br.business_id is null or goal.revision<>(input->>'goalRevision')::integer
 or goal.preference<>'ready' or br.preference<>'setup' or goal.content->'ambiguities' is distinct from '[]'::jsonb
 or g.business_revision is distinct from br.revision or g.business_hash is distinct from br.content_hash
 then raise exception 'r12_adaptive_goal_or_business_changed';end if;
 revision:=private.r12_adaptive_grant_check(g,profile,goal,rt,stamp);
 if private.r05_paused(p_business_id,'business',p_business_id) or private.r05_paused(p_business_id,'quest',goal.goal_id)
 then raise exception 'r12_adaptive_scope_paused';end if;
 select * into cap from private.r05_cap_versions where business_id=p_business_id and currency='USD' order by revision desc limit 1;
 select coalesce(sum(e.held),0),coalesce(bool_or(e.unknown),false) into committed,unknown
  from private.r05_exposure(p_business_id)e where e.currency='USD';
 funding:=private.r12_owner_funding(binding);
 if unknown or funding->'hasUnknown' is distinct from 'false'::jsonb
 or (funding->>'pendingMicrounits')::bigint<>0 then raise exception 'r12_adaptive_liability_unknown';end if;
 closure:=private.r12_owner_episode_predecessor(p_business_id,goal.goal_id);
 if input->>'predecessorPlanId' is distinct from closure->>'predecessorPlanId'
 or input->>'predecessorPlanHash' is distinct from closure->>'predecessorPlanHash'
 or input->>'predecessorScopeId' is distinct from closure->>'predecessorScopeId'
 or input->>'predecessorScopeHash' is distinct from closure->>'predecessorScopeHash'
 then raise exception 'r12_adaptive_exact_predecessor_required';end if;
 imports:=private.r12_adaptive_imports((closure->>'predecessorPlanId')::uuid,true);
 perform private.r12_owner_observation_context(input->'ownerObservationRef',p_business_id,auth.uid(),
  gen_random_uuid(),gen_random_uuid(),null,g.approval_hash);
 amount:=private.r05_money(input->'maximumRunMicrounits');
 if amount>10000000 or amount>(profile.profile->>'maximumRunMicrousd')::bigint
 or amount>(g.adaptive_bounds->>'maximumRunMicrounits')::bigint
 or (input->>'maximumActions')::integer>(g.adaptive_bounds->>'maximumActions')::integer
 or (closure->>'baseChildren')::integer+5>32 or (closure->>'baseDispatches')::integer+5>64
 then raise exception 'r12_adaptive_envelope_exceeded';end if;
 business_limit:=private.r05_money(input->'businessLifetimeLimitMicrounits');
 research_limit:=private.r05_money(input->'researchLifetimeLimitMicrounits');
 if business_limit<>greatest(coalesce(cap.maximum_microunits,0),committed+amount)
 or research_limit<>greatest((funding->>'maximumMicrounits')::bigint,(funding->>'committedMicrounits')::bigint+amount)
 or (binding.kind='r05_business' and research_limit<>business_limit)
 then raise exception 'r12_adaptive_exact_finance_required';end if;
 select (select count(*) from private.r12_owner_activations where grant_root_id=rt.id)
  +(select count(*) from private.r12_owner_episode_activations where grant_root_id=rt.id)
  +(select count(*) from private.r12_adaptive_activations where grant_root_id=rt.id),
  (select coalesce(sum(allocation_microunits),0) from private.r12_owner_activations where grant_root_id=rt.id)
  +(select coalesce(sum(allocation_microunits),0) from private.r12_owner_episode_activations where grant_root_id=rt.id)
  +(select coalesce(sum(maximum_run_microusd),0) from private.r12_adaptive_activations where grant_root_id=rt.id)
 into used_scopes,used_allocation;
 if used_scopes>=least((revision->>'maximumScopes')::integer,coalesce(g.maximum_scopes,rt.maximum_scopes))
 or used_allocation+amount>least((revision->>'maximumAllocationMicrounits')::bigint,coalesce(g.maximum_allocation_microunits,rt.maximum_allocation_microunits))
 then raise exception 'r12_adaptive_root_exhausted';end if;
 perform private.r12_adaptive_quote_check(q);
 selected:=private.r12_owner_selection(profile.profile,input->>'marketSetKey',input->>'topicKey');
 selected:=selected||jsonb_build_object('marketSetKey',input->>'marketSetKey','topicKey',input->>'topicKey');
 if length(selected->>'approvedQuery')>500 then raise exception 'r12_adaptive_initial_action_question_bound';end if;
 cutoff:=least((g.adaptive_bounds->>'expiresAt')::timestamptz,(profile.profile->>'validUntil')::timestamptz,
  ((goal.content->'parsed'->'deadline'->>'date')||' '||coalesce(goal.content->'parsed'->'deadline'->>'time','23:59:59'))::timestamp
   at time zone (goal.content->'parsed'->'deadline'->>'timezone'));
 if cutoff<=stamp or (profile.pins->>'knowledgeValidUntil')::timestamptz<cutoff
 then raise exception 'r12_adaptive_window_insufficient';end if;
 scope_id:=gen_random_uuid();setup_id:=gen_random_uuid();
 select * into installed from public.installed_packs where business_id=p_business_id and root_pack_id=(profile.pins->>'packId')::uuid;
 if installed.id is not null then
  if installed.status<>'active' or installed.snapshot is distinct from profile.pins->'snapshot'
  then raise exception 'r12_adaptive_installation_changed';end if;
  installation_id:=installed.id;
 else
  installation_id:=gen_random_uuid();
  insert into public.installed_packs(id,business_id,root_pack_id,root_pack_key,status,snapshot)
   values(installation_id,p_business_id,(profile.pins->>'packId')::uuid,'workflow.product-discovery-v2','active',profile.pins->'snapshot');
 end if;
 foreach phase in array array['plan','search','select','strategy','review'] loop
  step_key:=private.r12_adaptive_step_key(phase);
  operation_key:='research.r12.'||scope_id::text||'.'||step_key;
  adapter_key:='r12.discovery.'||scope_id::text||'.'||step_key;
  purpose:='Reviewed original POD research: '||step_key;
  classes:=case when phase='search' then '["generic_public_query","public_evidence"]'::jsonb
   else '["business_context","public_evidence"]'::jsonb end;
  model:=case when phase='review' then 'anthropic/claude-haiku-4.5' else 'openai/gpt-5.6-luna' end;
  insert into private.r05_operations(operation_key,pack_id,workflow_definition_id,provider,provider_model_id,purpose,
   currency,category,maximum_request_bytes,maximum_output_tokens,liability_microunits,source_domains,data_classes,
   qualification_hash,eligibility_hash,quote_hash,valid_from,valid_until)
  values(operation_key,(profile.pins->>'packId')::uuid,(profile.pins->>'workflowDefinitionId')::uuid,'openrouter',model,
   purpose,'USD','model',(q->'requestBytes'->>phase)::integer,(q->'outputTokens'->>phase)::integer,
   (q->'ceilings'->>phase)::bigint,selected->'allowedDomains',classes,
   profile.pins->>'executionReviewHash',profile.pins->>'eligibilityReviewHash',q->>'quoteHash',stamp,cutoff);
  insert into private.r07_adapters(adapter_key,qualification_hash,workflow_definition_id,worker_definition_id,
   workflow_hash,worker_hash,operation_key,role,purpose,artifact_type,mode,valid_from,valid_until,knowledge_valid_until)
  values(adapter_key,profile.pins->>'executionReviewHash',(profile.pins->>'workflowDefinitionId')::uuid,
   (profile.pins->'workers'->step_key->>'id')::uuid,profile.pins->>'workflowHash',
   profile.pins->'workers'->step_key->>'hash',operation_key,step_key,purpose,'r12.discovery.'||step_key,
   'qualification',stamp,cutoff,(profile.pins->>'knowledgeValidUntil')::timestamptz);
  ops:=ops||jsonb_build_array(jsonb_build_object('operationKey',operation_key,'installationId',installation_id,
   'workflowDefinitionId',profile.pins->>'workflowDefinitionId','purpose',purpose,'provider','openrouter',
   'category','model','accountId',null,'accountRevision',null,'sourceDomains',selected->'allowedDomains',
   'dataClasses',classes,'maximumPerOperationMicrounits',q->'ceilings'->>phase));
 end loop;
 select jsonb_agg(v order by v->>'operationKey') into ops from jsonb_array_elements(ops)v;
 policy_body:=jsonb_build_object('version','r05.1','goalId',goal.goal_id,'goalRevision',goal.revision,
  'businessRevision',br.revision,'currency','USD','businessLifetimeLimitMicrounits',business_limit::text,
  'policyLimitMicrounits',amount::text,'categoryLimits',jsonb_build_array(jsonb_build_object('category','model',
  'microunits',amount::text)),'expectedCapRevision',coalesce(cap.revision,0),
  'expectedExposureMicrounits',committed::text,'startsAt',stamp,'expiresAt',cutoff,
  'maximumDispatches',64-(closure->>'baseDispatches')::integer,'minimumIntervalSeconds',0,
  'stopOnTarget',false,'operations',ops,'financialMode','bounded_model_cost_only');
 proposed:=public.r05_policy_owner(p_business_id,'propose',policy_body,gen_random_uuid());
 preview:=jsonb_build_object('version','r12.adaptive-research-preview.1','businessId',p_business_id,
  'goalId',goal.goal_id,'predecessor',closure,'predecessorHash',private.stage14_hash(closure),
  'imports',imports,'profileId',profile.id,'profileHash',profile.profile_hash,'quoteHash',q->>'quoteHash',
  'ownerObservationRef',input->'ownerObservationRef',
  'expiresAt',to_char(cutoff at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'maximumActions',(input->>'maximumActions')::integer,'maximumPaidCalls',64-(closure->>'baseDispatches')::integer,
  'maximumNewChildren',5,'maximumRunMicrounits',amount::text,
  'funding',jsonb_build_object('authorityRootId',binding.authority_root_id,'bindingHash',funding->>'hash',
   'revision',(funding->>'revision')::integer,'committedMicrounits',funding->>'committedMicrounits',
   'pendingMicrounits',funding->>'pendingMicrounits','currentLimitMicrounits',funding->>'maximumMicrounits',
   'proposedLimitMicrounits',research_limit::text,'hasUnknown',false),
  'business',jsonb_build_object('capRevision',coalesce(cap.revision,0),'committedMicrounits',committed::text,
   'currentLimitMicrounits',coalesce(cap.maximum_microunits,0)::text,'proposedLimitMicrounits',business_limit::text,
   'hasUnknown',false),'authorityCreated',false);
 insert into private.r12_adaptive_setups(id,business_id,goal_id,owner_id,scope_id,profile_id,grant_id,
  binding_id,installation_id,policy_id,policy_hash,input,selection,quote,preview,owner_observation_ref,approval_hash,
  submission_id,setup_hash,cutoff)
 values(setup_id,p_business_id,goal.goal_id,auth.uid(),scope_id,profile.id,g.id,binding.id,installation_id,
  (proposed->>'id')::uuid,proposed->>'hash',input,selected,q,preview,input->'ownerObservationRef',g.approval_hash,submission,
  private.stage14_hash(private.r12_adaptive_setup_packet(selected,g.id,g.approval_hash,q,preview,submission,input->'ownerObservationRef')),cutoff)
 returning * into setup;
 return private.r12_adaptive_setup_receipt(setup);
end $$;

create function private.r12_adaptive_scope_insert_check(s private.r12_discovery_scopes)
returns void language plpgsql set search_path='' as $$
declare setup private.r12_adaptive_setups;profile private.r12_owner_profiles;
 binding private.r12_owner_funding_bindings;funding jsonb;a jsonb:=s.amendment;begin
 select * into setup from private.r12_adaptive_setups where id=s.adaptive_setup_id;
 select * into profile from private.r12_owner_profiles where id=setup.profile_id;
 select * into binding from private.r12_owner_funding_bindings where id=setup.binding_id;
 if setup.id is null or profile.id is null or binding.id is null
 or s.id is distinct from setup.scope_id or s.business_id is distinct from setup.business_id
 or s.goal_id is distinct from setup.goal_id or s.origin<>'owner_adaptive'
 or s.amendment_hash is distinct from private.stage14_hash(a)
 then raise exception 'r12_adaptive_scope_setup_required';end if;
 perform private.r04_safe(a);
 perform private.r04_keys(a,array['version','id','businessId','goalId','goalRevision','goalHash',
  'businessRevision','businessHash','setupId','setupHash','profile','profileHash','selection',
  'funding','fundingApproval','intent','allowedDomains','excludedDomains','approvedQuery',
  'approvalHash','independentReviewHash','predecessorClosure','predecessorClosureHash',
  'imports','quoteHash','maximumActions','maximumPaidCalls','maximumRunMicrounits','createdAt','expiresAt',
  'ownerObservationRef']);
 funding:=private.r12_owner_funding(binding);
 if a->>'version' is distinct from 'r12.discovery-owner-adaptive.1'
 or a->>'id' is distinct from s.id::text or a->>'businessId' is distinct from s.business_id::text
 or a->>'goalId' is distinct from s.goal_id::text or a->>'setupId' is distinct from setup.id::text
 or a->>'setupHash' is distinct from setup.setup_hash
 or a->'profile' is distinct from profile.profile or a->>'profileHash' is distinct from profile.profile_hash
 or a->'selection' is distinct from jsonb_build_object('marketSetKey',setup.selection->>'marketSetKey',
  'topicKey',setup.selection->>'topicKey')
 or a->'funding' is distinct from funding->'binding'
 or a->'fundingApproval' is distinct from jsonb_build_object('revision',(funding->>'revision')::integer,
  'hash',funding->>'hash','maximumMicrounits',funding->>'maximumMicrounits')
 or a->'allowedDomains' is distinct from setup.selection->'allowedDomains'
 or a->'excludedDomains' is distinct from setup.selection->'excludedDomains'
 or a->>'approvedQuery' is distinct from setup.selection->>'approvedQuery'
 or a->>'approvalHash' is distinct from setup.approval_hash
 or a->>'independentReviewHash' is distinct from profile.profile->>'independentReviewHash'
 or a->'predecessorClosure' is distinct from setup.preview->'predecessor'
 or a->>'predecessorClosureHash' is distinct from setup.preview->>'predecessorHash'
 or a->'imports' is distinct from setup.preview->'imports'
 or a->'ownerObservationRef' is distinct from setup.owner_observation_ref
 or a->>'quoteHash' is distinct from setup.quote->>'quoteHash'
 or a->'maximumActions' is distinct from setup.preview->'maximumActions'
 or a->'maximumPaidCalls' is distinct from setup.preview->'maximumPaidCalls'
 or a->>'maximumRunMicrounits' is distinct from setup.preview->>'maximumRunMicrounits'
 or a->>'expiresAt' is distinct from setup.preview->>'expiresAt'
 or a->'intent'->>'id' is distinct from s.id::text
 or a->'intent'->'comparisonUniverse'->>'selectionQuestion' is distinct from setup.selection->>'approvedQuery'
 or (a->'intent'->'limits'->>'maximumMicrousd')::bigint is distinct from (setup.preview->>'maximumRunMicrounits')::bigint
 then raise exception 'r12_adaptive_scope_packet_invalid';end if;
end $$;

do $adaptive_scope_patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_discovery_scope_validate()'::regprocedure);
 if position($old$ if a->>'version'='r12.discovery-owner-episode.1' then$old$ in d)=0
 then raise exception 'r12_adaptive_scope_validator_changed';end if;
 d:=replace(d,$old$ if a->>'version'='r12.discovery-owner-episode.1' then$old$,
  $new$ if a->>'version'='r12.discovery-owner-adaptive.1' then
   perform private.r12_adaptive_scope_insert_check(new);return new;end if;
 if a->>'version'='r12.discovery-owner-episode.1' then$new$);
 execute d;
end $adaptive_scope_patch$;

create function private.r12_adaptive_plan_check(b uuid,g uuid,p jsonb)
returns void language plpgsql set search_path='' as $$
declare scope private.r12_discovery_scopes;setup private.r12_adaptive_setups;
 profile private.r12_owner_profiles;policy private.r05_policies;
 closure jsonb;phase text;step jsonb;ord integer:=0;expected_dep jsonb;run_max bigint;begin
 perform private.r07_safe(p);
 perform private.r04_keys(p,array['format','businessId','goalId','goalRevision','goalHash',
  'businessRevision','businessHash','policyId','policyHash','authorityRootId',
  'plannerWorkerDefinitionId','currency','maximumMicrounits','deadline','expiresAt',
  'maximumRepairs','maximumPivots','maximumChildren','maximumDispatches',
  'requiredChecks','finishCondition','stopConditions','steps','discoveryScopeId','discoveryScopeHash']);
 select * into scope from private.r12_discovery_scopes where id=(p->>'discoveryScopeId')::uuid
  and business_id=b and goal_id=g and origin='owner_adaptive' and amendment_hash=p->>'discoveryScopeHash';
 select * into setup from private.r12_adaptive_setups where id=scope.adaptive_setup_id;
 select * into profile from private.r12_owner_profiles where id=setup.profile_id;
 select * into policy from private.r05_policies where id=setup.policy_id;
 if scope.id is null or setup.id is null or profile.id is null or policy.id is null
 then raise exception 'r12_adaptive_plan_authority_required';end if;
 perform private.r12_adaptive_scope_insert_check(scope);
 closure:=scope.amendment->'predecessorClosure';
 run_max:=(setup.preview->>'maximumRunMicrounits')::bigint;
 if p->>'format' is distinct from 'r12.discovery-adaptive.1'
 or p->>'businessId' is distinct from b::text or p->>'goalId' is distinct from g::text
 or p->>'authorityRootId' is distinct from b::text or p->>'currency' is distinct from 'USD'
 or p->>'policyId' is distinct from policy.id::text or p->>'policyHash' is distinct from policy.content_hash
 or p->>'goalRevision' is distinct from scope.amendment->>'goalRevision'
 or p->>'goalHash' is distinct from scope.amendment->>'goalHash'
 or p->>'businessRevision' is distinct from scope.amendment->>'businessRevision'
 or p->>'businessHash' is distinct from scope.amendment->>'businessHash'
 or p->>'plannerWorkerDefinitionId' is distinct from profile.pins->>'plannerWorkerDefinitionId'
 or p->>'deadline' is distinct from setup.preview->>'expiresAt'
 or p->>'expiresAt' is distinct from setup.preview->>'expiresAt'
 or (p->>'maximumMicrounits')::bigint is distinct from (closure->>'baseKnownMicrounits')::bigint+run_max
 or p->'maximumRepairs' is distinct from to_jsonb((closure->>'baseRepairs')::integer+(setup.preview->>'maximumActions')::integer)
 or p->'maximumPivots' is distinct from to_jsonb((closure->>'basePivots')::integer+(setup.preview->>'maximumActions')::integer)
 or p->'maximumChildren' is distinct from to_jsonb((closure->>'baseChildren')::integer+5)
 or p->'maximumDispatches' is distinct from to_jsonb((closure->>'baseDispatches')::integer+(setup.preview->>'maximumPaidCalls')::integer)
 or p->'requiredChecks' is distinct from '["review"]'::jsonb
 or p->>'finishCondition' is distinct from 'all_required_outputs_verified'
 or p->'stopConditions' is distinct from '["no_permitted_work","deadline","repair_exhausted","owner_stopped"]'::jsonb
 or jsonb_array_length(p->'steps')<>5 or jsonb_array_length(policy.payload->'operations')<>5
 or (policy.payload->>'maximumDispatches')::integer<>(setup.preview->>'maximumPaidCalls')::integer
 or private.r05_money(policy.payload->'policyLimitMicrounits')<>run_max
 then raise exception 'r12_adaptive_plan_envelope_invalid';end if;
 foreach phase in array array['plan','search1','select1','strategy','review'] loop
  step:=p->'steps'->ord;
  perform private.r04_keys(step,array['key','kind','objective','reason','adapter','qualificationHash',
   'installationId','packSnapshotHash','workflowDefinitionId','workerDefinitionId','role',
   'operationKey','purpose','dependsOn','expectedArtifactType','maximumMicrounits',
   'expiresAt','notBefore','measurement','maximumRepairs']);
  expected_dep:=to_jsonb((array['plan','search1','select1','strategy','review'])[1:ord]);
  if step->>'key' is distinct from phase
  or step->>'kind' is distinct from (case when phase='search1' then 'research' when phase='review' then 'review' else 'work' end)
  or step->>'adapter' is distinct from 'r12.discovery.'||scope.id::text||'.'||phase
  or step->>'operationKey' is distinct from 'research.r12.'||scope.id::text||'.'||phase
  or step->>'role' is distinct from phase
  or step->>'expectedArtifactType' is distinct from 'r12.discovery.'||phase
  or step->>'qualificationHash' is distinct from profile.pins->>'executionReviewHash'
  or step->>'installationId' is distinct from setup.installation_id::text
  or step->>'packSnapshotHash' is distinct from profile.pins->>'snapshotHash'
  or step->>'workflowDefinitionId' is distinct from profile.pins->>'workflowDefinitionId'
  or step->>'workerDefinitionId' is distinct from profile.pins->'workers'->phase->>'id'
  or step->'dependsOn' is distinct from expected_dep
  or step->>'maximumMicrounits' is distinct from run_max::text
  or step->>'expiresAt' is distinct from setup.preview->>'expiresAt'
  or step->'maximumRepairs' is distinct from '0'::jsonb or step->'measurement' is distinct from 'null'::jsonb
  then raise exception 'r12_adaptive_plan_step_invalid';end if;
  ord:=ord+1;
 end loop;
end $$;

do $adaptive_plan_patch$ declare d text;begin
 d:=pg_get_functiondef('private.r07_validate_plan(uuid,uuid,jsonb)'::regprocedure);
 if position(' perform private.r07_safe(p);' in d)=0 then raise exception 'r12_adaptive_r07_validator_changed';end if;
 d:=replace(d,' perform private.r07_safe(p);',
  $new$ if p->>'format'='r12.discovery-adaptive.1' then
   perform private.r12_adaptive_plan_check(b,g,p);return;end if;
 perform private.r07_safe(p);$new$);
 execute d;
end $adaptive_plan_patch$;

do $adaptive_authority_patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_plan_qualification(uuid,uuid,jsonb)'::regprocedure);
 if position($old$(v->>'format'='r12.discovery-episode.1'$old$ in d)=0
 then raise exception 'r12_adaptive_plan_qualification_changed';end if;
 d:=replace(d,$old$(v->>'format'='r12.discovery-episode.1'$old$,
  $new$(v->>'format'='r12.discovery-adaptive.1' and s.origin='owner_adaptive' and
   s.amendment->>'version'='r12.discovery-owner-adaptive.1' and
   exists(select 1 from private.r12_adaptive_activations a where a.scope_id=s.id and a.business_id=b
    and a.goal_id=g and a.plan_hash=private.r04_hash(v))) or
   (v->>'format'='r12.discovery-episode.1'$new$);
 d:=replace(d,$old$'r12.discovery.1','r12.discovery-episode.1','r12.discovery-review.1'$old$,
  $new$'r12.discovery.1','r12.discovery-episode.1','r12.discovery-adaptive.1','r12.discovery-review.1'$new$);
 execute d;
 d:=pg_get_functiondef('private.r12_authority_validate()'::regprocedure);
 if position($old$if (new.plan->>'format'='r12.discovery-episode.1') is distinct from (s.origin='owner_episode')$old$ in d)=0
 then raise exception 'r12_adaptive_authority_guard_changed';end if;
 d:=replace(d,$old$if (new.plan->>'format'='r12.discovery-episode.1') is distinct from (s.origin='owner_episode')$old$,
  $new$if (new.plan->>'format'='r12.discovery-adaptive.1') is distinct from (s.origin='owner_adaptive')
   then raise exception 'r12_adaptive_scope_format_mismatch';end if;
 if (new.plan->>'format'='r12.discovery-episode.1') is distinct from (s.origin='owner_episode')$new$);
 d:=replace(d,$old$new.valid_until>clock_timestamp()+interval '30 minutes'$old$,
  $new$(case when s.origin='owner_adaptive' then new.valid_until>(s.amendment->>'expiresAt')::timestamptz
   else new.valid_until>clock_timestamp()+interval '30 minutes' end)$new$);
 d:=replace(d,$old$'r12.discovery.1','r12.discovery-episode.1','r12.discovery-review.1'$old$,
  $new$'r12.discovery.1','r12.discovery-episode.1','r12.discovery-adaptive.1','r12.discovery-review.1'$new$);
 execute d;
end $adaptive_authority_patch$;

do $adaptive_scope_read_patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_discovery_scope_current(private.r07_plans)'::regprocedure);
 if position($old$ if p.content->>'format'='r12.discovery-pilot.1' then$old$ in d)=0
 then raise exception 'r12_adaptive_scope_current_changed';end if;
 d:=replace(d,$old$ if p.content->>'format'='r12.discovery-pilot.1' then$old$,
  $new$ if p.content->>'format'='r12.discovery-adaptive.1' then
   select * into s from private.r12_discovery_scopes where id=(p.content->>'discoveryScopeId')::uuid
    and business_id=p.business_id and goal_id=p.goal_id and origin='owner_adaptive'
    and amendment_hash=p.content->>'discoveryScopeHash';
   if s.id is null then raise exception 'r12_adaptive_scope_required';end if;
   perform private.r12_adaptive_scope_resolve(s.id);return s;
 end if;
 if p.content->>'format'='r12.discovery-pilot.1' then$new$);
 execute d;
 d:=pg_get_functiondef('private.r12_discovery_scope_at(private.r07_plans,timestamp with time zone)'::regprocedure);
 if position($old$ if p.content->>'format'='r12.discovery-pilot.1' then$old$ in d)=0
 then raise exception 'r12_adaptive_scope_at_changed';end if;
 d:=replace(d,$old$ if p.content->>'format'='r12.discovery-pilot.1' then$old$,
  $new$ if p.content->>'format'='r12.discovery-adaptive.1' then
   select * into s from private.r12_discovery_scopes where id=(p.content->>'discoveryScopeId')::uuid
    and business_id=p.business_id and goal_id=p.goal_id and origin='owner_adaptive'
    and amendment_hash=p.content->>'discoveryScopeHash';
   if s.id is null or not exists(select 1 from private.r12_adaptive_activations a
    join private.r12_discovery_authorities q on q.scope_id=a.scope_id and q.plan_hash=p.content_hash
    where a.scope_id=s.id and a.plan_id=p.id and a.plan_hash=p.content_hash
     and q.receipt_until>clock_timestamp() and (s.amendment->>'createdAt')::timestamptz<=effective_at
     and effective_at<=q.receipt_until)
   then raise exception 'r12_adaptive_historical_scope_required';end if;
   return s;
 end if;
 if p.content->>'format'='r12.discovery-pilot.1' then$new$);
 execute d;
end $adaptive_scope_read_patch$;

do $adaptive_owner_activation_read_patch$ declare d text;begin
 d:=pg_get_functiondef('public.r12_discovery_owner_read(uuid,uuid,boolean)'::regprocedure);
 if position($old$'r12.discovery-owner-initial.1','r12.discovery-owner-episode.1','r12.discovery-source-scope.1'$old$ in d)=0
 then raise exception 'r12_adaptive_owner_read_scope_allowlist_changed';end if;
 d:=replace(d,$old$'r12.discovery-owner-initial.1','r12.discovery-owner-episode.1','r12.discovery-source-scope.1'$old$,
  $new$'r12.discovery-owner-initial.1','r12.discovery-owner-episode.1','r12.discovery-owner-adaptive.1','r12.discovery-source-scope.1'$new$);
 if position($old$source_scope.origin in ('owner_initial','owner_episode')$old$ in d)=0
 then raise exception 'r12_adaptive_owner_read_budget_changed';end if;
 d:=replace(d,$old$source_scope.origin in ('owner_initial','owner_episode')$old$,
  $new$source_scope.origin in ('owner_initial','owner_episode','owner_adaptive')$new$);
 if position($old$budget:=private.r12_owner_scope_resolve(source_scope,(source_scope.amendment->>'createdAt')::timestamptz,false)->'budget';$old$ in d)=0
 then raise exception 'r12_adaptive_owner_read_funding_changed';end if;
 d:=replace(d,$old$budget:=private.r12_owner_scope_resolve(source_scope,(source_scope.amendment->>'createdAt')::timestamptz,false)->'budget';$old$,
  $new$budget:=case when source_scope.origin='owner_adaptive' then
  (select private.r12_owner_funding(funding_binding)->'budget' from private.r12_adaptive_setups setup
   join private.r12_owner_funding_bindings funding_binding on funding_binding.id=setup.binding_id
   where setup.scope_id=source_scope.id and setup.business_id=p_business_id)
  else private.r12_owner_scope_resolve(source_scope,(source_scope.amendment->>'createdAt')::timestamptz,false)->'budget' end;
 if source_scope.origin='owner_adaptive' and budget is null then raise exception 'r12_adaptive_owner_read_funding_required';end if;
 if source_scope.origin='owner_adaptive' then
  stopped:=stopped or exists(select 1 from private.r12_adaptive_setups setup
   join private.r12_owner_bootstrap_grants gr on gr.id=setup.grant_id
   where setup.scope_id=source_scope.id and (gr.valid_until<=clock_timestamp()
    or exists(select 1 from private.r12_owner_grant_revocations where grant_id=gr.id)
    or exists(select 1 from private.r12_owner_profile_revocations where profile_id=setup.profile_id)));
 end if;$new$);
 if position($old$'operations',(select payload->'operations' from private.r05_policies where id=(authority.plan->>'policyId')::uuid)) else null end$old$ in d)=0
 then raise exception 'r12_adaptive_owner_read_activation_changed';end if;
 d:=replace(d,$old$'operations',(select payload->'operations' from private.r05_policies where id=(authority.plan->>'policyId')::uuid)) else null end$old$,
  $new$'operations',(select payload->'operations' from private.r05_policies where id=(authority.plan->>'policyId')::uuid))
 ||case when source_scope.origin='owner_adaptive' then jsonb_build_object(
  'preview',(select s.preview from private.r12_adaptive_setups s where s.scope_id=source_scope.id),
  'quote',(select s.quote from private.r12_adaptive_setups s where s.scope_id=source_scope.id))
 else '{}'::jsonb end else null end$new$);
 execute d;
end $adaptive_owner_activation_read_patch$;

-- The initial intent is previewed from saved bytes. Its createdAt, scope hash
-- and action hash must be fixed before planner serialization and confirmation.
create function private.r12_adaptive_proposed_scope(s private.r12_adaptive_setups)
returns jsonb language plpgsql stable set search_path='' as $$
declare p private.r12_owner_profiles;binding private.r12_owner_funding_bindings;
 goal private.r04_goal_versions;br private.r04_business_versions;f jsonb;
 approval_revision integer;approval_maximum bigint;approval_hash text;intent jsonb;begin
 select * into p from private.r12_owner_profiles where id=s.profile_id;
 select * into binding from private.r12_owner_funding_bindings where id=s.binding_id;
 select v.* into goal from private.r04_goal_versions v join private.r04_goal_state st using(business_id,goal_id,revision)
  where v.business_id=s.business_id and v.goal_id=s.goal_id;
 select v.* into br from private.r04_business_versions v join private.r04_business_state st using(business_id,revision)
  where v.business_id=s.business_id;
 if s.id is null or p.id is null or binding.id is null or goal.goal_id is null or br.business_id is null
 or s.preview->'predecessor'->>'goalHash' is distinct from goal.content_hash
 or s.preview->'predecessor'->>'businessHash' is distinct from br.content_hash
 then raise exception 'r12_adaptive_scope_inputs_changed';end if;
 f:=private.r12_owner_funding(binding);
 if f->>'hash' is distinct from s.preview->'funding'->>'bindingHash'
 or (f->>'revision')::integer is distinct from (s.preview->'funding'->>'revision')::integer
 or f->>'maximumMicrounits' is distinct from s.preview->'funding'->>'currentLimitMicrounits'
 then raise exception 'r12_adaptive_funding_changed';end if;
 approval_maximum:=(s.preview->'funding'->>'proposedLimitMicrounits')::bigint;
 approval_revision:=(f->>'revision')::integer+case when approval_maximum>(f->>'maximumMicrounits')::bigint then 1 else 0 end;
 if binding.kind='legacy_research_root' and approval_maximum>(f->>'maximumMicrounits')::bigint then
 approval_hash:=private.stage14_hash(jsonb_build_object('bindingId',binding.id,
   'revision',approval_revision,'previousHash',f->>'hash',
   'previousMaximumMicrounits',f->>'maximumMicrounits',
   'maximumMicrounits',approval_maximum::text,
   'committedMicrounits',f->>'committedMicrounits',
   'policyId',s.policy_id,'ownerId',s.owner_id));
 elsif approval_maximum>(f->>'maximumMicrounits')::bigint then
  approval_hash:=private.stage14_hash(jsonb_build_object('bindingId',binding.id,
   'revision',approval_revision,'maximumMicrounits',approval_maximum::text));
 else
  approval_hash:=f->>'hash';
 end if;
 intent:=jsonb_build_object('version','pod-discovery-2.0','id',s.scope_id,'businessId',s.business_id,
  'objective',goal.content->>'objective','comparisonUniverse',jsonb_build_object('productType','original_pod_tshirt',
   'markets',s.selection->'markets','audiences',jsonb_build_array(s.selection->>'audience'),
   'sourceDomains',s.selection->'allowedDomains','selectionQuestion',s.selection->>'approvedQuery'),
  'limits',jsonb_build_object('maximumAlternatives',3,'maximumNewCollections',1,
   'maximumMicrousd',(s.preview->>'maximumRunMicrounits')::bigint,'maximumGenerations',1),
  'expiresAt',s.preview->>'expiresAt');
 return jsonb_build_object('version','r12.discovery-owner-adaptive.1','id',s.scope_id,
  'businessId',s.business_id,'goalId',s.goal_id,'goalRevision',goal.revision,'goalHash',goal.content_hash,
  'businessRevision',br.revision,'businessHash',br.content_hash,'setupId',s.id,'setupHash',s.setup_hash,
  'profile',p.profile,'profileHash',p.profile_hash,
  'selection',jsonb_build_object('marketSetKey',s.selection->>'marketSetKey','topicKey',s.selection->>'topicKey'),
  'funding',f->'binding','fundingApproval',jsonb_build_object('revision',approval_revision,'hash',approval_hash,
   'maximumMicrounits',approval_maximum::text),'intent',intent,
  'allowedDomains',s.selection->'allowedDomains','excludedDomains',s.selection->'excludedDomains',
  'approvedQuery',s.selection->>'approvedQuery','approvalHash',s.approval_hash,
  'independentReviewHash',p.profile->>'independentReviewHash',
  'predecessorClosure',s.preview->'predecessor','predecessorClosureHash',s.preview->>'predecessorHash',
  'imports',s.preview->'imports','quoteHash',s.quote->>'quoteHash',
  'ownerObservationRef',s.owner_observation_ref,
  'maximumActions',s.preview->'maximumActions','maximumPaidCalls',s.preview->'maximumPaidCalls',
  'maximumRunMicrounits',s.preview->>'maximumRunMicrounits',
  'createdAt',s.created_at,'expiresAt',s.preview->>'expiresAt');
end $$;

create function private.r12_adaptive_initial_action(scope jsonb) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('version','r12.adaptive-action.1','scopeId',scope->>'id',
  'scopeHash',private.stage14_hash(scope),'ordinal',0,'kind','initial',
  'previousActionHash',null,'previousReviewHash',scope->'imports'->4->>'responseHash',
  'question',scope->>'approvedQuery','hypothesis',left(scope->'intent'->>'objective',500),
  'expectedInformationGain','Identify dated public evidence and the main uncertainty in this original POD research question.',
  'counterevidenceQuestion','What reliable public evidence would contradict the proposed opportunity and require a narrower conclusion?',
  'phases',private.r12_adaptive_action_phases('initial'),'repair',null)
$$;

-- Integration fragment only. Install after adaptive ledgers and before wrappers.
-- No public entry point: the controller-authenticated server owns admission.
create table private.r12_adaptive_input_snapshots (
 attempt_id uuid primary key references private.r07_attempts(id),
 scope_id uuid not null references private.r12_adaptive_activations(scope_id),
 action_hash text not null check(action_hash ~ '^[a-f0-9]{64}$'),
 content jsonb not null,content_hash text not null check(content_hash=private.stage14_hash(content)),
 created_at timestamptz not null default clock_timestamp(),
 check(content->>'version'='r12.discovery-adaptive-inputs.1' and content->>'inputMode'='dispatch'
  and content->>'attemptId'=attempt_id::text and content->>'actionHash'=action_hash)
);
alter table private.r12_adaptive_input_snapshots enable row level security;
revoke all on private.r12_adaptive_input_snapshots from public,anon,authenticated,service_role;
create trigger adaptive_input_immutable before insert or update or delete on private.r12_adaptive_input_snapshots
 for each row execute function private.r12_owner_immutable();

-- Historical evidence is checked against its immutable accepted response and
-- settlement, not a dynamic receipt status which changes when the head advances.
create function private.r12_adaptive_input_dependency(p_attempt uuid) returns jsonb
language plpgsql set search_path='' as $$
declare a private.r07_attempts;p private.r07_plans;s private.r12_discovery_scopes;
 r private.r07_responses;w private.r12_discovery_wires;c private.r12_discovery_candidates;
 req private.r05_requests;proof jsonb;mark timestamptz;pins jsonb;intent_id text;
begin
 select * into strict a from private.r07_attempts where id=p_attempt;
 select * into strict p from private.r07_plans where id=a.plan_id and business_id=a.business_id;
 select * into strict r from private.r07_responses where attempt_id=a.id and business_id=a.business_id;
 select * into strict w from private.r12_discovery_wires where attempt_id=a.id and business_id=a.business_id;
 select * into strict s from private.r12_discovery_scopes where id=w.scope_id and business_id=a.business_id;
 select * into strict c from private.r12_discovery_candidates where request_id=w.request_id;
 select * into strict req from private.r05_requests where id=w.request_id and business_id=a.business_id;
 select created_at into strict mark from private.r05_markers where request_id=req.id;
 select o.proof into proof from private.r12_discovery_receipt_checks ck
 join private.r12_discovery_receipt_observations o on o.check_id=ck.id
 where ck.request_id=req.id and o.proof->>'proofHash'=r.content->'result'->>'routeProofHash'
 order by ck.attempt desc limit 1;
 if a.status<>'completed' or r.content->>'outcome' is distinct from 'accepted'
 or r.content->>'planHash' is distinct from p.content_hash
 or r.content->'result'->>'candidateHash' is distinct from c.candidate_hash
 or c.candidate_hash is distinct from private.stage14_hash(c.candidate)
 or r.content->'result'->>'outputHash' is distinct from private.stage14_hash(c.candidate->'output')
 or w.binding->>'requestHash' is distinct from private.stage14_hash((w.binding->>'requestJson')::jsonb)
 or proof is null or mark>(c.candidate->>'receivedAt')::timestamptz
 or (c.candidate->>'receivedAt')::timestamptz>=c.receipt_expires_at
 or not exists(select 1 from private.r05_settlements st where st.request_id=req.id
   and st.actual_microunits=(c.candidate->>'reportedMicrousd')::bigint
   and st.provider_request_id=c.candidate->>'providerRequestId')
 then raise exception 'r12_adaptive_completed_dependency_unverified';end if;
 perform private.r12_discovery_proof_validate(c,proof);
 if a.adaptive_action_hash is not null then
  select content->'intentPins',content->'intent'->>'id' into pins,intent_id
  from private.r12_adaptive_input_snapshots where attempt_id=a.id and scope_id=s.id and action_hash=a.adaptive_action_hash;
  if pins is null or r.content->'result'->>'adaptiveActionHash' is distinct from a.adaptive_action_hash
  or (r.content->'result'->>'adaptiveActionOrdinal')::integer is distinct from a.adaptive_action_ordinal
  then raise exception 'r12_adaptive_dependency_snapshot_required';end if;
 else intent_id:=s.amendment->'intent'->>'id';end if;
 if intent_id is null then raise exception 'r12_adaptive_dependency_intent_required';end if;
 return jsonb_build_object('stepKey',a.step_key,'attemptId',a.id,'artifactId',r.artifact_id,
  'responseHash',r.content_hash,'responseCanonicalHash',private.stage14_hash(r.content),'response',r.content,
  'binding',jsonb_build_object('scopeId',s.id,'attemptId',a.id,'requestId',req.id,'phase',a.step_key,
   'request',(w.binding->>'requestJson')::jsonb,'maximumMicrousd',req.liability_microunits,
   'dispatchedAt',mark,'receiptExpiresAt',c.receipt_expires_at),'candidate',c.candidate,'proof',proof,
  'origin',jsonb_build_object('planHash',p.content_hash,'scopeId',s.id,'scopeHash',s.amendment_hash,
   'intentId',intent_id,'actionHash',a.adaptive_action_hash,'actionOrdinal',a.adaptive_action_ordinal),
  'intentPins',pins);
end $$;

-- Rebuild Core's exact source-span pack from the saved selector request. That
-- request already contains canonical URLs and normalized retained excerpts.
-- Comparing the accepted pack hash prevents inventing or truncating evidence.
create function private.r12_adaptive_evidence_archive(selector_attempt uuid) returns jsonb
language plpgsql set search_path='' as $$
declare t jsonb;s jsonb;pin jsonb;body jsonb;item jsonb;source jsonb;selection jsonb;
 sources jsonb:='[]';evidence jsonb:='[]';claims jsonb:='[]';limitations jsonb:='["publication_dates_unknown"]';
 pack jsonb;qualified jsonb;persisted jsonb;ch text;sid text;eid text;origin jsonb;
begin
 t:=private.r12_adaptive_input_dependency(selector_attempt);
 if t->>'stepKey'<>'select1' then raise exception 'r12_adaptive_selector_required';end if;
 select value into strict pin from private.r07_attempts a cross join lateral jsonb_array_elements(a.dependency_pins)
 where a.id=selector_attempt and value->>'stepKey'='search1';
 s:=private.r12_adaptive_input_dependency((pin->>'attemptId')::uuid);
 if s->>'stepKey'<>'search1' or s->>'responseHash' is distinct from pin->>'resultHash'
 or s->'origin' is distinct from t->'origin' then raise exception 'r12_adaptive_archive_pair_required';end if;
 origin:=s->'origin';body:=(t->'binding'->'request'->'messages'->1->>'content')::jsonb;
 if body->>'question' is distinct from s->'binding'->'request'->>'query'
 or body->'allowedDomains' is distinct from s->'binding'->'request'->'allowedDomains'
 or jsonb_typeof(body->'sources') is distinct from 'array' or jsonb_array_length(body->'sources') not between 1 and 4
 then raise exception 'r12_adaptive_archive_source_request';end if;
 for item in select value from jsonb_array_elements(body->'sources') loop
  ch:=encode(extensions.digest(convert_to(item->>'excerpt','UTF8'),'sha256'),'hex');
  sid:='src-'||left(encode(extensions.digest(convert_to((item->>'url')||':'||ch,'UTF8'),'sha256'),'hex'),24);
  sources:=sources||jsonb_build_array(jsonb_build_object('id',sid,'url',item->>'url','title',item->>'title',
   'retrievedAt',item->>'retrievedAt','publishedAt',item->'publishedAt',
   'retrievalExpiresAt',to_char(((item->>'retrievedAt')::timestamptz+interval '24 hours') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'contentHash',ch,'excerpt',item->>'excerpt','provider','openrouter.exa'));
 end loop;
 for selection in select value from jsonb_array_elements(t->'candidate'->'output'->'selections') loop
  source:=sources->(substring(selection->>'sourceKey' from 2)::integer-1);
  if source is null or position(selection->>'quote' in source->>'excerpt')=0
  then raise exception 'r12_adaptive_exact_span_required';end if;
  eid:='evi-'||left(encode(extensions.digest(convert_to((source->>'id')||':'||(selection->>'quote'),'UTF8'),'sha256'),'hex'),24);
  evidence:=evidence||jsonb_build_array(jsonb_build_object('id',eid,'sourceId',source->>'id','quote',selection->>'quote'));
  claims:=claims||jsonb_build_array(jsonb_build_object('text',selection->>'quote','evidenceId',eid,'sourceId',source->>'id'));
 end loop;
 select coalesce(jsonb_agg(x.value order by x.ord),'[]'::jsonb) into sources
 from jsonb_array_elements(sources) with ordinality x(value,ord)
 where exists(select 1 from jsonb_array_elements(evidence)e where e->>'sourceId'=x.value->>'id');
 for item in select value from jsonb_array_elements(t->'candidate'->'output'->'limitations') loop
  if not limitations @> jsonb_build_array(item) then limitations:=limitations||jsonb_build_array(item);end if;
 end loop;
 pack:=jsonb_build_object('evidencePackVersion','1.0','question',body->>'question','sources',sources,
  'evidence',evidence,'claims',claims,'limitations',limitations);
 if private.stage14_hash(pack) is distinct from t->'response'->'result'->>'evidencePackHash'
 then raise exception 'r12_adaptive_archive_pack_hash';end if;
 qualified:=jsonb_build_object('version',case when origin->>'actionHash' is null then 'r12.discovery-source.1' else 'r12.discovery-adaptive-source.1' end,
  'scopeId',origin->>'scopeId','scopeHash',origin->>'scopeHash','searchCandidateHash',private.stage14_hash(s->'candidate'),
  'selectorCandidateHash',private.stage14_hash(t->'candidate'),'searchRoute',s->'proof','selectorRoute',t->'proof');
 if origin->>'actionHash' is not null then qualified:=qualified||jsonb_build_object('actionIntentId',origin->>'intentId','actionHash',origin->>'actionHash');end if;
 persisted:=jsonb_build_object('artifactId',t->>'artifactId','businessId',(select business_id from private.r07_attempts where id=selector_attempt),
  'workflowRunId',selector_attempt,'queryId',private.stage4_deterministic_uuid('discovery:v2:query:'||(origin->>'intentId')||':1'),
  'collectedForIntentId',origin->>'intentId','question',body->>'question','sourceDomains',body->'allowedDomains','evidencePack',pack,
  'lineage',jsonb_build_object('status','completed','executionMode','r12.discovery','provider','openrouter.exa',
   'sourceArtifactId',s->>'artifactId','providerRequestId',s->'candidate'->>'providerRequestId',
   'workerRequestId',t->'candidate'->>'providerRequestId','qualifiedSource',qualified));
 return jsonb_build_object('persisted',persisted,'search',s,'selector',t);
end $$;

create function private.r12_adaptive_archive_manifest(archive jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('artifactId',x->'persisted'->>'artifactId',
  'packHash',private.stage14_hash(x->'persisted'->'evidencePack'),'queryId',x->'persisted'->>'queryId',
  'collectedForIntentId',x->'persisted'->>'collectedForIntentId',
  'scopeId',x->'selector'->'origin'->>'scopeId','scopeHash',x->'selector'->'origin'->>'scopeHash',
  'actionHash',x->'selector'->'origin'->'actionHash') order by ord),'[]'::jsonb)
 from jsonb_array_elements(archive) with ordinality v(x,ord)
$$;

-- Preserve actual accepted uncertainties and negative findings. Long authentic
-- rationales are split losslessly into bounded chunks, never summarized by SQL.
create function private.r12_adaptive_history_append(history jsonb,kind text,statement text,response_hash text,artifacts jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare parts integer;width integer;i integer;part text;begin
 if statement is null or length(btrim(statement))<10 then return history;end if;
 parts:=ceil(length(statement)/600.0)::integer;width:=ceil(length(statement)::numeric/parts)::integer;
 for i in 0..parts-1 loop
  part:=substring(statement from 1+i*width for width);
  if not exists(select 1 from jsonb_array_elements(history) h where h->>'kind'=kind
   and translate(regexp_replace(btrim(h->>'statement'),E'[ \\t\\r\\n]+',' ','g'),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')
    =translate(regexp_replace(btrim(part),E'[ \\t\\r\\n]+',' ','g'),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')) then
   history:=history||jsonb_build_array(jsonb_build_object('kind',kind,'statement',part,
    'recordHash',private.stage14_hash(jsonb_build_object('responseHash',response_hash,'kind',kind,'statement',part,'part',i)),
    'evidenceArtifactIds',artifacts));
  end if;
 end loop;
 if jsonb_array_length(history)>100 then raise exception 'r12_adaptive_complete_history_bound';end if;
 return history;
end $$;

create function private.r12_adaptive_history_from_dependency(history jsonb,d jsonb,artifacts jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare raw jsonb:=d->'candidate'->'output';item jsonb;dim jsonb;candidate jsonb;question jsonb;begin
 if d->>'stepKey'='strategy' then
  raw:=coalesce(raw->'assessment',raw);
  for candidate in select value from jsonb_array_elements(coalesce(raw->'candidates','[]')) loop
   for dim in select value from jsonb_array_elements(coalesce(candidate->'dimensions','[]')) loop
    for question in select value from jsonb_array_elements(coalesce(dim->'uncertainties','[]')) loop
     history:=private.r12_adaptive_history_append(history,'unresolved_question',question->>'question',d->>'responseHash',artifacts);
    end loop;
    if dim->'hardFailure'='true'::jsonb or dim->>'finding'='unfavorable' then
     history:=private.r12_adaptive_history_append(history,'negative_finding',dim->>'rationale',d->>'responseHash',artifacts);
    end if;
   end loop;
  end loop;
 elsif d->>'stepKey'='review' then
  history:=private.r12_adaptive_history_append(history,'prior_decision',raw->>'sufficiencyRationale',d->>'responseHash',artifacts);
  for item in select value from jsonb_array_elements(coalesce(raw->'additionalUncertainties','[]')) loop
   history:=private.r12_adaptive_history_append(history,'unresolved_question',item->>'question',d->>'responseHash',artifacts);
  end loop;
  for item in select value from jsonb_array_elements(coalesce(d->'response'->'result'->'review'->'inheritedQuestions','[]')||coalesce(d->'response'->'result'->'review'->'additionalQuestions','[]')) loop
   history:=private.r12_adaptive_history_append(history,'unresolved_question',item#>>'{}',d->>'responseHash',artifacts);
  end loop;
  for dim in select value from jsonb_array_elements(coalesce(raw->'dimensions','[]')) loop
   if dim->>'verdict'='known_failure' then
    history:=private.r12_adaptive_history_append(history,'negative_finding',dim->>'rationale',d->>'responseHash',artifacts);
   end if;
  end loop;
 end if;
 return history;
end $$;

create function private.r12_adaptive_predecessor_context(s private.r12_adaptive_setups) returns jsonb
language plpgsql set search_path='' as $$
declare pin jsonb;d jsonb;archive jsonb:='[]';history jsonb:='[]';refs jsonb:='[]';begin
 if jsonb_array_length(s.preview->'imports')<>5 then raise exception 'r12_adaptive_predecessor_imports_required';end if;
 for pin in select value from jsonb_array_elements(s.preview->'imports') loop
  d:=private.r12_adaptive_input_dependency((pin->>'attemptId')::uuid);
  if d->>'stepKey' is distinct from pin->>'phase' or d->>'artifactId' is distinct from pin->>'artifactId'
   or d->>'responseHash' is distinct from pin->>'responseHash' or d->'proof'->>'proofHash' is distinct from pin->>'receiptProofHash'
   or not exists(select 1 from private.r07_attempts t where t.id=(pin->>'attemptId')::uuid
    and t.business_id=s.business_id and t.plan_id=(s.preview->'predecessor'->>'predecessorPlanId')::uuid)
  then raise exception 'r12_adaptive_predecessor_pin_changed';end if;
  if d->>'stepKey'='select1' then
   archive:=jsonb_build_array(private.r12_adaptive_evidence_archive((d->>'attemptId')::uuid));
   refs:=jsonb_build_array(d->>'artifactId');
  end if;
 end loop;
 if jsonb_array_length(archive)<>1 then raise exception 'r12_adaptive_predecessor_evidence_required';end if;
 for pin in select value from jsonb_array_elements(s.preview->'imports') where value->>'phase' in ('strategy','review') loop
  d:=private.r12_adaptive_input_dependency((pin->>'attemptId')::uuid);
  history:=private.r12_adaptive_history_from_dependency(history,d,refs);
 end loop;
 return jsonb_build_object('archive',archive,'evidenceManifest',private.r12_adaptive_archive_manifest(archive),
  'materialHistory',history,'priorFindings','[]'::jsonb);
end $$;

create function private.r12_adaptive_phase_inputs(a private.r07_attempts,p private.r07_plans) returns jsonb
language plpgsql set search_path='' as $$
declare activation private.r12_adaptive_activations;setup private.r12_adaptive_setups;
 scope private.r12_discovery_scopes;action private.r12_adaptive_actions;binding private.r12_owner_funding_bindings;
 saved private.r12_adaptive_input_snapshots;installation public.installed_packs;
 predecessor jsonb;archive jsonb;manifest jsonb;history jsonb;prior_findings jsonb:='[]';
 deps jsonb:='[]';pin jsonb;d jsonb;item jsonb;review jsonb;progress jsonb;review_input jsonb;identities jsonb;
 active jsonb:='[]';intent jsonb;pins jsonb;knowledge jsonb;finance jsonb;funding jsonb;output jsonb;owner_context jsonb;
 v_attempt_id uuid;refs jsonb;step jsonb;run_known bigint;action_known bigint;unknown boolean;
 at_time timestamptz:=clock_timestamp();mark timestamptz;receipt_deadline timestamptz;own_request uuid;preflight jsonb;
begin
 -- Serialize the first read, so prepare before and after reserve has one exact
 -- request-time context. This helper never authorizes reservation or transport.
 select t.* into a from private.r07_attempts t where t.id=a.id and t.plan_id=p.id and t.business_id=p.business_id for update;
 if not found or p.content->>'format' is distinct from 'r12.discovery-adaptive.1'
 or a.adaptive_action_hash is null then raise exception 'r12_adaptive_input_attempt_required';end if;
 select * into strict activation from private.r12_adaptive_activations where plan_id=p.id and business_id=p.business_id;
 select * into strict scope from private.r12_discovery_scopes where id=activation.scope_id and business_id=p.business_id;
 select * into strict setup from private.r12_adaptive_setups where id=activation.setup_id;
 select * into strict action from private.r12_adaptive_actions where scope_id=scope.id
  and ordinal=a.adaptive_action_ordinal and content_hash=a.adaptive_action_hash;
 if scope.amendment_hash is distinct from activation.scope_hash or p.content_hash is distinct from activation.plan_hash
 or scope.amendment_hash is distinct from private.stage14_hash(scope.amendment)
 or not action.content->'phases' ? (case a.step_key when 'search1' then 'search' when 'select1' then 'select' else a.step_key end)
 then raise exception 'r12_adaptive_input_action_required';end if;
 select w.request_id,m.created_at,least((scope.amendment->>'expiresAt')::timestamptz+interval '30 minutes',m.created_at+interval '60 minutes')
 into own_request,mark,receipt_deadline from private.r12_discovery_wires w
 join private.r05_markers m on m.request_id=w.request_id where w.attempt_id=a.id and w.scope_id=scope.id;
 select * into saved from private.r12_adaptive_input_snapshots where attempt_id=a.id;
 if saved.attempt_id is not null then
  if saved.scope_id<>scope.id or saved.action_hash<>action.content_hash
   or saved.content->>'planHash' is distinct from p.content_hash
   or saved.content_hash is distinct from private.stage14_hash(saved.content)
  then raise exception 'r12_adaptive_input_snapshot_changed';end if;
  if mark is not null then
   if a.status not in ('dispatched','responded','uncertain','completed') or mark>=(scope.amendment->>'expiresAt')::timestamptz
    or at_time>=receipt_deadline or (saved.content->>'validationAt')::timestamptz>mark
   then raise exception 'r12_adaptive_input_receipt_window';end if;
   return saved.content||jsonb_build_object('inputMode','receipt');
  end if;
  if a.status not in ('scheduled','reserved') then raise exception 'r12_adaptive_input_dispatch_state';end if;
  perform private.r12_adaptive_scope_resolve(scope.id);
  return saved.content;
 end if;
 if a.status<>'scheduled' or mark is not null or exists(select 1 from private.r07_bindings where attempt_id=a.id)
 then raise exception 'r12_adaptive_scheduled_input_snapshot_required';end if;
 perform private.r12_adaptive_scope_resolve(scope.id);
 select value into strict step from jsonb_array_elements(p.content->'steps') where value->>'key'=a.step_key;
 select * into strict installation from public.installed_packs where id=(step->>'installationId')::uuid and business_id=p.business_id;
 select input_snapshot into strict preflight from private.r12_adaptive_planner_receipts where scope_id=scope.id;
 if installation.status<>'active' or private.r04_hash(installation.snapshot) is distinct from step->>'packSnapshotHash'
 or installation.snapshot is distinct from preflight->'knowledgeSnapshot'
 then raise exception 'r12_adaptive_knowledge_changed';end if;
 knowledge:=preflight->'knowledgeSnapshot';predecessor:=private.r12_adaptive_predecessor_context(setup);
 archive:=predecessor->'archive';history:=predecessor->'materialHistory';
 if jsonb_array_length(a.dependency_pins)<>jsonb_array_length(step->'dependsOn') then raise exception 'r12_adaptive_dependency_count';end if;
 for pin in select value from jsonb_array_elements(a.dependency_pins) loop
  d:=private.r12_adaptive_input_dependency((pin->>'attemptId')::uuid);
  if d->>'stepKey' is distinct from pin->>'stepKey' or d->>'responseHash' is distinct from pin->>'resultHash'
   or not (step->'dependsOn') ? (pin->>'stepKey')
   or not exists(select 1 from private.r07_attempts t where t.id=(pin->>'attemptId')::uuid and t.plan_id=p.id and t.business_id=p.business_id)
  then raise exception 'r12_adaptive_dependency_pin_changed';end if;
  if action.content->'phases' ? (case pin->>'stepKey' when 'search1' then 'search' when 'select1' then 'select' else pin->>'stepKey' end) then
   if d->'origin'->>'actionHash' is distinct from action.content_hash then raise exception 'r12_adaptive_current_action_dependency';end if;
  elsif not exists(select 1 from private.r12_adaptive_action_dependencies ad where ad.scope_id=scope.id
   and ad.action_ordinal=action.ordinal and ad.step_key=pin->>'stepKey'
   and ad.source_attempt_id=(pin->>'attemptId')::uuid and ad.response_hash=pin->>'resultHash') then
   raise exception 'r12_adaptive_imported_action_dependency';
  end if;
  deps:=deps||jsonb_build_array(d);
 end loop;
 -- All accepted collections from this run remain in the archive, including
 -- refuted candidates. Only the latest six packs enter the active dossier.
 for v_attempt_id in select t.id from private.r07_attempts t where t.plan_id=p.id and t.status='completed'
  and t.step_key='select1' and t.adaptive_action_ordinal<=action.ordinal order by t.adaptive_action_ordinal,t.attempt,t.id loop
  archive:=archive||jsonb_build_array(private.r12_adaptive_evidence_archive(v_attempt_id));
 end loop;
 manifest:=private.r12_adaptive_archive_manifest(archive);
 if jsonb_array_length(manifest)>64 then raise exception 'r12_adaptive_complete_archive_bound';end if;
 select coalesce(jsonb_agg(x->'artifactId' order by ord),'[]'::jsonb) into active
 from jsonb_array_elements(manifest) with ordinality m(x,ord) where ord>greatest(0,jsonb_array_length(manifest)-6);
 for v_attempt_id in select t.id from private.r07_attempts t where t.plan_id=p.id and t.status='completed'
  and t.step_key in ('strategy','review') and t.adaptive_action_ordinal<action.ordinal
  order by t.adaptive_action_ordinal,case t.step_key when 'strategy' then 0 else 1 end,t.attempt,t.id loop
  d:=private.r12_adaptive_input_dependency(v_attempt_id);
  refs:=d->'intentPins'->'activeEvidenceArtifactIds';
  history:=private.r12_adaptive_history_from_dependency(history,d,refs);
  review:=d->'response'->'result'->'review';progress:=review->'progress';
  if jsonb_typeof(progress)='object' then
   review_input:=(d->'binding'->'request'->'messages'->1->>'content')::jsonb;
   select coalesce(jsonb_agg(review_input->'reviewContext'->'evidenceIdentityHashes'->(x#>>'{}') order by ord),'[]'::jsonb)
    into identities from jsonb_array_elements(progress->'supportingRefs') with ordinality r(x,ord);
   if exists(select 1 from jsonb_array_elements(identities)x where jsonb_typeof(x)<>'string' or x#>>'{}' !~ '^[a-f0-9]{64}$')
   then raise exception 'r12_adaptive_progress_evidence_required';end if;
   -- An unchanged delta must keep its original statement/hash, not relabel a paraphrase.
   if progress->>'kind'<>'unchanged' and progress->>'afterFindingHash' is distinct from progress->>'beforeFindingHash' then
    select coalesce(jsonb_agg(x order by ord),'[]'::jsonb) into prior_findings
     from jsonb_array_elements(prior_findings) with ordinality f(x,ord) where x->>'questionId' is distinct from progress->>'questionId';
    prior_findings:=prior_findings||jsonb_build_array(jsonb_build_object('questionId',progress->>'questionId',
     'findingHash',progress->>'afterFindingHash','statement',review->'rawResponse'->'progress'->>'finding','evidenceIdentityHashes',identities));
   end if;
  end if;
 end loop;
 for item in select value from jsonb_array_elements(history) where value->>'kind'='unresolved_question' loop
  if not exists(select 1 from jsonb_array_elements(prior_findings) f where f->>'questionId'='gap-'||(item->>'recordHash')) then
   prior_findings:=prior_findings||jsonb_build_array(jsonb_build_object('questionId','gap-'||(item->>'recordHash'),
    'findingHash',item->>'recordHash','statement',item->>'statement','evidenceIdentityHashes','[]'::jsonb));
  end if;
 end loop;
 if jsonb_array_length(prior_findings)>100 then raise exception 'r12_adaptive_complete_findings_bound';end if;
 intent:=scope.amendment->'intent';
 if action.ordinal>0 then
  intent:=jsonb_set(intent,'{id}',to_jsonb(private.stage4_deterministic_uuid('r12:adaptive:intent:'||scope.id::text||':'||action.ordinal::text)::text));
  intent:=jsonb_set(intent,'{comparisonUniverse,selectionQuestion}',to_jsonb((scope.amendment->>'approvedQuery')||E'\nInvestigate: '||(action.content->>'question')));
  intent:=jsonb_set(intent,'{limits,maximumNewCollections}',to_jsonb(case when action.content->'phases' ? 'search' then 1 else 0 end));
 end if;
 if action.ordinal=0 and a.step_key='plan' then
  -- Reproduce the pre-confirmation request exactly, including original finance.
  pins:=preflight->'intentPins';intent:=preflight->'intent';
  owner_context:=preflight->'ownerObservationContext';
  if pins->'evidenceManifest' is distinct from manifest or pins->'materialHistory' is distinct from history
   or pins->>'actionHash' is distinct from action.content_hash then raise exception 'r12_adaptive_planner_context_changed';end if;
 else
  select * into strict binding from private.r12_owner_funding_bindings where id=activation.binding_id;
  funding:=private.r12_owner_funding(binding);
  select coalesce(sum(e.held),0),coalesce(bool_or(e.unknown),false) into run_known,unknown
   from private.r05_exposure(p.business_id)e where e.policy_id=activation.policy_id;
  select coalesce(sum(st.actual_microunits),0) into action_known from private.r12_adaptive_call_admissions ca
   join lateral(select max(actual_microunits) actual_microunits from private.r05_settlements
    where request_id=ca.request_id and actual_microunits is not null) st on true
   where ca.scope_id=scope.id and ca.action_ordinal=action.ordinal;
  if unknown or funding->'hasUnknown' is distinct from 'false'::jsonb or (funding->>'pendingMicrounits')::bigint<>0
   then raise exception 'r12_adaptive_input_finance_unresolved';end if;
  finance:=jsonb_build_object('authorityRootId',binding.authority_root_id,
   'ledgerSnapshotHash',private.stage14_hash(jsonb_build_object('scopeId',scope.id,'attemptId',a.id,'funding',funding,
    'runCommittedMicrousd',run_known,'actionCommittedMicrousd',action_known)),
   'runMaximumMicrousd',activation.maximum_run_microusd,'runCommittedMicrousd',run_known,
   'rootMaximumMicrousd',(funding->>'maximumMicrounits')::bigint,'rootCommittedMicrousd',(funding->>'committedMicrounits')::bigint,
   'actionMaximumMicrousd',action.maximum_microusd,'actionCommittedMicrousd',action_known);
  pins:=jsonb_build_object('scopeVersion','r12.discovery-owner-adaptive.1','scopeId',scope.id,'scopeHash',scope.amendment_hash,
   'actionHash',action.content_hash,'actionOrdinal',action.ordinal,'approvedQuery',intent->'comparisonUniverse'->>'selectionQuestion',
   'finance',finance,'evidenceManifest',manifest,'activeEvidenceArtifactIds',active,'materialHistory',history,
   'ownerObservationRef',setup.owner_observation_ref);
 end if;
 if owner_context is null then
  owner_context:=private.r12_owner_observation_context(setup.owner_observation_ref,p.business_id,setup.owner_id,
   (intent->>'id')::uuid,scope.id,scope.amendment_hash,setup.approval_hash);
 end if;
 if owner_context is distinct from private.r12_owner_observation_context(setup.owner_observation_ref,p.business_id,
  setup.owner_id,(intent->>'id')::uuid,scope.id,scope.amendment_hash,setup.approval_hash)
  or pins->'ownerObservationRef' is distinct from setup.owner_observation_ref
 then raise exception 'r12_owner_observation_input_changed';end if;
 output:=jsonb_build_object('version','r12.discovery-adaptive-inputs.1','businessId',p.business_id,'planId',p.id,
  'planHash',p.content_hash,'attemptId',a.id,'inputMode','dispatch','validationAt',at_time,
  'scope',scope.amendment,'preview',setup.preview,'action',action.content,'actionHash',action.content_hash,
  'intent',intent,'intentPins',pins,'knowledgeSnapshot',knowledge,'dependencies',deps,'archive',archive,'priorFindings',prior_findings,
  'ownerObservationContext',owner_context);
 if octet_length(output::text)>2097152 then raise exception 'r12_adaptive_complete_input_bound';end if;
 insert into private.r12_adaptive_input_snapshots(attempt_id,scope_id,action_hash,content,content_hash)
 values(a.id,scope.id,action.content_hash,output,private.stage14_hash(output));
 return output;
end $$;

do $$ declare f regprocedure;begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='private' and p.proname in ('r12_adaptive_input_dependency','r12_adaptive_evidence_archive',
  'r12_adaptive_archive_manifest','r12_adaptive_history_append','r12_adaptive_history_from_dependency',
  'r12_adaptive_predecessor_context','r12_adaptive_phase_inputs') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
 end loop;
end $$;

-- Private additive fragment. No public entry point, authority or paid effects.
-- Install after r12_adaptive_input_dependency/input_snapshots are defined.
-- Integrate gate twice: admit_next after constructing body and BEFORE fallback
-- insert returns admitted:false/reason on denial; admit_action repeats gate under
-- its existing locks, after previous_review and before action INSERT, raising on
-- denial. Idempotent existing-action replay remains before this new check.

create function private.r12_adaptive_question_key(v text) returns text
language sql immutable set search_path='' as $$
 select translate(regexp_replace(btrim(v),E'[ \\t\\r\\n]+',' ','g'),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')
$$;

-- Matches adaptiveEvidenceIdentity, including JS trim's Unicode whitespace.
-- URLs, retrieval time, artifact IDs and source/span offsets are NOT novelty.
create function private.r12_adaptive_quote_identity(v text) returns text
language sql immutable set search_path='' as $$
 select private.stage14_hash(jsonb_build_object('version','r12.evidence-text.1','quote',
  btrim(regexp_replace(normalize(v,NFC),E'[\\t\\n\\v\\f\\r ]+',' ','g'),
   U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')))
$$;

create function private.r12_adaptive_investigation_key(body jsonb,recommendation jsonb) returns text
language sql immutable set search_path='' as $$
 select private.stage14_hash(jsonb_build_object('version','r12.investigation-target.1','kind',body->>'kind',
  'question',private.r12_adaptive_question_key(body->>'question'),
  'hypothesis',private.r12_adaptive_question_key(body->>'hypothesis'),
  'informationGain',private.r12_adaptive_question_key(body->>'expectedInformationGain'),
  'countercheck',private.r12_adaptive_question_key(body->>'counterevidenceQuestion'),
  'gap',recommendation->>'gap','reason',private.r12_adaptive_question_key(recommendation->>'reason')))
$$;

-- No model boolean establishes progress. The accepted independent review must
-- link a changed finding to an exact saved baseline and real qualified spans.
-- SQL verifies textual novelty; semantic significance still requires the
-- independent reviewer and held-out semantic qualification.
create function private.r12_adaptive_review_progress(d jsonb,snapshot jsonb,action_kind text) returns boolean
language plpgsql set search_path='' as $$
declare review jsonb:=d->'response'->'result'->'review';progress jsonb;raw jsonb;input jsonb;context jsonb;
 baseline jsonb;ref jsonb;span jsonb;identity text;identities text[]:=array[]::text[];
 prior_identities text[]:=array[]::text[];item jsonb;evidence jsonb;new_evidence boolean:=false;
 expected_hash text;identity_json text;
begin
 if action_kind='repair' then return false;end if;
 progress:=review->'progress';raw:=review->'rawResponse'->'progress';
 if jsonb_typeof(progress) is distinct from 'object' or jsonb_typeof(raw) is distinct from 'object'
  or not coalesce(progress->>'kind' in ('resolved','narrowed','refuted'),false)
  or progress->>'kind' is distinct from raw->>'kind'
  or progress->>'questionId' is distinct from raw->>'questionId'
  or progress->>'beforeFindingHash' is distinct from raw->>'priorFindingHash'
  or progress->>'afterFindingHash' is not distinct from progress->>'beforeFindingHash'
  or jsonb_typeof(progress->'supportingRefs') is distinct from 'array'
  or jsonb_array_length(progress->'supportingRefs')=0
  or progress->'supportingRefs' is distinct from raw->'evidenceRefs'
  or length(btrim(coalesce(raw->>'opposingInterpretation','')))<20
 then return false;end if;
 input:=(d->'binding'->'request'->'messages'->1->>'content')::jsonb;context:=input->'reviewContext';
 select value into baseline from jsonb_array_elements(coalesce(context->'priorFindings','[]'))
  where value->>'questionId'=progress->>'questionId' and value->>'findingHash'=progress->>'beforeFindingHash';
 if baseline is null or not coalesce(snapshot->'priorFindings' @> jsonb_build_array(baseline),false)
  or private.r12_adaptive_question_key(baseline->>'statement')=private.r12_adaptive_question_key(raw->>'finding')
 then return false;end if;
 -- Seen evidence includes the complete original archive, not just previous
 -- citations or the active subset. Re-fetching an uncited old quote is not new.
 for item in select value from jsonb_array_elements(snapshot->'archive') loop
  if item->'selector'->'origin'->>'actionHash' is distinct from d->'origin'->>'actionHash' then
   for evidence in select value from jsonb_array_elements(item->'persisted'->'evidencePack'->'evidence') loop
    prior_identities:=array_append(prior_identities,private.r12_adaptive_quote_identity(evidence->>'quote'));
   end loop;
  end if;
 end loop;
 for ref in select value from jsonb_array_elements(progress->'supportingRefs') loop
  select value into span from jsonb_array_elements(coalesce(input->'evidence','[]')) where value->>'key'=ref#>>'{}';
  if span is null then return false;end if;
  identity:=private.r12_adaptive_quote_identity(span->>'quote');
  if context->'evidenceIdentityHashes'->>(ref#>>'{}') is distinct from identity
   or not exists(select 1 from jsonb_array_elements(snapshot->'archive') ar
    cross join lateral jsonb_array_elements(ar->'persisted'->'evidencePack'->'evidence') ev
    where snapshot->'intentPins'->'activeEvidenceArtifactIds' ? (ar->'persisted'->>'artifactId')
     and ev->>'quote'=span->>'quote') then return false;end if;
  identities:=array_append(identities,identity);
  if not identity=any(prior_identities) and not coalesce(baseline->'evidenceIdentityHashes' ? identity,false) then new_evidence:=true;end if;
 end loop;
 -- Core's existing finding digest uses ordered JSON, not sorted-object hashing.
 select string_agg(to_jsonb(x)::text,',' order by x collate "C") into identity_json from unnest(identities)x;
 expected_hash:=encode(extensions.digest(convert_to('{"finding":'||to_jsonb(raw->>'finding')::text||
  ',"evidenceIdentityHashes":['||identity_json||']}', 'UTF8'),'sha256'),'hex');
 if progress->>'afterFindingHash' is distinct from expected_hash then return false;end if;
 return new_evidence or (action_kind='reasoning_review' and context->'allowReasoningProgress'='true'::jsonb
  and progress->'reasoningOnly'='true'::jsonb);
end $$;

create function private.r12_adaptive_stagnation_state(p_scope uuid) returns jsonb
language plpgsql set search_path='' as $$
declare activation private.r12_adaptive_activations;row record;dep jsonb;snapshot jsonb;
 streak integer:=0;episode_start integer:=0;reasoning_used boolean:=false;last_hash text;
 targets jsonb:='[]';recommended jsonb;
begin
 select * into strict activation from private.r12_adaptive_activations where scope_id=p_scope;
 for row in select a.*,c.state,c.review_hash from private.r12_adaptive_actions a
  left join private.r12_adaptive_action_closures c on c.scope_id=a.scope_id and c.action_ordinal=a.ordinal
   and c.action_hash=a.content_hash where a.scope_id=p_scope order by a.ordinal loop
  -- Count an admitted reasoning action even if its response failed. Repairs and
  -- failures cannot open a fresh opportunity to poll the same reviewer again.
  if row.kind='reasoning_review' then reasoning_used:=true;end if;
  select r.content->'result'->'review'->'recommendedNextAction' into recommended
   from private.r07_responses r join private.r07_attempts t on t.id=r.attempt_id
   where t.plan_id=activation.plan_id and r.content_hash=row.previous_review_hash and t.step_key='review';
  targets:=targets||jsonb_build_array(private.r12_adaptive_investigation_key(row.content,recommended));
  if row.state='completed' then
   select private.r12_adaptive_input_dependency(t.id),s.content into dep,snapshot
    from private.r07_attempts t join private.r07_responses r on r.attempt_id=t.id
    join private.r12_adaptive_input_snapshots s on s.attempt_id=t.id
    where t.plan_id=activation.plan_id and t.adaptive_action_hash=row.content_hash
     and t.adaptive_action_ordinal=row.ordinal and t.step_key='review'
     and t.status='completed' and r.content_hash=row.review_hash;
   if dep is null or snapshot is null then raise exception 'r12_adaptive_stagnation_review_unverified';end if;
   last_hash:=row.review_hash;
   if private.r12_adaptive_review_progress(dep,snapshot,row.kind) then
    streak:=0;episode_start:=row.ordinal+1;reasoning_used:=false;targets:='[]';
   else streak:=streak+1;end if;
  end if;
 end loop;
 return jsonb_build_object('version','r12.adaptive-stagnation.1','scopeId',p_scope,
  'consecutiveNonprogress',streak,'episodeStartOrdinal',episode_start,
  'reasoningReviewUsed',reasoning_used,'latestReviewHash',last_hash,'episodeTargets',targets,
  'goalCompleted',false,'authorityCreated',false);
end $$;

-- Pure policy decision. Trusted callers additionally validate recommendation
-- receipt identity, scope, topology, counters and funding in existing guards.
create function private.r12_adaptive_stagnation_decision(state jsonb,body jsonb,recommendation jsonb,
 diagnostic boolean) returns jsonb language plpgsql immutable set search_path='' as $$
declare reason text;kind text:=body->>'kind';begin
 if kind='repair' or (body->>'ordinal')::integer=0 then reason:=null;
 elsif kind='reasoning_review' and state->'reasoningReviewUsed'='true'::jsonb then reason:='stagnation_reasoning_review_already_used';
 elsif (state->>'consecutiveNonprogress')::integer<2 then reason:=null;
 elsif diagnostic and kind='reasoning_review' then reason:=null;
 elsif kind='reasoning_review' and recommendation->>'gap'='reasoning' then reason:=null;
 elsif kind in ('followup','pivot') and recommendation->>'gap'=(case kind when 'followup' then 'evidence' else 'hypothesis' end)
  and recommendation->>'publicQuestion'=body->>'question'
  and recommendation->>'counterevidenceQuestion'=body->>'counterevidenceQuestion'
  and recommendation->>'expectedInformationGain'=body->>'expectedInformationGain'
  and length(btrim(recommendation->>'reason'))>=30
  and length(btrim(body->>'counterevidenceQuestion'))>=20
  and length(btrim(body->>'expectedInformationGain'))>=20
  and not coalesce(state->'episodeTargets' ? private.r12_adaptive_investigation_key(body,recommendation),false)
 then reason:=null;
 else reason:='stagnation_requires_targeted_diagnosis_or_pivot';end if;
 return jsonb_build_object('allowed',reason is null,'reason',reason,'stagnation',state,'goalCompleted',false,'authorityCreated',false);
end $$;

create function private.r12_adaptive_stagnation_gate(p_scope uuid,body jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare state jsonb;prior private.r12_adaptive_actions;review jsonb;recommendation jsonb;diagnostic boolean:=false;
begin
 state:=private.r12_adaptive_stagnation_state(p_scope);
 select * into prior from private.r12_adaptive_actions where scope_id=p_scope order by ordinal desc limit 1;
 if prior.scope_id is not null then
  select r.content->'result'->'review' into review from private.r12_adaptive_action_closures c
   join private.r12_adaptive_activations a on a.scope_id=c.scope_id
   join private.r07_attempts t on t.plan_id=a.plan_id and t.adaptive_action_ordinal=c.action_ordinal and t.step_key='review'
   join private.r07_responses r on r.attempt_id=t.id and r.content_hash=c.review_hash
   where c.scope_id=p_scope and c.action_ordinal=prior.ordinal and c.state='completed';
  recommendation:=review->'recommendedNextAction';
  diagnostic:=body->>'kind'='reasoning_review' and private.r12_adaptive_missing_gap(p_scope,review) is not null;
 end if;
 return private.r12_adaptive_stagnation_decision(state,body,recommendation,diagnostic);
end $$;

do $$ declare f regprocedure;begin
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='private' and p.proname in ('r12_adaptive_question_key','r12_adaptive_quote_identity','r12_adaptive_investigation_key',
  'r12_adaptive_review_progress','r12_adaptive_stagnation_state','r12_adaptive_stagnation_decision','r12_adaptive_stagnation_gate') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
 end loop;
end $$;

-- The scheduled attempt's first input read freezes its request-time finance,
-- evidence and knowledge before any R05 reserve changes held exposure.
do $adaptive_inputs_patch$ declare d text;begin
 d:=pg_get_functiondef('private.r12_discovery_phase_inputs(private.r07_attempts,private.r07_plans)'::regprocedure);
 if position($old$if p.content->>'format'='r12.discovery-pilot.1' then$old$ in d)=0
 then raise exception 'r12_adaptive_phase_inputs_changed';end if;
 d:=replace(d,$old$if p.content->>'format'='r12.discovery-pilot.1' then$old$,
  $new$if p.content->>'format'='r12.discovery-adaptive.1' then
 return private.r12_adaptive_phase_inputs(a,p);end if;
 if p.content->>'format'='r12.discovery-pilot.1' then$new$);
 execute d;
end $adaptive_inputs_patch$;

create function private.r12_adaptive_planner_input(s private.r12_adaptive_setups,q jsonb,lock_installation boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p private.r12_owner_profiles;g private.r12_owner_bootstrap_grants;
 rt private.r12_owner_grant_roots;binding private.r12_owner_funding_bindings;
 goal private.r04_goal_versions;br private.r04_business_versions;cap private.r05_cap_versions;
 installed public.installed_packs;scope jsonb;action jsonb;intent_pins jsonb;finance jsonb;
 closure jsonb;imports jsonb;funding jsonb;revision jsonb;body jsonb;predecessor_context jsonb;owner_context jsonb;
 exp bigint;unknown boolean;action_maximum bigint;begin
 if s.id is null or s.setup_hash is distinct from private.stage14_hash(private.r12_adaptive_setup_packet(
  s.selection,s.grant_id,s.approval_hash,s.quote,s.preview,s.submission_id,s.owner_observation_ref))
 then raise exception 'r12_adaptive_exact_setup_required';end if;
 perform private.r12_adaptive_quote_check(q,s.quote);
 if q->>'quoteHash' is distinct from s.quote->>'quoteHash'
 then raise exception 'r12_adaptive_exact_quote_required';end if;
 select * into g from private.r12_owner_bootstrap_grants where id=s.grant_id;
 select * into rt from private.r12_owner_grant_roots where id=g.root_id;
 select * into p from private.r12_owner_profiles where id=s.profile_id;
 select * into binding from private.r12_owner_funding_bindings where id=s.binding_id;
 select v.* into goal from private.r04_goal_versions v join private.r04_goal_state st using(business_id,goal_id,revision)
  where v.business_id=s.business_id and v.goal_id=s.goal_id;
 select v.* into br from private.r04_business_versions v join private.r04_business_state st using(business_id,revision)
  where v.business_id=s.business_id;
 perform private.r12_adaptive_profile_check(p,clock_timestamp());perform private.r12_owner_pins_check(p);
 revision:=private.r12_adaptive_grant_check(g,p,goal,rt,clock_timestamp());
 if g.owner_id is distinct from s.owner_id or binding.id is null or br.content_hash is distinct from g.business_hash
 or s.cutoff<=clock_timestamp()
 or exists(select 1 from private.r05_revocations where policy_id=s.policy_id)
 then raise exception 'r12_adaptive_preflight_stale';end if;
 if lock_installation then
  select * into installed from public.installed_packs where id=s.installation_id and business_id=s.business_id for update;
 else
  select * into installed from public.installed_packs where id=s.installation_id and business_id=s.business_id;
 end if;
 if installed.id is null or installed.status<>'active' or installed.snapshot is distinct from p.pins->'snapshot'
 or private.r04_hash(installed.snapshot) is distinct from p.pins->>'snapshotHash'
 then raise exception 'r12_adaptive_installation_changed';end if;
 closure:=private.r12_owner_episode_predecessor(s.business_id,s.goal_id);
 imports:=private.r12_adaptive_imports((closure->>'predecessorPlanId')::uuid,true);
 if closure is distinct from s.preview->'predecessor' or imports is distinct from s.preview->'imports'
 then raise exception 'r12_adaptive_predecessor_changed';end if;
 select * into cap from private.r05_cap_versions where business_id=s.business_id and currency='USD' order by revision desc limit 1;
 select coalesce(sum(e.held),0),coalesce(bool_or(e.unknown),false) into exp,unknown
  from private.r05_exposure(s.business_id)e where e.currency='USD';
 funding:=private.r12_owner_funding(binding);
 if unknown or funding->'hasUnknown' is distinct from 'false'::jsonb
 or (funding->>'pendingMicrounits')::bigint<>0
 or exp::text is distinct from s.preview->'business'->>'committedMicrounits'
 or coalesce(cap.revision,0) is distinct from (s.preview->'business'->>'capRevision')::integer
 or funding->>'committedMicrounits' is distinct from s.preview->'funding'->>'committedMicrounits'
 then raise exception 'r12_adaptive_finance_changed';end if;
 scope:=private.r12_adaptive_proposed_scope(s);action:=private.r12_adaptive_initial_action(scope);
 predecessor_context:=private.r12_adaptive_predecessor_context(s);
 owner_context:=private.r12_owner_observation_context(s.owner_observation_ref,s.business_id,s.owner_id,
  (scope->'intent'->>'id')::uuid,s.scope_id,private.stage14_hash(scope),s.approval_hash);
 action_maximum:=(q->'ceilings'->>'plan')::bigint+(q->'ceilings'->>'search')::bigint
  +(q->'ceilings'->>'select')::bigint+(q->'ceilings'->>'strategy')::bigint+(q->'ceilings'->>'review')::bigint;
 finance:=jsonb_build_object('authorityRootId',binding.authority_root_id,
  'ledgerSnapshotHash',private.stage14_hash(jsonb_build_object('business',s.preview->'business',
   'funding',s.preview->'funding','rootRevision',revision,'closure',closure,'exposureMicrousd',exp::text)),
  'runMaximumMicrousd',(s.preview->>'maximumRunMicrounits')::bigint,'runCommittedMicrousd',0,
  'rootMaximumMicrousd',(s.preview->'funding'->>'proposedLimitMicrounits')::bigint,
  'rootCommittedMicrousd',(funding->>'committedMicrounits')::bigint,
  'actionMaximumMicrousd',action_maximum,'actionCommittedMicrousd',0);
 intent_pins:=jsonb_build_object('scopeVersion','r12.discovery-owner-adaptive.1',
  'scopeId',s.scope_id,'scopeHash',private.stage14_hash(scope),'actionHash',private.stage14_hash(action),
  'actionOrdinal',0,'approvedQuery',scope->>'approvedQuery','finance',finance,
  'evidenceManifest',predecessor_context->'evidenceManifest',
  'activeEvidenceArtifactIds','[]'::jsonb,
  'materialHistory',predecessor_context->'materialHistory','ownerObservationRef',s.owner_observation_ref);
 body:=jsonb_build_object('version','r12.owner-adaptive-planner-preflight-input.1',
  'setupId',s.id,'setupHash',s.setup_hash,'scopeId',s.scope_id,'cutoff',s.preview->>'expiresAt',
  'intent',scope->'intent','intentPins',intent_pins,'knowledgeSnapshot',installed.snapshot,
  'ownerObservationContext',owner_context,
  'quoteHash',q->>'quoteHash','fingerprint',jsonb_build_object('setup',to_jsonb(s),
   'profile',to_jsonb(p),'grant',to_jsonb(g),'rootRevision',revision,'goal',to_jsonb(goal),
   'business',to_jsonb(br),'cap',to_jsonb(cap),'funding',funding,'closure',closure,'imports',imports,
   'scope',scope,'action',action,'installation',to_jsonb(installed),'quote',s.quote));
 return (body-'fingerprint')||jsonb_build_object('inputHash',private.stage14_hash(body));
end $$;

create function public.r12_owner_adaptive_preflight(p_business_id uuid,p_setup_id uuid,p_setup_hash text,p_quote jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.r12_adaptive_setups;begin
 if auth.uid() is null or private.is_business_owner(p_business_id) is distinct from true
 then raise exception 'r12_adaptive_owner_required' using errcode='42501';end if;
 select * into s from private.r12_adaptive_setups where id=p_setup_id and business_id=p_business_id
  and owner_id=auth.uid() and setup_hash=p_setup_hash;
 if s.id is null then raise exception 'r12_adaptive_exact_setup_required';end if;
 return private.r12_adaptive_planner_input(s,p_quote,false);
end $$;

create function private.r12_owner_adaptive_confirm(p_business_id uuid,p_payload jsonb,p_server_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare setup private.r12_adaptive_setups;g private.r12_owner_bootstrap_grants;
 rt private.r12_owner_grant_roots;binding private.r12_owner_funding_bindings;
 profile private.r12_owner_profiles;goal private.r04_goal_versions;
 head private.r07_heads;new_plan private.r07_plans;policy private.r05_policies;
 scope jsonb;closure jsonb;preview jsonb;preflight_input jsonb;receipt jsonb;
 amendment_hash text;plan jsonb;steps jsonb:='[]'::jsonb;phase_ceilings jsonb;
 activation_body jsonb;funding jsonb;revision_body jsonb;approval jsonb;
 phase text;canonical_phase text;step jsonb;operation jsonb;child_scope jsonb;
 plan_id uuid:=gen_random_uuid();submission uuid;ordinal integer:=0;max_run bigint;
 stamp timestamptz:=date_trunc('milliseconds',clock_timestamp());receipt_until timestamptz;begin
 perform private.r05_owner(p_business_id);perform private.r04_safe(p_payload);
 perform private.r04_keys(p_payload,array['businessId','setupId','setupHash','submissionId','quote',
  'preflight','controllerKeyHash','admissionKeyHash']);
 if p_payload->>'businessId' is distinct from p_business_id::text
 then raise exception 'r12_adaptive_business_mismatch';end if;
 submission:=(p_payload->>'submissionId')::uuid;
 select * into setup from private.r12_adaptive_setups where id=(p_payload->>'setupId')::uuid
  and business_id=p_business_id and owner_id=auth.uid() and setup_hash=p_payload->>'setupHash';
 if setup.id is null then raise exception 'r12_adaptive_exact_setup_required';end if;
 if exists(select 1 from private.r12_adaptive_activations where setup_id=setup.id)
 then return private.r12_adaptive_setup_receipt(setup);end if;
 if exists(select 1 from private.r05_revocations where policy_id=setup.policy_id)
 then raise exception 'r12_adaptive_setup_stopped';end if;
 select * into g from private.r12_owner_bootstrap_grants where id=setup.grant_id;
 if g.id is null or g.owner_id is distinct from auth.uid() or length(coalesce(p_server_key,''))<32
 or g.server_key_hash is distinct from encode(extensions.digest(convert_to(p_server_key,'UTF8'),'sha256'),'hex')
 then raise exception 'r12_adaptive_bootstrap_capability_required' using errcode='42501';end if;
 select * into rt from private.r12_owner_grant_roots where id=g.root_id and business_id=p_business_id for update;
 select * into binding from private.r12_owner_funding_bindings where id=setup.binding_id and business_id=p_business_id;
 if rt.id is null or binding.id is null or rt.binding_id is distinct from binding.id
 then raise exception 'r12_adaptive_funding_root_required';end if;
 if binding.kind='legacy_research_root' then
  perform 1 from public.product_experiments where id=binding.authority_root_id and business_id=p_business_id for update;
  if not found then raise exception 'r12_adaptive_original_root_required';end if;
 end if;
 select * into head from private.r07_heads where business_id=p_business_id and goal_id=setup.goal_id for update;
 select v.* into goal from private.r04_goal_versions v join private.r04_goal_state st using(business_id,goal_id,revision)
  where v.business_id=p_business_id and v.goal_id=setup.goal_id;
 select * into profile from private.r12_owner_profiles where id=setup.profile_id;
 perform private.r12_adaptive_profile_check(profile,stamp);perform private.r12_owner_pins_check(profile);
 perform private.r12_adaptive_grant_check(g,profile,goal,rt,stamp);
 closure:=private.r12_owner_episode_predecessor(p_business_id,setup.goal_id);
 preview:=setup.preview;
 if closure is distinct from preview->'predecessor'
 or head.plan_id is distinct from (closure->>'predecessorPlanId')::uuid
 or head.revision is distinct from (closure->>'headRevision')::bigint
 or preview->'imports' is distinct from private.r12_adaptive_imports(head.plan_id,true)
 or setup.cutoff<=stamp
 then raise exception 'r12_adaptive_review_stale';end if;
 preflight_input:=private.r12_adaptive_planner_input(setup,p_payload->'quote',true);
 receipt:=p_payload->'preflight';
 perform private.r04_keys(receipt,array['version','inputHash','quoteHash','bindingHash','actionHash',
  'knowledgeHash','requestHash','wireHash','requestBytes','wireBytes']);
 if receipt->>'version' is distinct from 'r12.owner-adaptive-planner-preflight.1'
 or receipt->>'inputHash' is distinct from preflight_input->>'inputHash'
 or receipt->>'quoteHash' is distinct from setup.quote->>'quoteHash'
 or receipt->>'actionHash' is distinct from preflight_input->'intentPins'->>'actionHash'
 or receipt->>'bindingHash' !~ '^[a-f0-9]{64}$'
 or receipt->>'knowledgeHash' !~ '^[a-f0-9]{64}$'
 or receipt->>'requestHash' !~ '^[a-f0-9]{64}$'
 or receipt->>'wireHash' !~ '^[a-f0-9]{64}$'
 or jsonb_typeof(receipt->'requestBytes') is distinct from 'number'
 or jsonb_typeof(receipt->'wireBytes') is distinct from 'number'
 or receipt->>'requestBytes' !~ '^[1-9][0-9]{0,4}$'
 or receipt->>'wireBytes' !~ '^[1-9][0-9]{0,4}$'
 or (receipt->>'requestBytes')::integer>(setup.quote->'requestBytes'->>'plan')::integer
 or (receipt->>'wireBytes')::integer>(setup.quote->'requestBytes'->>'plan')::integer
 then raise exception 'r12_adaptive_planner_preflight_required';end if;
 if p_payload->>'controllerKeyHash' !~ '^[a-f0-9]{64}$'
 or p_payload->>'admissionKeyHash' !~ '^[a-f0-9]{64}$'
 or p_payload->>'controllerKeyHash'=p_payload->>'admissionKeyHash'
 or exists(select 1 from private.r07_server_keys where key_hash in(p_payload->>'controllerKeyHash',p_payload->>'admissionKeyHash'))
 or exists(select 1 from private.r05_server_keys where key_hash in(p_payload->>'controllerKeyHash',p_payload->>'admissionKeyHash'))
 then raise exception 'r12_adaptive_fresh_separate_keys_required';end if;
 scope:=private.r12_adaptive_proposed_scope(setup);
 max_run:=(preview->>'maximumRunMicrounits')::bigint;
 select * into policy from private.r05_policies where id=setup.policy_id;
 if policy.id is null or policy.content_hash is distinct from setup.policy_hash
 or policy.actor_id is distinct from auth.uid()
 then raise exception 'r12_adaptive_policy_changed';end if;
 perform public.r05_policy_owner(p_business_id,'confirm',
  jsonb_build_object('policyId',setup.policy_id,'policyHash',setup.policy_hash),submission);
 funding:=private.r12_owner_funding(binding);
 if binding.kind='legacy_research_root'
 and (preview->'funding'->>'proposedLimitMicrounits')::bigint>(funding->>'maximumMicrounits')::bigint then
  revision_body:=jsonb_build_object('bindingId',binding.id,'revision',(funding->>'revision')::integer+1,
   'previousHash',funding->>'hash','previousMaximumMicrounits',funding->>'maximumMicrounits',
   'maximumMicrounits',preview->'funding'->>'proposedLimitMicrounits',
   'committedMicrounits',funding->>'committedMicrounits','policyId',setup.policy_id,'ownerId',auth.uid());
  insert into private.r12_owner_funding_revisions(binding_id,revision,previous_hash,previous_maximum_microunits,
   maximum_microunits,committed_microunits,policy_id,owner_id,content_hash)
  values(binding.id,(funding->>'revision')::integer+1,funding->>'hash',(funding->>'maximumMicrounits')::bigint,
   (preview->'funding'->>'proposedLimitMicrounits')::bigint,(funding->>'committedMicrounits')::bigint,
   setup.policy_id,auth.uid(),private.stage14_hash(revision_body));
 end if;
 funding:=private.r12_owner_funding(binding);
 approval:=scope->'fundingApproval';
 if approval is distinct from jsonb_build_object('revision',(funding->>'revision')::integer,
  'hash',funding->>'hash','maximumMicrounits',funding->>'maximumMicrounits')
 then raise exception 'r12_adaptive_funding_approval_changed';end if;
 amendment_hash:=private.stage14_hash(scope);
 insert into private.r12_discovery_scopes(id,business_id,goal_id,budget_authority_root_id,prior_round_id,
  amendment,amendment_hash,origin,adaptive_setup_id)
 values(setup.scope_id,p_business_id,setup.goal_id,
  case when binding.kind='legacy_research_root' then binding.authority_root_id else null end,
  (scope->'funding'->>'priorRoundId')::uuid,scope,amendment_hash,'owner_adaptive',setup.id);
 phase_ceilings:=jsonb_build_object('plan',setup.quote->'ceilings'->'plan',
  'search1',setup.quote->'ceilings'->'search','select1',setup.quote->'ceilings'->'select',
  'strategy',setup.quote->'ceilings'->'strategy','review',setup.quote->'ceilings'->'review');
 foreach phase in array array['plan','search1','select1','strategy','review'] loop
  canonical_phase:=case phase when 'search1' then 'search' when 'select1' then 'select' else phase end;
  step:=jsonb_build_object('key',phase,'kind',case when phase='search1' then 'research'
   when phase='review' then 'review' else 'work' end,
   'objective','Complete the reviewed original POD '||phase||' phase',
   'reason','Use only verified dependencies within this bounded adaptive research run',
   'adapter','r12.discovery.'||setup.scope_id::text||'.'||phase,
   'qualificationHash',profile.pins->>'executionReviewHash','installationId',setup.installation_id,
   'packSnapshotHash',profile.pins->>'snapshotHash',
   'workflowDefinitionId',profile.pins->>'workflowDefinitionId',
   'workerDefinitionId',profile.pins->'workers'->phase->>'id','role',phase,
   'operationKey','research.r12.'||setup.scope_id::text||'.'||phase,
   'purpose','Reviewed original POD research: '||phase,
   'dependsOn',to_jsonb((array['plan','search1','select1','strategy','review'])[1:ordinal]),
   'expectedArtifactType','r12.discovery.'||phase,'maximumMicrounits',max_run::text,
   'expiresAt',preview->>'expiresAt','notBefore',setup.created_at,'measurement',null,'maximumRepairs',0);
  steps:=steps||jsonb_build_array(step);ordinal:=ordinal+1;
 end loop;
 plan:=jsonb_build_object('format','r12.discovery-adaptive.1','discoveryScopeId',setup.scope_id,
  'discoveryScopeHash',amendment_hash,'businessId',p_business_id,'goalId',setup.goal_id,
  'goalRevision',scope->'goalRevision','goalHash',scope->>'goalHash',
  'businessRevision',scope->'businessRevision','businessHash',scope->>'businessHash',
  'policyId',setup.policy_id,'policyHash',setup.policy_hash,'authorityRootId',p_business_id,
  'plannerWorkerDefinitionId',profile.pins->>'plannerWorkerDefinitionId','currency','USD',
  'maximumMicrounits',((closure->>'baseKnownMicrounits')::bigint+max_run)::text,
  'deadline',preview->>'expiresAt','expiresAt',preview->>'expiresAt',
  'maximumRepairs',(closure->>'baseRepairs')::integer+(preview->>'maximumActions')::integer,
  'maximumPivots',(closure->>'basePivots')::integer+(preview->>'maximumActions')::integer,
  'maximumChildren',(closure->>'baseChildren')::integer+5,
  'maximumDispatches',(closure->>'baseDispatches')::integer+(preview->>'maximumPaidCalls')::integer,
  'requiredChecks','["review"]'::jsonb,'finishCondition','all_required_outputs_verified',
  'stopConditions','["no_permitted_work","deadline","repair_exhausted","owner_stopped"]'::jsonb,
  'steps',steps);
 receipt_until:=(preview->>'expiresAt')::timestamptz+interval '30 minutes';
 insert into private.r05_policy_proofs(policy_id,policy_hash,evidence_hash,valid_until)
  values(setup.policy_id,setup.policy_hash,profile.pins->>'policyInterpretationHash',(preview->>'expiresAt')::timestamptz);
 insert into private.r07_server_keys(key_hash,expires_at)
  values(p_payload->>'controllerKeyHash',receipt_until);
 insert into private.r05_server_keys(key_hash,expires_at)
  values(p_payload->>'admissionKeyHash',receipt_until);
 activation_body:=jsonb_build_object('version','r12.adaptive-activation.1',
  'setupId',setup.id,'scopeId',setup.scope_id,'businessId',p_business_id,'goalId',setup.goal_id,
  'planId',plan_id,'predecessorPlanId',head.plan_id,'grantId',g.id,'grantRootId',rt.id,
  'bindingId',binding.id,'profileId',profile.id,'policyId',setup.policy_id,
  'scopeHash',amendment_hash,'planHash',private.r04_hash(plan),
  'predecessorClosureHash',private.stage14_hash(closure),'quoteHash',setup.quote->>'quoteHash',
  'phaseCeilings',phase_ceilings,'maximumRunMicrousd',max_run,
  'maximumExtraActions',(preview->>'maximumActions')::integer,
  'maximumPaidCalls',(preview->>'maximumPaidCalls')::integer,'expiresAt',preview->>'expiresAt');
 insert into private.r12_adaptive_activations(setup_id,scope_id,business_id,goal_id,owner_id,plan_id,
  predecessor_plan_id,grant_id,grant_root_id,binding_id,profile_id,policy_id,scope_hash,plan_hash,
  predecessor_closure,predecessor_closure_hash,quote_hash,phase_ceilings,maximum_run_microusd,
  maximum_extra_actions,maximum_paid_calls,expires_at,content,content_hash)
 values(setup.id,setup.scope_id,p_business_id,setup.goal_id,auth.uid(),plan_id,head.plan_id,
  g.id,rt.id,binding.id,profile.id,setup.policy_id,amendment_hash,private.r04_hash(plan),
  closure,private.stage14_hash(closure),setup.quote->>'quoteHash',phase_ceilings,max_run,
  (preview->>'maximumActions')::integer,(preview->>'maximumPaidCalls')::integer,
  (preview->>'expiresAt')::timestamptz,activation_body,private.stage14_hash(activation_body));
 insert into private.r12_adaptive_planner_receipts(scope_id,input_hash,input_snapshot,quote_hash,action_hash,binding_hash,
  knowledge_hash,request_hash,wire_hash,request_bytes,wire_bytes,content,content_hash)
 values(setup.scope_id,receipt->>'inputHash',preflight_input,receipt->>'quoteHash',receipt->>'actionHash',
  receipt->>'bindingHash',receipt->>'knowledgeHash',receipt->>'requestHash',receipt->>'wireHash',
  (receipt->>'requestBytes')::integer,(receipt->>'wireBytes')::integer,
  receipt,private.stage14_hash(receipt));
 insert into private.r12_discovery_authorities(scope_id,business_id,goal_id,controller_key_hash,
  admission_key_hash,plan,plan_hash,mode,approval_hash,execution_review_hash,valid_until,receipt_until)
 values(setup.scope_id,p_business_id,setup.goal_id,p_payload->>'controllerKeyHash',
  p_payload->>'admissionKeyHash',plan,private.r04_hash(plan),'qualification',setup.approval_hash,
  profile.pins->>'executionReviewHash',(preview->>'expiresAt')::timestamptz,receipt_until);
 insert into private.r07_plans(id,business_id,goal_id,version,previous_plan_id,policy_id,
  owner_id,content,content_hash,reason,evidence_hash)
 values(plan_id,p_business_id,setup.goal_id,(closure->>'predecessorPlanVersion')::integer+1,
  head.plan_id,setup.policy_id,auth.uid(),plan,private.r04_hash(plan),
  'Owner-confirmed bounded adaptive research',private.stage14_hash(closure));
 foreach phase in array array['plan','search1','select1','strategy','review'] loop
  select value into step from jsonb_array_elements(plan->'steps') v where v->>'key'=phase;
  select value into operation from jsonb_array_elements(policy.payload->'operations') v
   where v->>'operationKey'=step->>'operationKey';
  if operation is null then raise exception 'r12_adaptive_policy_operation_missing';end if;
  child_scope:=jsonb_build_object('step',step,'operation',operation,
   'parentPlanHash',private.r04_hash(plan),'objective',step->>'objective',
   'reason',step->>'reason','maximumMicrounits',step->>'maximumMicrounits',
   'expiresAt',step->>'expiresAt');
  insert into private.r07_children(business_id,goal_id,plan_id,step_key,authority_root_id,
   policy_id,scope) values(p_business_id,setup.goal_id,plan_id,phase,p_business_id,
   setup.policy_id,child_scope);
 end loop;
 update private.r07_heads as current_head set plan_id=(activation_body->>'planId')::uuid,revision=current_head.revision+1,state='ready',
  reason='owner_adaptive_ready',children_created=children_created+5,
  lease_epoch=lease_epoch+1,lease_hash=null,lease_expires_at=null
 where current_head.business_id=p_business_id and current_head.goal_id=setup.goal_id
  and current_head.plan_id=(closure->>'predecessorPlanId')::uuid
  and current_head.revision=(closure->>'headRevision')::bigint
  and current_head.children_created=(closure->>'baseChildren')::integer;
 if not found then raise exception 'r12_adaptive_head_changed';end if;
 insert into private.r07_events(business_id,goal_id,plan_id,operation,payload)
 values(p_business_id,setup.goal_id,plan_id,'owner_adaptive',
  jsonb_build_object('setupId',setup.id,'predecessorPlanId',closure->>'predecessorPlanId',
   'closureHash',private.stage14_hash(closure),'shouldDispatch',false));
 perform private.r12_adaptive_admit_next(setup.scope_id);
 return private.r12_adaptive_setup_receipt(setup);
end $$;

create function public.r12_owner_adaptive_server(p_business_id uuid,p_operation text,p_payload jsonb,p_server_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare setup private.r12_adaptive_setups;submission uuid;begin
 perform private.r05_owner(p_business_id);perform private.r04_safe(p_payload);
 if p_operation='prepare' then return private.r12_owner_adaptive_prepare(p_business_id,p_payload,p_server_key);end if;
 if p_operation not in ('confirm','stop') then raise exception 'r12_adaptive_operation_unavailable';end if;
 if p_operation='confirm' then return private.r12_owner_adaptive_confirm(p_business_id,p_payload,p_server_key);end if;
 perform private.r04_keys(p_payload,array['businessId','setupId','setupHash','submissionId']);
 if p_payload->>'businessId' is distinct from p_business_id::text then raise exception 'r12_adaptive_business_mismatch';end if;
 submission:=(p_payload->>'submissionId')::uuid;
 select * into setup from private.r12_adaptive_setups where id=(p_payload->>'setupId')::uuid
  and business_id=p_business_id and owner_id=auth.uid() and setup_hash=p_payload->>'setupHash';
 if setup.id is null then raise exception 'r12_adaptive_exact_setup_required';end if;
 perform public.r05_policy_owner(p_business_id,'revoke',
  jsonb_build_object('policyId',setup.policy_id,'policyHash',setup.policy_hash),submission);
 return private.r12_adaptive_setup_receipt(setup);
end $$;

revoke all on function private.r12_adaptive_action_phases(text,text),
 private.r12_adaptive_step_key(text),
 private.r12_adaptive_activation_check(private.r12_adaptive_activations),
 private.r12_adaptive_activation_guard(),private.r12_adaptive_call_guard(),private.r12_adaptive_snapshot(uuid),
 private.r12_adaptive_scope_resolve(uuid),private.r12_adaptive_action_check(private.r12_adaptive_activations,jsonb),
 private.r12_adaptive_previous_review(private.r12_adaptive_activations,jsonb),
 private.r12_adaptive_admit_action(uuid,jsonb),
 private.r12_adaptive_grant_check(private.r12_owner_bootstrap_grants,private.r12_owner_profiles,private.r04_goal_versions,private.r12_owner_grant_roots,timestamptz),
 private.r12_adaptive_profile_check(private.r12_owner_profiles,timestamptz),
 private.r12_adaptive_quote_check(jsonb,jsonb),
 private.r12_adaptive_setup_packet(jsonb,uuid,text,jsonb,jsonb,uuid,jsonb),
 private.r12_owner_observation_check(jsonb,uuid,uuid),
 private.r12_owner_observation_context(jsonb,uuid,uuid,uuid,uuid,text,text),
 private.r12_adaptive_attempt_guard(),
 private.r12_adaptive_action_context(uuid),
 private.r12_adaptive_setup_receipt(private.r12_adaptive_setups),
 private.r12_adaptive_imports(uuid,boolean),
 private.r12_adaptive_complete_action(uuid,text,integer),
 private.r12_adaptive_diagnosed_failure(uuid),
 private.r12_adaptive_admit_next(uuid),
 private.r12_adaptive_outstanding_hold(uuid,uuid),
 private.r12_adaptive_outstanding_root_hold(uuid),
 private.r12_adaptive_original_root_hold(uuid,uuid),
 private.r12_adaptive_hold_conversion(private.r05_requests),
 private.r12_owner_adaptive_prepare(uuid,jsonb,text),
 private.r12_adaptive_scope_insert_check(private.r12_discovery_scopes),
 private.r12_adaptive_plan_check(uuid,uuid,jsonb),
 private.r12_adaptive_proposed_scope(private.r12_adaptive_setups),
 private.r12_adaptive_initial_action(jsonb),
 private.r12_adaptive_planner_input(private.r12_adaptive_setups,jsonb,boolean),
 private.r12_owner_adaptive_confirm(uuid,jsonb,text)
 from public,anon,authenticated,service_role;
revoke all on function public.r12_owner_adaptive_read(uuid,uuid,uuid),
 public.r12_adaptive_controller_server(uuid,uuid,text,jsonb,text),
 public.r12_owner_adaptive_server(uuid,text,jsonb,text),
 public.r12_owner_adaptive_preflight(uuid,uuid,text,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.r12_owner_adaptive_read(uuid,uuid,uuid) to authenticated;
grant execute on function public.r12_owner_adaptive_server(uuid,text,jsonb,text) to authenticated;
grant execute on function public.r12_owner_adaptive_preflight(uuid,uuid,text,jsonb) to authenticated;
revoke all on function public.r12_owner_observation_server(uuid,text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.r12_owner_observation_server(uuid,text,jsonb,text) to authenticated;
-- The controller key is separately enrolled at exact owner confirmation. The
-- anonymous RPC role has no ledger access and cannot create this capability.
grant execute on function public.r12_adaptive_controller_server(uuid,uuid,text,jsonb,text) to anon;
commit;
