-- R11 additive diagnostic validation only. Existing outcomes stay readable;
-- no rows, authority, tables, provider calls or R05 functions are changed.
begin;
create or replace function private.r11_research_observation_validate(p private.r11_research_policies,o jsonb) returns void language plpgsql set search_path='' as $$
declare k text;d jsonb;i integer:=0;total integer:=0;begin
 if o is null or o='null'::jsonb then return;end if;
 -- Historical observations retain their exact eleven-field contract. Diagnostics
 -- are an all-or-none extension; no free-form provider labels or route bodies.
 if o ?| array['responseProviderHash','inferenceRouteStatus','inferenceRouteProofHash'] then
 perform private.r04_keys(o,array['modelIdentity','observedModelId','providerIdentity','observedProvider','finishReason','searchRequests','annotationCount','approvedDomainCounts','rejectedDomainCount','malformedAnnotationCount','providerError','responseProviderHash','inferenceRouteStatus','inferenceRouteProofHash']);
 if o->'responseProviderHash'<>'null'::jsonb and (jsonb_typeof(o->'responseProviderHash') is distinct from 'string' or o->>'responseProviderHash' !~ '^[a-f0-9]{64}$') then raise exception 'r11_research_observation_provider_hash';end if;
 if jsonb_typeof(o->'inferenceRouteStatus') is distinct from 'string' or o->>'inferenceRouteStatus' not in ('unrequested','verified','unavailable','invalid') then raise exception 'r11_research_observation_route_status';end if;
 if o->>'inferenceRouteStatus'='verified' then
 if jsonb_typeof(o->'inferenceRouteProofHash') is distinct from 'string' or o->>'inferenceRouteProofHash' !~ '^[a-f0-9]{64}$' then raise exception 'r11_research_observation_route_proof';end if;
 elsif o->'inferenceRouteProofHash' is distinct from 'null'::jsonb then raise exception 'r11_research_observation_route_proof';end if;
 if (o->>'providerIdentity'='missing' and o->'responseProviderHash' is distinct from 'null'::jsonb) or (o->>'providerIdentity'='exact' and o->>'responseProviderHash' is distinct from '3140d22d8cb307e2e7ffbae4a07225e09537ce90c32033582f01d979c0ad8f26') then raise exception 'r11_research_observation_provider_hash';end if;
 else
 perform private.r04_keys(o,array['modelIdentity','observedModelId','providerIdentity','observedProvider','finishReason','searchRequests','annotationCount','approvedDomainCounts','rejectedDomainCount','malformedAnnotationCount','providerError']);
 end if;
 if octet_length(o::text)>8192 then raise exception 'r11_research_observation_invalid';end if;
 if o->>'modelIdentity' not in ('request_alias','canonical','other','missing','invalid') or o->>'providerIdentity' not in ('exact','other','missing','invalid') or o->>'finishReason' not in ('stop','length','content_filter','tool_calls','error','other','missing') then raise exception 'r11_research_observation_invalid';end if;
 foreach k in array array['modelIdentity','providerIdentity','finishReason'] loop if jsonb_typeof(o->k) is distinct from 'string' then raise exception 'r11_research_observation_invalid';end if;end loop;
 if (o->>'modelIdentity'='request_alias' and o->>'observedModelId' is distinct from p.policy->>'modelId') or (o->>'modelIdentity'='canonical' and (p.policy->>'modelId' is distinct from 'openai/gpt-5.6-luna' or o->>'observedModelId' is distinct from 'openai/gpt-5.6-luna-20260709')) or (o->>'modelIdentity' in ('other','missing','invalid') and o->'observedModelId' is distinct from 'null'::jsonb) then raise exception 'r11_research_observation_identity';end if;
 if (o->>'providerIdentity'='exact' and (p.policy->>'providerEndpoint' is distinct from 'azure/us' or o->>'observedProvider' is distinct from 'Azure')) or (o->>'providerIdentity'<>'exact' and o->'observedProvider' is distinct from 'null'::jsonb) then raise exception 'r11_research_observation_identity';end if;
 foreach k in array array['searchRequests','annotationCount','rejectedDomainCount','malformedAnnotationCount'] loop
 if k in ('searchRequests','annotationCount') and o->k='null'::jsonb then continue;end if;
 if jsonb_typeof(o->k) is distinct from 'number' or o->>k !~ '^(0|[1-9][0-9]{0,2}|1000)$' then raise exception 'r11_research_observation_count';end if;
 end loop;
 if jsonb_typeof(o->'approvedDomainCounts') is distinct from 'array' or jsonb_array_length(o->'approvedDomainCounts')<>jsonb_array_length(p.policy->'allowedDomains') then raise exception 'r11_research_observation_domains';end if;
 for d in select value from jsonb_array_elements(o->'approvedDomainCounts') loop
 perform private.r04_keys(d,array['domain','count']);
 if d->'domain' is distinct from p.policy->'allowedDomains'->i or jsonb_typeof(d->'count') is distinct from 'number' or d->>'count' !~ '^(0|[1-9][0-9]{0,2}|1000)$' then raise exception 'r11_research_observation_domains';end if;total:=total+(d->>'count')::integer;i:=i+1;end loop;
 total:=total+(o->>'rejectedDomainCount')::integer+(o->>'malformedAnnotationCount')::integer;
 if total>1000 or (o->'annotationCount'<>'null'::jsonb and total<>(o->>'annotationCount')::integer) then raise exception 'r11_research_observation_count';end if;
 if o->'providerError'<>'null'::jsonb and (jsonb_typeof(o->'providerError') is distinct from 'string' or o->>'providerError' not in ('configuration_required','authentication_required','rate_limited','provider_timeout','provider_unavailable','provider_rejected','malformed_model_output','tool_qualification_failed')) then raise exception 'r11_research_observation_provider_error';end if;
end $$;
-- CREATE OR REPLACE preserves the private validator's existing owner and ACL.
commit;
