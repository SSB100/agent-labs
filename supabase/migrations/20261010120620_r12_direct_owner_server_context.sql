-- Server-only producers behind existing authenticated owner + scoped bootstrap
-- authority. Reads create no grant, envelope, session, tariff or access approval.
begin;
create function private.r12_direct_initial_quote_context(b uuid,payload jsonb,server_key text) returns jsonb
language plpgsql set search_path='' as $$
declare review private.r12_direct_grant_reviews;grant_row private.r12_owner_bootstrap_grants;route private.r12_direct_browser_routes;
 goal uuid;at timestamptz;until_at timestamptz;op jsonb;q jsonb;quotes jsonb:='{}';name text;body jsonb;begin
 perform private.r05_owner(b);perform private.r04_keys(payload,array['grantId']);
 select goal_id into goal from private.r12_direct_grant_reviews where grant_id=(payload->>'grantId')::uuid;
 review:=private.r12_direct_grant_check(b,goal,(payload->>'grantId')::uuid,server_key);
 select * into strict grant_row from private.r12_owner_bootstrap_grants where id=review.grant_id;
 select * into strict route from private.r12_direct_browser_routes where route_hash=review.route_hash;
 if route.content->'usageBound' is distinct from '{"version":"r12.steel-usage-bound.1","maximumProxyBytes":0,"tariffCoversSessionAndProfileLifecycle":true,"captchaDisabled":true,"extraServicesDisabled":true}'::jsonb then raise exception 'r12_direct_bounded_route_required';end if;
 if route.provider_project_id<>review.provider_project_id
 or private.r05_money(review.setup_operation->'maximumMicrounits')+private.r05_money(review.verification_operation->'maximumMicrounits')>review.maximum_test_microunits then raise exception 'r12_direct_reviewed_bounds_exceeded';end if;
 at:=date_trunc('milliseconds',clock_timestamp());until_at:=least(at+interval '5 minutes',route.valid_until,grant_row.valid_until,review.expires_at);
 foreach name in array array['setupQuote','verificationQuote'] loop
  op:=case when name='setupQuote' then review.setup_operation else review.verification_operation end;
  q:=jsonb_build_object('version','r12.public-browser-quote.1','provider','steel','category','browser','providerProjectId',route.provider_project_id,
   'zeroCostQualificationHash',null,'routeHash',route.route_hash,'priceEvidenceHash',route.content->>'priceEvidenceHash',
   'settlementContractHash',route.settlement_contract_hash,'tariffHash',route.tariff_hash,'qualificationHash',route.qualification_hash,
   'maximumMicrounits',op->>'maximumMicrounits','verifiedAt',private.r12_direct_time(at),'validUntil',private.r12_direct_time(until_at),
   'qualified',true,'retentionDisclosure',route.content->>'retentionDisclosure');
  q:=q||jsonb_build_object('browserQuoteHash',private.stage14_hash(q));perform private.r12_direct_browser_quote_check(q,route,op);
  quotes:=quotes||jsonb_build_object(name,q);
 end loop;
 body:=jsonb_build_object('version','r12.direct-initial-quote-context.1','businessId',b,'goalId',goal,'grantId',review.grant_id,
  'grantReviewHash',review.content_hash,'setupQuote',quotes->'setupQuote','verificationQuote',quotes->'verificationQuote',
  'routeAuthority',jsonb_build_object('routeHash',route.route_hash,'providerProjectId',route.provider_project_id,'qualificationHash',route.qualification_hash,
   'maximumSessionMs',route.maximum_session_ms,'routeEvidenceHash',route.content_hash,'routeQualifiedFrom',private.r12_direct_time(route.valid_from),'routeQualifiedUntil',private.r12_direct_time(route.valid_until),
   'revalidatedAt',private.r12_direct_time(at),'reason','still_valid_private_route_revalidation'));
 return body||jsonb_build_object('contextHash',private.stage14_hash(body));
end $$;
create function private.r12_direct_owner_source_context(b uuid,payload jsonb,server_key text) returns jsonb
language plpgsql set search_path='' as $$
declare e private.r12_direct_test_envelopes;c private.r12_direct_test_confirmations;v private.r12_etsy_steel_verifications;
 access jsonb;body jsonb;begin
 perform private.r05_owner(b);perform private.r04_keys(payload,array['testEnvelopeId','testEnvelopeHash']);
 select * into e from private.r12_direct_test_envelopes where id=(payload->>'testEnvelopeId')::uuid and business_id=b and owner_id=auth.uid() and content_hash=payload->>'testEnvelopeHash';
 select * into c from private.r12_direct_test_confirmations where envelope_id=e.id;
 if e.id is null or c.envelope_id is null then raise exception 'r12_direct_confirmed_test_required';end if;
 perform private.r12_direct_grant_check(b,e.goal_id,c.grant_id,server_key);perform private.r12_direct_test_current(e.id);
 select proof.* into v from private.r12_etsy_steel_verifications proof join private.r12_etsy_steel_candidates candidate using(binding_id)
  join private.r12_etsy_steel_setups setup on setup.operation_id=candidate.operation_id
  where setup.envelope_id=e.id and setup.business_id=b and setup.owner_id=auth.uid() order by setup.sequence desc limit 1;
 if v.binding_id is null then raise exception 'r12_direct_authenticated_account_required';end if;
 perform private.r12_etsy_steel_account_binding_check(v.binding);
 access:=jsonb_build_object('allowedSource','etsy_authenticated_insights','sourcePurpose','etsy_insights_aggregate_research',
  'accountBinding',v.binding,'capturePolicyHash',e.content->'researchPins'->>'capturePolicyHash');
 perform private.r12_direct_account_check(e,access,true);
 body:=jsonb_build_object('version','r12.direct-research-source-context.1','businessId',b,'goalId',e.goal_id,
  'testEnvelopeId',e.id,'testEnvelopeHash',e.content_hash,'sourceAccess',access);
 return body||jsonb_build_object('contextHash',private.stage14_hash(body));
end $$;
do $$ declare src text;anchor text;begin
 src:=pg_get_functiondef('public.r12_owner_direct_server(uuid,text,jsonb,text)'::regprocedure);
 anchor:=$a$if p_operation='research_quote_context' then$a$;
 if strpos(src,anchor)=0 then raise exception 'r12_direct_owner_context_patch_required';end if;
 execute replace(src,anchor,$a$if p_operation='initial_quote_context' then return private.r12_direct_initial_quote_context(p_business_id,p_payload,p_server_key);end if;
 if p_operation='research_source_context' then return private.r12_direct_owner_source_context(p_business_id,p_payload,p_server_key);end if;
 if p_operation='research_quote_context' then$a$);
end $$;
revoke all on function private.r12_direct_initial_quote_context(uuid,jsonb,text),private.r12_direct_owner_source_context(uuid,jsonb,text)
 from public,anon,authenticated,service_role;
commit;
