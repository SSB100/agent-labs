-- Definition-only reviewed fresh captures for the existing one-time recovery.
-- No history rewrite, new table, API, grant, authority, slot or provider call.
begin;

-- The quoted factual span and every source/scope field remain machine-equal.
-- Context, limitations and access provenance are instead bound as complete
-- before/after observations to an actual independent review record. The derived
-- pair hash binds that record; it does not claim SQL can attest a real retrieval
-- or determine semantic equivalence of free prose. Trusted staging must review
-- the captured sources and the complete pair record before supplying its hash.
create function private.r12_pilot_recovery_refresh_validate(
 s private.r12_discovery_scopes,old_scope private.r12_discovery_scopes,v jsonb
) returns void language plpgsql stable set search_path='' as $$
declare e jsonb:=s.amendment;prior jsonb:=old_scope.amendment;
 cert jsonb:=v->'evidenceRefresh';old_bundle jsonb:=prior->'profile'->'observations';new_bundle jsonb:=e->'profile'->'observations';
 old_observations jsonb:=old_bundle->'observations';new_observations jsonb:=new_bundle->'observations';
 old_refs jsonb:=prior->'profile'->'pinnedLearningPlan'->'evidenceRefs';new_refs jsonb:=e->'profile'->'pinnedLearningPlan'->'evidenceRefs';
 old_observation jsonb;new_observation jsonb;pair jsonb;old_ref jsonb;new_ref jsonb;expected_ref jsonb;
 fact text;fact_hash text;k text;n integer;ref_n integer;pair_index integer;
 reviewed_at timestamptz;retrieved_at timestamptz;
begin
 perform private.r04_keys(cert,array['version','businessId','ownerId','scopeId','goalId','budgetAuthorityRootId','abandonedScopeId','abandonedScopeHash',
 'priorAddendumHash','refreshedAddendumHash','priorObservationsHash','refreshedObservationsHash','priorEvidenceRefsHash','refreshedEvidenceRefsHash',
 'ownerApprovalEvidenceHash','independentReviewHash','reviewedAt','pairs']);
 if v->>'version' is distinct from 'r12.focused-pilot-unsent-recovery-authorization.1'
 or cert->>'version' is distinct from 'r12.focused-pilot-evidence-refresh.1' or octet_length(cert::text)>8192
 or cert->>'businessId' is distinct from s.business_id::text or cert->>'scopeId' is distinct from s.id::text
 or cert->>'goalId' is distinct from s.goal_id::text or cert->>'ownerId' is distinct from v->>'ownerId'
 or cert->>'budgetAuthorityRootId' is distinct from s.budget_authority_root_id::text
 or cert->>'abandonedScopeId' is distinct from old_scope.id::text or cert->>'abandonedScopeHash' is distinct from old_scope.amendment_hash
 or old_scope.id::text is distinct from v->'unsentClosure'->>'scopeId'
 or old_scope.amendment_hash is distinct from v->'unsentClosure'->>'scopeHash'
 or old_scope.business_id<>s.business_id or old_scope.budget_authority_root_id<>s.budget_authority_root_id
 or cert->>'priorAddendumHash' is distinct from private.stage14_hash(old_bundle)
 or cert->>'refreshedAddendumHash' is distinct from private.stage14_hash(new_bundle)
 or cert->>'priorObservationsHash' is distinct from private.stage14_hash(old_observations)
 or cert->>'refreshedObservationsHash' is distinct from private.stage14_hash(new_observations)
 or cert->>'priorEvidenceRefsHash' is distinct from private.stage14_hash(old_refs)
 or cert->>'refreshedEvidenceRefsHash' is distinct from private.stage14_hash(new_refs)
 or new_bundle->'id' is not distinct from old_bundle->'id'
 then raise exception 'r12_refresh_exact_binding_required';end if;
 foreach k in array array['abandonedScopeHash','priorAddendumHash','refreshedAddendumHash','priorObservationsHash','refreshedObservationsHash',
 'priorEvidenceRefsHash','refreshedEvidenceRefsHash','ownerApprovalEvidenceHash','independentReviewHash'] loop
 if jsonb_typeof(cert->k) is distinct from 'string' or cert->>k !~ '^[a-f0-9]{64}$' then raise exception 'r12_refresh_hash_required';end if;end loop;
 if cert->>'ownerApprovalEvidenceHash' is distinct from v->>'ownerApprovalEvidenceHash'
 or cert->>'ownerApprovalEvidenceHash' is distinct from e->>'approvalHash'
 or cert->>'ownerApprovalEvidenceHash' is distinct from new_bundle->>'approvalHash'
 or cert->>'independentReviewHash' is distinct from e->>'independentReviewHash'
 or cert->>'independentReviewHash' is distinct from new_bundle->>'independentReviewHash'
 or cert->>'ownerApprovalEvidenceHash'=cert->>'independentReviewHash'
 or cert->>'ownerApprovalEvidenceHash' in(prior->>'approvalHash',old_bundle->>'approvalHash')
 or cert->>'independentReviewHash' in(prior->>'independentReviewHash',old_bundle->>'independentReviewHash')
 or exists(select 1 from jsonb_array_elements(old_observations||new_observations) o
 where o->>'sourceReviewHash' in(cert->>'ownerApprovalEvidenceHash',cert->>'independentReviewHash'))
 then raise exception 'r12_refresh_fresh_owner_and_independent_review_required';end if;
 if jsonb_typeof(cert->'reviewedAt') is distinct from 'string' then raise exception 'r12_refresh_review_time_required';end if;
 reviewed_at:=(cert->>'reviewedAt')::timestamptz;
 if not isfinite(reviewed_at) or reviewed_at>clock_timestamp() or reviewed_at>(e->>'createdAt')::timestamptz
 or jsonb_typeof(old_observations) is distinct from 'array' or jsonb_typeof(new_observations) is distinct from 'array'
 or jsonb_typeof(cert->'pairs') is distinct from 'array' or jsonb_array_length(old_observations) not between 1 and 8
 or jsonb_array_length(new_observations)<>jsonb_array_length(old_observations)
 or jsonb_array_length(cert->'pairs')<>jsonb_array_length(old_observations)
 or (select count(distinct o->>'id') from jsonb_array_elements(new_observations) o)<>jsonb_array_length(new_observations)
 then raise exception 'r12_refresh_complete_pairs_required';end if;
 for n in 0..jsonb_array_length(old_observations)-1 loop
 old_observation:=old_observations->n;new_observation:=new_observations->n;pair:=cert->'pairs'->n;
 perform private.r04_keys(pair,array['priorObservationId','refreshedObservationId','priorObservationHash','refreshedObservationHash','factSpanHash','pairReviewHash']);
 perform private.r04_keys(new_observation,array['id','sourceId','url','title','access','kind','retrievedAt','expiresAt','captureHash','contentHash','context','start','end','geographyRole','countries','dimensions','limitations','sourceReviewHash']);
 foreach k in array array['priorObservationHash','refreshedObservationHash','factSpanHash','pairReviewHash'] loop
 if jsonb_typeof(pair->k) is distinct from 'string' or pair->>k !~ '^[a-f0-9]{64}$' then raise exception 'r12_refresh_pair_hash_required';end if;end loop;
 if pair->>'priorObservationId' is distinct from old_observation->>'id'
 or pair->>'refreshedObservationId' is distinct from new_observation->>'id'
 or pair->>'priorObservationHash' is distinct from private.stage14_hash(old_observation)
 or pair->>'refreshedObservationHash' is distinct from private.stage14_hash(new_observation)
 or jsonb_typeof(new_observation->'id') is distinct from 'string' or new_observation->>'id' !~ '^evi-[a-f0-9]{24}$'
 or exists(select 1 from jsonb_array_elements(old_observations) o where o->'id'=new_observation->'id')
 -- All unlisted keys, including sourceId, URL, title, source kind, role,
 -- countries, dimensions and exact start/end remain identical.
 or (new_observation-array['id','retrievedAt','expiresAt','captureHash','contentHash','sourceReviewHash','access','context','limitations'])
 is distinct from (old_observation-array['id','retrievedAt','expiresAt','captureHash','contentHash','sourceReviewHash','access','context','limitations'])
 or jsonb_typeof(new_observation->'access') is distinct from 'string'
 or not (new_observation->'access'=old_observation->'access'
 or old_observation->>'access'='public_search_index' and new_observation->>'access'='public_document_read')
 then raise exception 'r12_refresh_same_source_scope_required';end if;
 foreach k in array array['captureHash','contentHash','sourceReviewHash'] loop
 if jsonb_typeof(new_observation->k) is distinct from 'string' or new_observation->>k !~ '^[a-f0-9]{64}$' then raise exception 'r12_refresh_capture_hash_required';end if;end loop;
 if jsonb_typeof(new_observation->'context') is distinct from 'string'
 or new_observation->>'contentHash' is distinct from encode(extensions.digest(convert_to(new_observation->>'context','UTF8'),'sha256'),'hex')
 or exists(select 1 from jsonb_array_elements(old_observations) o where o->'sourceReviewHash'=new_observation->'sourceReviewHash')
 then raise exception 'r12_refresh_new_capture_review_required';end if;
 fact:=substring(old_observation->>'context' from (old_observation->>'start')::integer+1 for (old_observation->>'end')::integer-(old_observation->>'start')::integer);
 fact_hash:=encode(extensions.digest(convert_to(fact,'UTF8'),'sha256'),'hex');
 if fact is null or btrim(fact)='' or fact is distinct from substring(new_observation->>'context' from (new_observation->>'start')::integer+1 for (new_observation->>'end')::integer-(new_observation->>'start')::integer)
 or pair->>'factSpanHash' is distinct from fact_hash
 or pair->>'pairReviewHash' in(old_observation->>'sourceReviewHash',new_observation->>'sourceReviewHash')
 or pair->>'pairReviewHash' is distinct from private.stage14_hash(jsonb_build_object('version','r12.focused-pilot-evidence-pair-review.1',
 'scopeId',cert->'scopeId','priorObservationHash',pair->'priorObservationHash','refreshedObservationHash',pair->'refreshedObservationHash',
 'factSpanHash',pair->'factSpanHash','independentReviewHash',cert->'independentReviewHash','reviewedAt',cert->'reviewedAt'))
 then raise exception 'r12_refresh_reviewed_same_fact_required';end if;
 if jsonb_typeof(new_observation->'retrievedAt') is distinct from 'string' then raise exception 'r12_refresh_new_retrieval_required';end if;
 retrieved_at:=(new_observation->>'retrievedAt')::timestamptz;
 if not isfinite(retrieved_at) or retrieved_at<=(old_observation->>'retrievedAt')::timestamptz or retrieved_at>reviewed_at
 then raise exception 'r12_refresh_new_retrieval_required';end if;
 end loop;
 if jsonb_typeof(old_refs) is distinct from 'array' or jsonb_typeof(new_refs) is distinct from 'array'
 or jsonb_array_length(old_refs) not between 1 and 8 or jsonb_array_length(new_refs)<>jsonb_array_length(old_refs)
 then raise exception 'r12_refresh_same_learning_citations_required';end if;
 for ref_n in 0..jsonb_array_length(old_refs)-1 loop
 old_ref:=old_refs->ref_n;new_ref:=new_refs->ref_n;
 select ordinality::integer-1 into strict pair_index from jsonb_array_elements(cert->'pairs') with ordinality rows(pair_row,ordinality)
 where pair_row->>'priorObservationId'=old_ref->>'evidenceId';
 new_observation:=new_observations->pair_index;
 expected_ref:=old_ref||jsonb_build_object('artifactId',new_bundle->'id','evidenceId',new_observation->'id','sourceContentHash',new_observation->'contentHash');
 if new_ref is distinct from expected_ref then raise exception 'r12_refresh_same_learning_citations_required';end if;
 end loop;
end $$;
revoke all on function private.r12_pilot_recovery_refresh_validate(private.r12_discovery_scopes,private.r12_discovery_scopes,jsonb)
 from public,anon,authenticated,service_role;

-- Optional certificate only on this existing recovery authorization version.
-- No-certificate payloads retain the original exact arrays/ref comparisons.
-- The whole certificate remains within the existing 16KiB authorization bound
-- and existing authorization hash, owner interpretation proof and wire metadata.
do $patch$ declare d text;old text;replacement text;begin
 d:=pg_get_functiondef('private.r12_pilot_unsent_recovery_validate_context(private.r12_discovery_scopes,jsonb)'::regprocedure);
 old:=$o$ perform private.r04_keys(v,array['version','businessId','ownerId','scopeId','scopeHash','goalId','preparedGoalRevision','preparedGoalHash','profileHash','ownerApprovalEvidenceHash','predecessorClosure','unsentClosure','limits','createdAt','expiresAt']);$o$;
 replacement:=$r$ perform private.r04_keys(v,array['version','businessId','ownerId','scopeId','scopeHash','goalId','preparedGoalRevision','preparedGoalHash','profileHash','ownerApprovalEvidenceHash','predecessorClosure','unsentClosure','limits','createdAt','expiresAt']||case when v?'evidenceRefresh' then array['evidenceRefresh'] else array[]::text[] end);$r$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_refresh_authorization_keys_drift';end if;d:=replace(d,old,replacement);
 old:=$o$ or e->'profile'->'observations'->'observations' is distinct from old_scope.amendment->'profile'->'observations'->'observations'$o$;
 replacement:=$r$ or (not (v?'evidenceRefresh') and e->'profile'->'observations'->'observations' is distinct from old_scope.amendment->'profile'->'observations'->'observations')$r$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_refresh_observation_comparison_drift';end if;d:=replace(d,old,replacement);
 old:=$o$ or (select jsonb_agg(ref-'artifactId' order by n) from jsonb_array_elements((e->'profile'->'pinnedLearningPlan')->'evidenceRefs') with ordinality r(ref,n)) is distinct from (select jsonb_agg(ref-'artifactId' order by n) from jsonb_array_elements((old_scope.amendment->'profile'->'pinnedLearningPlan')->'evidenceRefs') with ordinality r(ref,n))$o$;
 replacement:=$r$ or (not (v?'evidenceRefresh') and (select jsonb_agg(ref-'artifactId' order by n) from jsonb_array_elements((e->'profile'->'pinnedLearningPlan')->'evidenceRefs') with ordinality r(ref,n)) is distinct from (select jsonb_agg(ref-'artifactId' order by n) from jsonb_array_elements((old_scope.amendment->'profile'->'pinnedLearningPlan')->'evidenceRefs') with ordinality r(ref,n)))$r$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_refresh_citation_comparison_drift';end if;d:=replace(d,old,replacement);
 old:=' return context;';
 replacement:=' if v?''evidenceRefresh'' then perform private.r12_pilot_recovery_refresh_validate(s,old_scope,v);end if;'||chr(10)||old;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_refresh_validation_boundary_drift';end if;d:=replace(d,old,replacement);
 execute d;
end $patch$;
commit;
