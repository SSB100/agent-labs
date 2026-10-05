-- Appended after the original Stage15/Stage18 assertions, before their rollback.
-- These remain inert administrative fixtures; no existing assertion or guard is bypassed.
do $$ declare b uuid; run uuid; connection uuid; connection_rev uuid; owner uuid; provider_name text; hash text; sent timestamptz; endpoint text; request jsonb; response jsonb; proof uuid; count_before bigint; begin
 if exists(select 1 from private.printful_product_operations) then
 provider_name:='printful';
 select r.business_id,r.id,r.connection_id,r.connection_revision,r.owner_id,r.request_hash,o.sent_at,'https://api.printful.com/store/products/@'||r.identity into b,run,connection,connection_rev,owner,hash,sent,endpoint from private.printful_product_runs r join private.printful_product_operations o on o.run_id=r.id order by r.id limit 1;
 else
 provider_name:='etsy';
 select r.business_id,r.id,r.connection_id,r.connection_revision,r.owner_id,r.request_hash,o.sent_at,'https://api.etsy.com/v3/application/listings/'||r.listing_id into b,run,connection,connection_rev,owner,hash,sent,endpoint from private.etsy_publication_runs r join private.etsy_publication_operations o on o.publication_run_id=r.id order by r.id limit 1;
 end if;
 if run is null then raise exception 'R05 readback fixture requires a real stored legacy marker'; end if;
 insert into private.r05_server_keys values(encode(extensions.digest(convert_to(repeat('readback-fixture-',4),'UTF8'),'sha256'),'hex'),clock_timestamp()+interval '1 day');
 request:=jsonb_build_object('provider',provider_name,'runId',run,'requestHash',hash,'sentAt',sent,'connectionId',connection,'connectionRevision',connection_rev,'endpoint',endpoint);
 response:=public.r05_admission_server(b,'existing_effect_read',request,repeat('readback-fixture-',4));
 if response->>'reason'<>'readback_eligibility_unavailable' or response->>'shouldRead'<>'false' then raise exception 'Legacy consent cannot manufacture provider eligibility: %',response; end if;
 insert into private.r05_readback_evidence(business_id,provider,run_id,owner_id,request_hash,connection_id,connection_revision,purpose,data_classes,evidence_hash,valid_from,valid_until) values(b,provider_name,run,owner,hash,connection,connection_rev,'existing_effect_readback','["provider_account_metadata","existing_effect_state"]',repeat('b',64),clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 day') returning id into proof;
 -- Original suites deliberately revoke their fixture account. Restore only the disposable
 -- account's original revision after every original assertion, then test the new exact guard.
 if provider_name='printful' then update private.connected_accounts set status='connected',connection_revision=connection_rev,revoked_at=null where id=connection;
 else update private.etsy_connections set status='connected',revision=connection_rev,revoked_at=null where id=connection; end if;
 insert into private.r05_pause_events(business_id,kind,target_id,paused,actor_id) values(b,'business',b,true,owner);
 select count(*) into count_before from private.r05_markers;
 response:=public.r05_admission_server(b,'existing_effect_read',request,repeat('readback-fixture-',4));
 if response->>'shouldRead'<>'true' or response->>'shouldDispatch'<>'false' then raise exception 'Existing effect read permitted after pause with exact evidence: %',response; end if;
 response:=public.r05_admission_server(b,'existing_effect_read',jsonb_set(request,'{endpoint}',to_jsonb(endpoint||'/unrelated')),repeat('readback-fixture-',4));
 if response->>'reason'<>'readback_endpoint_denied' then raise exception 'Readback endpoint must be exact'; end if;
 response:=public.r05_admission_server(b,'existing_effect_read',jsonb_set(request,'{sentAt}',to_jsonb(clock_timestamp()+interval '1 hour')),repeat('readback-fixture-',4));
 if response->>'reason'<>'existing_effect_marker_required' then raise exception 'Readback sent marker must be exact'; end if;
 if provider_name='printful' then update private.connected_accounts set connection_revision=gen_random_uuid() where id=connection;
 else update private.etsy_connections set revision=gen_random_uuid() where id=connection; end if;
 response:=public.r05_admission_server(b,'existing_effect_read',request,repeat('readback-fixture-',4));
 if response->>'reason'<>'readback_account_unavailable' then raise exception 'Readback account must still be current'; end if;
 insert into private.r05_readback_revocations(evidence_id) values(proof);
 response:=public.r05_admission_server(b,'existing_effect_read',request,repeat('readback-fixture-',4));
 if response->>'reason'<>'readback_eligibility_unavailable' then raise exception 'Readback evidence revocation must stop reads'; end if;
 if (select count(*) from private.r05_markers)<>count_before or exists(select 1 from private.r05_settlements) then raise exception 'Readback eligibility must not dispatch or settle'; end if;
end $$;
