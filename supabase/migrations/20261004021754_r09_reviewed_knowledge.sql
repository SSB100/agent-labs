-- R09 reviewed information only. No credentials, reviewers, lessons, live learning or grants are seeded.
-- Platform review/promotion functions intentionally have NO anon/authenticated/service-role grants.
begin;
create table private.r09_proposals (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id),
 proposal_id uuid not null, version integer not null check(version between 1 and 20),
 proposer_id uuid not null references auth.users(id), title text not null, lesson text not null, scope text not null,
 limitations jsonb not null, evidence_hash text not null check(evidence_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp(), unique(id,business_id), unique(business_id,proposal_id,version)
);
create table private.r09_evidence (
 proposal_version_id uuid not null, business_id uuid not null, artifact_id uuid not null,
 artifact_hash text not null check(artifact_hash ~ '^[a-f0-9]{64}$'), snapshot jsonb not null,
 primary key(proposal_version_id,artifact_id),
 foreign key(proposal_version_id,business_id) references private.r09_proposals(id,business_id),
 foreign key(artifact_id,business_id) references public.artifacts(id,business_id)
);
create table private.r09_reviews (
 id uuid primary key default gen_random_uuid(), proposal_version_id uuid not null references private.r09_proposals(id),
 reviewer_id uuid not null references auth.users(id), reviewer_fingerprint text not null check(reviewer_fingerprint ~ '^[a-f0-9]{64}$'),
 verdict text not null check(verdict in ('approved','rejected','needs_evidence')),
 review jsonb not null, review_hash text not null, evidence_hash text not null,
 reviewed_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null,
 unique(id,proposal_version_id)
);
create table private.r09_releases (
 id uuid primary key references public.packs(id), review_id uuid not null unique references private.r09_reviews(id),
 pack_key text not null, version text not null, manifest_hash text not null, content_hash text not null, provenance jsonb not null,
 verified_at timestamptz not null, expires_at timestamptz not null, supersedes_release_id uuid references private.r09_releases(id),
 supersession_reason text not null, created_at timestamptz not null default clock_timestamp(), unique(pack_key,version)
);
create table private.r09_withdrawals (
 release_id uuid primary key references private.r09_releases(id), reason text not null, reviewer_id uuid not null references auth.users(id),
 created_at timestamptz not null default clock_timestamp()
);
create table private.r09_applications (
 id uuid primary key default gen_random_uuid(), sequence bigint generated always as identity,
 business_id uuid not null references public.businesses(id), pack_key text not null,
 release_id uuid references private.r09_releases(id), installation_id uuid references public.installed_packs(id),
 operation text not null check(operation in ('apply','rollback','remove')), reason text not null,
 previous_application_id uuid, actor_id uuid not null references auth.users(id),
 created_at timestamptz not null default clock_timestamp(), unique(id,business_id),
 foreign key(previous_application_id,business_id) references private.r09_applications(id,business_id),
 check((operation='remove' and release_id is null and installation_id is null) or (operation<>'remove' and release_id is not null and installation_id is not null))
);
create table private.r09_plan_pins (
 plan_id uuid primary key, business_id uuid not null, snapshot jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 foreign key(plan_id,business_id) references private.r07_plans(id,business_id)
);
create table private.r09_run_pins (
 workflow_run_id uuid primary key, business_id uuid not null, plan_id uuid not null references private.r09_plan_pins(plan_id), snapshot jsonb not null,
 foreign key(workflow_run_id,business_id) references public.workflow_runs(id,business_id)
);
create table private.r09_task_pins (
 task_contract_id uuid primary key, business_id uuid not null, workflow_run_id uuid not null references private.r09_run_pins(workflow_run_id), snapshot jsonb not null,
 foreign key(task_contract_id,business_id) references public.task_contracts(id,business_id)
);
create table private.r09_submissions (
 business_id uuid not null references public.businesses(id), id uuid not null, request_hash text not null, result jsonb not null,
 primary key(business_id,id)
);
-- Exact, transaction-local admission prevents the old activation RPC (including dependency roots) bypassing apply.
create table private.r09_install_admissions (
 transaction_id bigint not null, business_id uuid not null, pack_id uuid not null, primary key(transaction_id,business_id,pack_id)
);
create index r09_proposals_page on private.r09_proposals(business_id,created_at desc,id desc);
create index r09_evidence_artifact on private.r09_evidence(artifact_id);
create index r09_reviews_version on private.r09_reviews(proposal_version_id,reviewed_at desc,id desc);
create index r09_releases_page on private.r09_releases(created_at desc,id desc);
create index r09_applications_head on private.r09_applications(business_id,pack_key,sequence desc);
create index r09_applications_page on private.r09_applications(business_id,created_at desc,id desc);
create index r09_plan_pins_business on private.r09_plan_pins(business_id,created_at desc,plan_id desc);

create function private.r09_guard() returns trigger language plpgsql set search_path='' as $$ begin
 if current_user in ('anon','authenticated','service_role') then raise exception 'r09_guarded_rpc_required' using errcode='42501'; end if;
 if tg_op<>'INSERT' and not(tg_op='DELETE' and tg_table_name='r09_install_admissions') then raise exception 'r09_immutable_history'; end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
do $$ declare t text; begin
 for t in select tablename from pg_tables where schemaname='private' and tablename like 'r09_%' loop
 execute format('alter table private.%I enable row level security',t);
 execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 execute format('create trigger r09_guard before insert or update or delete on private.%I for each row execute function private.r09_guard()',t);
 end loop;
end $$;
create function private.r09_uuid(v jsonb,nullable boolean default false) returns uuid language plpgsql immutable set search_path='' as $$ begin
 if nullable and v='null'::jsonb then return null; end if;
 if jsonb_typeof(v) is distinct from 'string' or v#>>'{}' !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then raise exception 'r09_invalid_uuid'; end if;
 return (v#>>'{}')::uuid;
end $$;
create function private.r09_text(v jsonb,maximum integer) returns void language plpgsql immutable set search_path='' as $$ begin
 if jsonb_typeof(v) is distinct from 'string' or length(btrim(v#>>'{}')) not between 1 and maximum or regexp_replace(v#>>'{}',E'[\n\r\t]','','g') ~ '[[:cntrl:]]' then raise exception 'r09_invalid_text'; end if;
end $$;
create function private.r09_public_safe(v jsonb) returns void language plpgsql set search_path='' as $$ begin
 perform private.r04_safe(v);
 if v::text ~* '([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|(customer|business|account|shop|store)[ _-]?(id|number)[" :_=]+[a-z0-9]|/businesses/|/accounts/|/customers/|/private/|/storage/v1/)' then raise exception 'r09_private_content_rejected'; end if;
end $$;
create function private.r09_validate_review(p jsonb,approved boolean) returns void language plpgsql set search_path='' as $$
declare k text; s jsonb; verified timestamptz; expiry timestamptz; until_at timestamptz; domains text[]:='{}'; domain text; begin
 perform private.r04_safe(p);
 perform private.r04_keys(p,array['redactionStatus','proofPreserved','generalizable','privateContentRemoved','independentSourcesVerified','content','sources','expiresAt','notes']);
 if p->>'redactionStatus' is null or p->>'redactionStatus' not in ('accepted','rejected') then raise exception 'r09_invalid_redaction'; end if;
 foreach k in array array['proofPreserved','generalizable','privateContentRemoved','independentSourcesVerified'] loop
 if jsonb_typeof(p->k) is distinct from 'boolean' then raise exception 'r09_invalid_review_boolean'; end if;
 end loop;
 perform private.r09_text(p->'notes',2000);
 perform private.r04_keys(p->'content',array['guidance','scope','limitations','conflicts','generalizability']);
 foreach k in array array['guidance','scope','generalizability'] loop perform private.r09_text(p->'content'->k,2000); end loop;
 foreach k in array array['limitations','conflicts'] loop
 perform private.r04_strings(p->'content'->k,12);
 if (select count(*)<>count(distinct value) from jsonb_array_elements(p->'content'->k)) then raise exception 'r09_duplicate_guidance'; end if;
 for s in select value from jsonb_array_elements(p->'content'->k) loop perform private.r09_text(s,1000); end loop;
 end loop;
 if jsonb_array_length(p->'content'->'limitations')=0 then raise exception 'r09_limitations_required'; end if;
 if jsonb_typeof(p->'sources') is distinct from 'array' or jsonb_array_length(p->'sources') not between 1 and 12 then raise exception 'r09_invalid_sources'; end if;
 if jsonb_typeof(p->'expiresAt') is distinct from 'string' or p->>'expiresAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' then raise exception 'r09_invalid_time'; end if;
 until_at:=(p->>'expiresAt')::timestamptz;
 if approved and (until_at<=clock_timestamp() or until_at>clock_timestamp()+interval '90 days') then raise exception 'r09_review_expiry'; end if;
 if (select count(*)<>count(distinct x->>'url') from jsonb_array_elements(p->'sources') x) then raise exception 'r09_duplicate_source'; end if;
 for s in select value from jsonb_array_elements(p->'sources') loop
 perform private.r04_keys(s,array['url','title','verifiedAt','expiresAt','contentHash','stance']);
 perform private.r09_text(s->'title',200); perform private.r09_text(s->'url',1000);
 -- Public provenance is trusted-reviewer attested. Private/intranet, signed, query and credential URLs never enter a release.
 if s->>'url' !~ '^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}(/[A-Za-z0-9._~!$&()*+,;=:@%/-]*)?$' or s->>'url' ~* '(localhost|\.local(/|$)|\.internal(/|$)|\.(invalid|test|example)(/|$)|[?&#]|://[^/]*@|%[0-9a-f]{2}|/[^/]*[a-f0-9]{24,})' then raise exception 'r09_public_source_required'; end if;
 foreach k in array array['verifiedAt','expiresAt'] loop if jsonb_typeof(s->k) is distinct from 'string' or s->>k !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' then raise exception 'r09_invalid_time'; end if; end loop;
 verified:=(s->>'verifiedAt')::timestamptz; expiry:=(s->>'expiresAt')::timestamptz;
 if jsonb_typeof(s->'contentHash') is distinct from 'string' or s->>'contentHash' !~ '^[a-f0-9]{64}$' or s->>'stance' is null or s->>'stance' not in ('supports','contradicts') or expiry<=verified then raise exception 'r09_invalid_source'; end if;
 if approved and (verified>clock_timestamp() or verified<clock_timestamp()-interval '90 days' or expiry<=clock_timestamp() or until_at>expiry) then raise exception 'r09_stale_source'; end if;
 if approved and s->>'stance'='contradicts' then raise exception 'r09_conflicting_source'; end if;
 domain:=split_part(split_part(s->>'url','/',3),':',1); if s->>'stance'='supports' then domains:=array_append(domains,domain); end if;
 end loop;
 if approved then
 if p->>'redactionStatus'<>'accepted' or p->'proofPreserved'<>'true'::jsonb or p->'generalizable'<>'true'::jsonb or p->'privateContentRemoved'<>'true'::jsonb or p->'independentSourcesVerified'<>'true'::jsonb or (select count(distinct d) from unnest(domains) d)<2 then raise exception 'r09_promotion_evidence_missing'; end if;
 perform private.r09_public_safe(p->'content'); perform private.r09_public_safe(p->'sources');
 end if;
end $$;

create function private.r09_review(p_proposal_version_id uuid,p_reviewer_id uuid,p_reviewer_fingerprint text,p_verdict text,p_review jsonb) returns uuid
language plpgsql security definer set search_path='' as $$ declare proposal private.r09_proposals; rid uuid; begin
 select * into proposal from private.r09_proposals where id=p_proposal_version_id for update;
 if proposal.id is null then raise exception 'r09_proposal_missing'; end if;
 if p_reviewer_id is null or p_reviewer_id=proposal.proposer_id or not exists(select 1 from auth.users where id=p_reviewer_id) or p_reviewer_fingerprint is null or p_reviewer_fingerprint !~ '^[a-f0-9]{64}$' then raise exception 'r09_independent_reviewer_required'; end if;
 if p_verdict is null or p_verdict not in ('approved','rejected','needs_evidence') then raise exception 'r09_invalid_verdict'; end if;
 if exists(select 1 from private.r09_reviews where proposal_version_id=proposal.id) then raise exception 'r09_review_already_recorded_create_new_proposal_version'; end if;
 perform private.r09_validate_review(p_review,p_verdict='approved');
 if p_verdict='approved' then
 -- These known private identity strings may not appear even inside an otherwise valid allowlisted field.
 if exists(select 1 from public.businesses b where b.id=proposal.business_id and length(b.name)>3 and position(lower(b.name) in lower((p_review->'content')::text||(p_review->'sources')::text))>0) then raise exception 'r09_private_content_rejected'; end if;
 end if;
 insert into private.r09_reviews(proposal_version_id,reviewer_id,reviewer_fingerprint,verdict,review,review_hash,evidence_hash,expires_at)
 values(proposal.id,p_reviewer_id,p_reviewer_fingerprint,p_verdict,p_review,private.r04_hash(p_review),proposal.evidence_hash,(p_review->>'expiresAt')::timestamptz) returning id into rid;
 return rid;
end $$;
create function private.r09_promote(p_review_id uuid,p_pack_key text,p_version text,p_supersedes_release_id uuid,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare review private.r09_reviews; proposal private.r09_proposals; manifest jsonb; content jsonb; pack uuid; verified timestamptz; begin
 select * into review from private.r09_reviews where id=p_review_id for update;
 if review.id is null or review.verdict<>'approved' then raise exception 'r09_approved_review_required'; end if;
 perform private.r09_validate_review(review.review,true);
 if exists(select 1 from private.r09_releases where review_id=review.id) then raise exception 'r09_review_already_promoted'; end if;
 select * into strict proposal from private.r09_proposals where id=review.proposal_version_id;
 if review.evidence_hash<>proposal.evidence_hash or exists(select 1 from private.r09_evidence e join public.artifacts a on a.id=e.artifact_id where e.proposal_version_id=proposal.id and e.artifact_hash<>private.r04_hash(to_jsonb(a))) then raise exception 'r09_evidence_changed'; end if;
 if p_pack_key is null or p_pack_key !~ '^knowledge\.learned\.[a-z][a-z0-9-]{1,59}$' or p_version is null or p_version !~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' then raise exception 'r09_invalid_release_identity'; end if;
 perform private.r09_text(to_jsonb(p_reason),500); perform private.r09_public_safe(to_jsonb(p_reason));
 if p_supersedes_release_id is null and exists(select 1 from private.r09_releases where pack_key=p_pack_key) then raise exception 'r09_supersession_required'; end if;
 if p_supersedes_release_id is not null and not exists(select 1 from private.r09_releases where id=p_supersedes_release_id and pack_key=p_pack_key and version<>p_version) then raise exception 'r09_invalid_supersession'; end if;
 content:=review.review->'content'; select min((x->>'verifiedAt')::timestamptz) into verified from jsonb_array_elements(review.review->'sources') x;
 manifest:=jsonb_build_object('frameworkVersion','1.0','packKey',p_pack_key,'version',p_version,'kind','knowledge','name','Reviewed reusable guidance','description','Reviewed reusable guidance. Exact expiry and source verification are retained in the R09 release receipt.','ui',jsonb_build_object('category','Reviewed Knowledge','summary',content->>'scope','supportedBusinessTypes','[]'::jsonb),
 'dependencies','[]'::jsonb,'capabilities','[]'::jsonb,'workers','[]'::jsonb,'workflows','[]'::jsonb,'evals','["review","redaction","generalizability","freshness"]'::jsonb,
 'knowledge',jsonb_build_array(jsonb_build_object('key',p_pack_key,'version',p_version,'name','Reviewed reusable guidance','source',review.review->'sources'->0->>'url','verifiedAt',verified,'freshnessDays',greatest(1,ceil(extract(epoch from (review.expires_at-verified))/86400)::integer),'content',content)));
 pack:=private.stage10_register_pack(manifest);
 -- Only fixed sanitized qualification facts are shared; original review/proposal/evidence remains private.
 perform private.stage10_qualify_pack(pack,jsonb_build_object('source','r09.reviewed_information','checks',jsonb_build_object('review','passed','redaction','passed','generalizability','passed','freshness','passed')));
 insert into private.r09_releases(id,review_id,pack_key,version,manifest_hash,content_hash,provenance,verified_at,expires_at,supersedes_release_id,supersession_reason)
 values(pack,review.id,p_pack_key,p_version,private.r04_hash(manifest),private.r04_hash(content),jsonb_build_object('reviewerIdentity','reviewer:'||private.r04_hash(to_jsonb(review.reviewer_id)),'reviewerFingerprint',review.reviewer_fingerprint,'reviewedAt',review.reviewed_at,'sources',review.review->'sources'),verified,review.expires_at,p_supersedes_release_id,p_reason);
 perform private.r09_assert_release(pack);
 return pack;
end $$;
create function private.r09_withdraw(p_release_id uuid,p_reviewer_id uuid,p_reason text) returns void language plpgsql security definer set search_path='' as $$ begin
 perform private.r09_text(to_jsonb(p_reason),500); perform private.r09_public_safe(to_jsonb(p_reason));
 if p_reviewer_id is null or not exists(select 1 from auth.users where id=p_reviewer_id) then raise exception 'r09_reviewer_required'; end if;
 perform 1 from private.r09_releases where id=p_release_id for update; if not found then raise exception 'r09_release_missing'; end if;
 insert into private.r09_withdrawals(release_id,reviewer_id,reason) values(p_release_id,p_reviewer_id,p_reason);
end $$;
create function private.r09_assert_release(rid uuid) returns void language plpgsql set search_path='' as $$ begin
 -- Re-query after any lock wait, then compare wall clock; transaction-start time is insufficient.
 perform 1 from private.r09_releases where id=rid for share;
 if not found or not exists(select 1 from private.r09_releases r join public.packs p on p.id=r.id where r.id=rid and r.expires_at>clock_timestamp() and r.manifest_hash=private.r04_hash(p.manifest) and not exists(select 1 from private.r09_withdrawals w where w.release_id=r.id)) then raise exception 'r09_knowledge_stale_or_withdrawn'; end if;
end $$;
create function private.r09_application_item(a private.r09_applications) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',a.id,'businessId',a.business_id,'packKey',a.pack_key,'releaseId',a.release_id,'version',r.version,'installationId',a.installation_id,'operation',a.operation,'previousApplicationId',a.previous_application_id,'reason',a.reason,
 'isCurrent',not exists(select 1 from private.r09_applications n where n.business_id=a.business_id and n.pack_key=a.pack_key and n.sequence>a.sequence),
 'releaseStatus',case when a.release_id is null then null when exists(select 1 from private.r09_withdrawals w where w.release_id=a.release_id) then 'withdrawn' when r.expires_at<=now() then 'expired' else 'current' end,
 'status',case when exists(select 1 from private.r09_applications n where n.business_id=a.business_id and n.pack_key=a.pack_key and n.sequence>a.sequence) then 'superseded' when a.operation='remove' then 'removed' when exists(select 1 from private.r09_withdrawals w where w.release_id=a.release_id) then 'withdrawn' when r.expires_at<=now() then 'expired' else 'applied' end,'createdAt',a.created_at,'application',(select jsonb_build_object('id',h.id,'releaseId',h.release_id) from private.r09_applications h where h.business_id=a.business_id and h.pack_key=a.pack_key order by h.sequence desc limit 1))
 from (select 1) unused left join private.r09_releases r on r.id=a.release_id
$$;
create function public.r09_knowledge_owner(p_business_id uuid,p_operation text,p_payload jsonb,p_submission_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; request_hash text; saved private.r09_submissions; proposal uuid; version_id uuid:=gen_random_uuid(); v integer; source uuid; artifacts uuid[]:='{}'; evidence jsonb:='[]'; a public.artifacts; app private.r09_applications; head private.r09_applications; target private.r09_applications; release private.r09_releases; expected uuid; install uuid; key text; begin
 if auth.uid() is null or not private.is_business_owner(p_business_id) then raise exception 'r09_owner_required' using errcode='42501'; end if;
 if p_submission_id is null or p_operation is null or p_operation not in ('propose','apply','rollback','remove') then raise exception 'r09_invalid_operation'; end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>20000 then raise exception 'r09_invalid_payload'; end if;
 perform private.r04_safe(p_payload);
 perform 1 from public.businesses where id=p_business_id for update;
 if not private.is_business_owner(p_business_id) then raise exception 'r09_owner_required' using errcode='42501'; end if;
 request_hash:=private.r04_hash(jsonb_build_object('operation',p_operation,'payload',p_payload));
 select * into saved from private.r09_submissions where business_id=p_business_id and id=p_submission_id;
 if found then if saved.request_hash<>request_hash then raise exception 'r09_submission_conflict'; end if; return saved.result||'{"replayed":true}'::jsonb; end if;
 if p_operation='propose' then
 perform private.r04_keys(p_payload,array['proposalId','expectedVersion','title','lesson','scope','limitations','artifactIds']);
 proposal:=private.r09_uuid(p_payload->'proposalId',true);
 if jsonb_typeof(p_payload->'expectedVersion') is distinct from 'number' or p_payload->>'expectedVersion' !~ '^(0|[1-9][0-9]?)$' then raise exception 'r09_invalid_version'; end if;
 v:=(p_payload->>'expectedVersion')::integer;
 if proposal is null then if v<>0 then raise exception 'r09_proposal_compare_and_swap'; end if; proposal:=gen_random_uuid();
 elsif not exists(select 1 from private.r09_proposals where business_id=p_business_id and proposal_id=proposal) or (select max(version) from private.r09_proposals where business_id=p_business_id and proposal_id=proposal)<>v then raise exception 'r09_proposal_compare_and_swap'; end if;
 perform private.r09_text(p_payload->'title',160); perform private.r09_text(p_payload->'lesson',8000); perform private.r09_text(p_payload->'scope',2000); perform private.r04_strings(p_payload->'limitations',12);
 if length(btrim(p_payload->>'title'))<3 or length(btrim(p_payload->>'lesson'))<20 or length(btrim(p_payload->>'scope'))<3 or jsonb_array_length(p_payload->'limitations')=0 or exists(select 1 from jsonb_array_elements_text(p_payload->'limitations') x where length(btrim(x))<3) then raise exception 'r09_invalid_text'; end if;
 if jsonb_typeof(p_payload->'artifactIds') is distinct from 'array' or jsonb_array_length(p_payload->'artifactIds') not between 1 and 12 then raise exception 'r09_evidence_required'; end if;
 for source in select private.r09_uuid(value) from jsonb_array_elements(p_payload->'artifactIds') order by 1 loop
 if source=any(artifacts) then raise exception 'r09_duplicate_evidence'; end if;
 select * into a from public.artifacts where id=source and business_id=p_business_id for share;
 if a.id is null or a.content='{}'::jsonb then raise exception 'r09_evidence_unavailable'; end if;
 artifacts:=array_append(artifacts,source); evidence:=evidence||jsonb_build_array(jsonb_build_object('artifactId',source,'hash',private.r04_hash(to_jsonb(a))));
 end loop;
 insert into private.r09_proposals(id,business_id,proposal_id,version,proposer_id,title,lesson,scope,limitations,evidence_hash)
 values(version_id,p_business_id,proposal,v+1,auth.uid(),p_payload->>'title',p_payload->>'lesson',p_payload->>'scope',p_payload->'limitations',private.r04_hash(evidence));
 insert into private.r09_evidence(proposal_version_id,business_id,artifact_id,artifact_hash,snapshot)
 select version_id,p_business_id,id,private.r04_hash(to_jsonb(x)),to_jsonb(x) from public.artifacts x where id=any(artifacts) and business_id=p_business_id;
 result:=jsonb_build_object('id',version_id,'businessId',p_business_id,'proposalId',proposal,'version',v+1,'status','proposed');
 else
 if p_operation='apply' then
 perform private.r04_keys(p_payload,array['releaseId','expectedApplicationId','reason']);
 select * into release from private.r09_releases where id=private.r09_uuid(p_payload->'releaseId'); key:=release.pack_key;
 elsif p_operation='rollback' then
 perform private.r04_keys(p_payload,array['applicationId','expectedApplicationId','reason']);
 select * into target from private.r09_applications where id=private.r09_uuid(p_payload->'applicationId') and business_id=p_business_id and release_id is not null;
 if target.id is null then raise exception 'r09_application_unavailable'; end if;
 select * into release from private.r09_releases where id=target.release_id; key:=release.pack_key;
 else perform private.r04_keys(p_payload,array['packKey','expectedApplicationId','reason']); perform private.r09_text(p_payload->'packKey',100); key:=p_payload->>'packKey'; end if;
 expected:=private.r09_uuid(p_payload->'expectedApplicationId',true); perform private.r09_text(p_payload->'reason',2000); if length(btrim(p_payload->>'reason'))<10 then raise exception 'r09_invalid_text'; end if;
 if key is null then raise exception 'r09_release_missing'; end if;
 select * into head from private.r09_applications where business_id=p_business_id and pack_key=key order by sequence desc limit 1;
 if head.id is distinct from expected then raise exception 'r09_application_compare_and_swap'; end if;
 if p_operation='remove' then if head.id is null or head.release_id is null then raise exception 'r09_application_unavailable'; end if;
 else
 perform private.r09_assert_release(release.id);
 select id into install from public.installed_packs where business_id=p_business_id and root_pack_id=release.id;
 if install is null then
 insert into private.r09_install_admissions values(txid_current(),p_business_id,release.id);
 insert into public.installed_packs(business_id,root_pack_id,root_pack_key,status,snapshot)
 values(p_business_id,release.id,key,'superseded',jsonb_build_object('rootPackId',release.id,'releases',private.stage10_resolve(release.id))) returning id into install;
 delete from private.r09_install_admissions where transaction_id=txid_current() and business_id=p_business_id and pack_id=release.id;
 end if;
 end if;
 insert into private.r09_applications(business_id,pack_key,release_id,installation_id,operation,reason,previous_application_id,actor_id)
 values(p_business_id,key,release.id,install,p_operation,p_payload->>'reason',head.id,auth.uid()) returning * into app;
 result:=private.r09_application_item(app);
 end if;
 insert into private.r09_submissions values(p_business_id,p_submission_id,request_hash,result);
 if release.id is not null then perform private.r09_assert_release(release.id); end if;
 return result;
end $$;

-- Referencing an artifact freezes the actual DB row; supplied checksums never qualify evidence.
create function private.r09_artifact_guard() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if exists(select 1 from private.r09_evidence where artifact_id=old.id) then raise exception 'r09_immutable_source_evidence'; end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger r09_artifact_guard before update or delete on public.artifacts for each row execute function private.r09_artifact_guard();
create function private.r09_pack_guard() returns trigger language plpgsql security definer set search_path='' as $$ declare pid uuid; begin
 if tg_table_name='packs' then pid:=old.id; elsif tg_op='INSERT' then pid:=new.pack_id; else pid:=old.pack_id; end if;
 if exists(select 1 from private.r09_releases where id=pid) then raise exception 'r09_immutable_release'; end if;
 if tg_table_name<>'packs' and tg_op='UPDATE' then
 if exists(select 1 from private.r09_releases where id=new.pack_id) then raise exception 'r09_immutable_release'; end if;
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger r09_pack_guard before update or delete on public.packs for each row execute function private.r09_pack_guard();
create trigger r09_definition_guard before insert or update or delete on public.pack_knowledge_definitions for each row execute function private.r09_pack_guard();
create function private.r09_install_guard() returns trigger language plpgsql security definer set search_path='' as $$ declare learned boolean; begin
 if tg_op='DELETE' then
 if exists(select 1 from private.r09_releases where id=old.root_pack_id) then raise exception 'r09_immutable_installation'; end if;
 return old;
 end if;
 learned:=exists(select 1 from public.packs p where p.id=new.root_pack_id and p.pack_key like 'knowledge.learned.%') or
 exists(select 1 from jsonb_array_elements(new.snapshot->'releases') x where x->'manifest'->>'packKey' like 'knowledge.learned.%' or exists(select 1 from private.r09_releases r where r.id::text=x->>'id'));
 if tg_op='UPDATE' and exists(select 1 from private.r09_releases where id=old.root_pack_id) then raise exception 'r09_immutable_installation'; end if;
 if learned and (tg_op<>'INSERT' or not exists(select 1 from private.r09_install_admissions where transaction_id=txid_current() and business_id=new.business_id and pack_id=new.root_pack_id)) then raise exception 'r09_deliberate_application_required' using errcode='42501'; end if;
 return new;
end $$;
create trigger r09_install_guard before insert or update or delete on public.installed_packs for each row execute function private.r09_install_guard();
create function private.r09_pin(a private.r09_applications) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('applicationId',a.id,'applicationReason',a.reason,'releaseId',r.id,'installationId',a.installation_id,'packKey',r.pack_key,'packVersion',r.version,'knowledgeKey',r.pack_key,'knowledgeVersion',r.version,
 'manifestHash',r.manifest_hash,'contentHash',r.content_hash,'verifiedAt',r.verified_at,'expiresAt',r.expires_at,'content',p.manifest->'knowledge'->0->'content','sources',r.provenance->'sources','reviewerIdentity',r.provenance->>'reviewerIdentity','reviewerFingerprint',r.provenance->>'reviewerFingerprint')
 from private.r09_releases r join public.packs p on p.id=r.id where r.id=a.release_id
$$;
create function private.r09_assert_pins(snapshot jsonb) returns void language plpgsql set search_path='' as $$ declare pin jsonb; begin
 -- Acquire every shared release lock before checking any wall-clock expiry.
 perform 1 from private.r09_releases r where r.id in (select (x->>'releaseId')::uuid from jsonb_array_elements(coalesce(snapshot->'pins','[]'::jsonb)) x) order by r.id for share;
 for pin in select value from jsonb_array_elements(coalesce(snapshot->'pins','[]'::jsonb)) order by value->>'releaseId' loop
 perform private.r09_assert_release((pin->>'releaseId')::uuid);
 end loop;
 if exists(select 1 from private.r09_releases r where r.id in (select (x->>'releaseId')::uuid from jsonb_array_elements(coalesce(snapshot->'pins','[]'::jsonb)) x) and r.expires_at<=clock_timestamp()) then raise exception 'r09_knowledge_stale_or_withdrawn'; end if;
end $$;
create function private.r09_plan_snapshot() returns trigger language plpgsql security definer set search_path='' as $$
declare a private.r09_applications; pins jsonb:='[]'; begin
 perform 1 from public.businesses where id=new.business_id for update;
 if (select count(*) from (select distinct on(pack_key) release_id from private.r09_applications where business_id=new.business_id order by pack_key,sequence desc) heads where release_id is not null)>20 then raise exception 'r09_application_bound'; end if;
 for a in select distinct on(pack_key) * from private.r09_applications where business_id=new.business_id order by pack_key,sequence desc loop
 if a.release_id is not null then perform private.r09_assert_release(a.release_id); pins:=pins||jsonb_build_array(private.r09_pin(a)); end if;
 end loop;
 perform private.r09_assert_pins(jsonb_build_object('pins',pins));
 if octet_length(pins::text)>149800 then raise exception 'r09_snapshot_bound'; end if;
 insert into private.r09_plan_pins(plan_id,business_id,snapshot) values(new.id,new.business_id,jsonb_build_object('format','r09.1','businessId',new.business_id,'planId',new.id,'pins',pins));
 return new;
end $$;
create trigger r09_plan_snapshot after insert on private.r07_plans for each row execute function private.r09_plan_snapshot();
create function private.r09_core_snapshot() returns trigger language plpgsql security definer set search_path='' as $$
declare snapshot jsonb; pid uuid; begin
 if tg_table_name='workflow_runs' then
 if not(new.state ? 'r07PlanId') then return new; end if;
 pid:=(new.state->>'r07PlanId')::uuid;
 select p.snapshot into snapshot from private.r09_plan_pins p where p.plan_id=pid and p.business_id=new.business_id;
 if snapshot is not null then
 perform private.r09_assert_pins(snapshot);
 insert into private.r09_run_pins(workflow_run_id,business_id,plan_id,snapshot) values(new.id,new.business_id,pid,snapshot);
 end if;
 elsif tg_table_name='task_contracts' then
 select p.snapshot into snapshot from private.r09_run_pins p where p.workflow_run_id=new.workflow_run_id and p.business_id=new.business_id;
 if snapshot is not null then
 perform private.r09_assert_pins(snapshot);
 insert into private.r09_task_pins(task_contract_id,business_id,workflow_run_id,snapshot) values(new.id,new.business_id,new.workflow_run_id,snapshot);
 end if;
 end if;
 return new;
end $$;
create trigger r09_run_snapshot after insert on public.workflow_runs for each row execute function private.r09_core_snapshot();
create trigger r09_task_snapshot after insert on public.task_contracts for each row execute function private.r09_core_snapshot();
create function private.r09_work_gate() returns trigger language plpgsql security definer set search_path='' as $$ declare snapshot jsonb; begin
 select p.snapshot into snapshot from private.r09_run_pins p where p.workflow_run_id=new.attempt_id and p.business_id=new.business_id;
 if snapshot is not null then perform private.r09_assert_pins(snapshot); end if;
 return new;
end $$;
create trigger r09_reserve_gate before insert on private.r07_bindings for each row execute function private.r09_work_gate();
create trigger r09_dispatch_gate before insert on private.r07_markers for each row execute function private.r09_work_gate();
create function private.r09_reuse_gate() returns trigger language plpgsql security definer set search_path='' as $$ declare destination jsonb; source jsonb; begin
 select snapshot into destination from private.r09_plan_pins where plan_id=new.plan_id and business_id=new.business_id;
 select p.snapshot into source from private.r09_run_pins p where p.workflow_run_id=new.attempt_id and p.business_id=new.business_id;
 if coalesce(destination->'pins','[]'::jsonb) is distinct from coalesce(source->'pins','[]'::jsonb) then return null; end if;
 perform private.r09_assert_pins(destination); return new;
end $$;
create trigger r09_reuse_gate before insert on private.r07_reused for each row execute function private.r09_reuse_gate();

-- Extend the existing pure projection with immutable Knowledge pins. A separately guarded final
-- controller fence follows below; all other existing function bodies and every existing ACL are preserved.
create or replace function private.r07_snapshot(b uuid,g uuid,pid uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('businessId',b,'goalId',g,'planId',p.id,'version',p.version,'planHash',p.content_hash,'plan',p.content,
 'head',jsonb_build_object('planId',h.plan_id,'revision',h.revision,'state',h.state,'reason',h.reason,'epoch',h.lease_epoch,'leaseExpiresAt',h.lease_expires_at,'repairsUsed',h.repairs_used,'pivotsUsed',h.pivots_used,'childrenCreated',h.children_created,'dispatches',h.dispatches),
 'attempts',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'stepKey',a.step_key,'attempt',a.attempt,'status',a.status,'reason',a.reason,'inputHash',a.input_hash,'dependencyPins',a.dependency_pins,'repairEvidenceHash',a.repair_evidence_hash,'requestId',binding.request_id,'wireHash',binding.wire_hash,'responseHash',response.content_hash,'resultEvidenceHash',private.r04_hash(response.content->'result'),'outcome',response.content->>'outcome','artifactId',response.artifact_id) order by a.step_key,a.attempt),'[]') from private.r07_attempts a left join private.r07_bindings binding on binding.attempt_id=a.id left join private.r07_responses response on response.attempt_id=a.id where a.plan_id=p.id),
 'reused',(select coalesce(jsonb_agg(jsonb_build_object('stepKey',r.step_key,'attemptId',r.attempt_id,'resultHash',v.content_hash) order by r.step_key),'[]') from private.r07_reused r join private.r07_responses v on v.attempt_id=r.attempt_id where r.plan_id=p.id),
 'executionEnabled',false,'capabilityGate','R10-R18','targetAchievement','unverified',
 'knowledge',coalesce((select snapshot from private.r09_plan_pins k where k.plan_id=p.id and k.business_id=b),jsonb_build_object('format','r09.1','businessId',b,'planId',p.id,'pins','[]'::jsonb)))
 from private.r07_plans p join private.r07_heads h on h.goal_id=g and h.business_id=b where p.id=pid and p.business_id=b and p.goal_id=g
$$;
-- The existing controller performs potentially blocking Core/FK writes after marker insertion.
-- Keep its body byte-for-byte except this final knowledge fence, AFTER its own last authority checks.
-- Refuse installation if the reviewed upstream return anchor has changed or become ambiguous.
do $r09_controller_patch$
declare definition text; anchor text:=E' return result||jsonb_build_object(\'replayed\',false);'; fence text:=E' if p_operation=\'plan\' or result->>\'status\' in (\'scheduled\',\'reserved\') or result->\'shouldDispatch\'=\'true\'::jsonb then\n perform private.r09_assert_pins(coalesce((select snapshot from private.r09_run_pins where workflow_run_id=a.id and business_id=p_business_id),(select snapshot from private.r09_plan_pins where plan_id=p.id and business_id=p_business_id)));\n end if;\n'; begin
 definition:=pg_get_functiondef('public.r07_controller(uuid,uuid,text,jsonb,uuid,text,text,bigint,text)'::regprocedure);
 if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'r09_controller_anchor_changed'; end if;
 execute replace(definition,anchor,fence||anchor);
end $r09_controller_patch$;
create function private.r09_release_item(r private.r09_releases,b uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',r.id,'packKey',r.pack_key,'version',r.version,'title',p.name,
 'status',case when exists(select 1 from private.r09_withdrawals w where w.release_id=r.id) then 'withdrawn' when r.expires_at<=now() then 'expired' else 'current' end,
 'content',p.manifest->'knowledge'->0->'content','sources',r.provenance->'sources','reviewerIdentity',r.provenance->>'reviewerIdentity','reviewerFingerprint',r.provenance->>'reviewerFingerprint','manifestHash',r.manifest_hash,'contentHash',r.content_hash,'reviewedAt',r.provenance->'reviewedAt','expiresAt',r.expires_at,
 'supersedesReleaseId',r.supersedes_release_id,'supersessionReason',r.supersession_reason,
 'application',(select jsonb_build_object('id',a.id,'releaseId',a.release_id) from private.r09_applications a where a.business_id=b and a.pack_key=r.pack_key order by a.sequence desc limit 1)) from public.packs p where p.id=r.id
$$;
-- Metadata selection precedes page/detail materialization, so counts never aggregate full private evidence or content.
create function private.r09_index(b uuid,d text) returns table(id uuid,created_at timestamptz,search_text text) language sql stable set search_path='' as $$
 select p.id,p.created_at,p.title||' '||p.scope from private.r09_proposals p where d='proposals' and p.business_id=b
 union all select r.id,r.created_at,r.pack_key||' '||r.version from private.r09_releases r where d='releases'
 union all select a.id,a.created_at,a.pack_key||' '||a.reason from private.r09_applications a where d='applications' and a.business_id=b
 union all select k.plan_id,k.created_at,p.goal_id::text||' '||p.version::text from private.r09_plan_pins k join private.r07_plans p on p.id=k.plan_id where d='usage' and k.business_id=b
$$;
create function private.r09_item(b uuid,d text,rid uuid) returns jsonb language plpgsql stable set search_path='' as $$ declare result jsonb; begin
 if d='proposals' then
 select jsonb_build_object('id',p.id,'businessId',b,'proposalId',p.proposal_id,'version',p.version,'title',p.title,'lesson',p.lesson,'scope',p.scope,'limitations',p.limitations,
 'artifactIds',(select jsonb_agg(e.artifact_id order by e.artifact_id) from private.r09_evidence e where e.proposal_version_id=p.id),'evidenceHash',p.evidence_hash,
 'status',case when exists(select 1 from private.r09_releases release where release.review_id=r.id) then 'promoted' else coalesce(r.verdict,'proposed') end,'reviewId',r.id,'reviewReason',r.review->>'notes','createdAt',p.created_at)
 into result from private.r09_proposals p left join private.r09_reviews r on r.proposal_version_id=p.id where p.id=rid and p.business_id=b;
 elsif d='releases' then select private.r09_release_item(r,b) into result from private.r09_releases r where r.id=rid;
 elsif d='applications' then select private.r09_application_item(a) into result from private.r09_applications a where a.id=rid and a.business_id=b;
 elsif d='usage' then
 select jsonb_build_object('id',p.id,'businessId',b,'goalId',p.goal_id,'planId',p.id,'planVersion',p.version,'createdAt',k.created_at,
 'runs',(select coalesce(jsonb_agg(jsonb_build_object('workflowRunId',runs.workflow_run_id,'taskContractId',runs.task_contract_id) order by runs.workflow_run_id),'[]'::jsonb) from (select rp.workflow_run_id,tp.task_contract_id from private.r09_run_pins rp left join private.r09_task_pins tp on tp.workflow_run_id=rp.workflow_run_id where rp.plan_id=p.id and rp.business_id=b order by rp.workflow_run_id limit 64) runs),
 'knowledge',(select coalesce(jsonb_agg(pin||jsonb_build_object('currentStatus',case when exists(select 1 from private.r09_withdrawals w where w.release_id=(pin->>'releaseId')::uuid) then 'withdrawn' when (pin->>'expiresAt')::timestamptz<=now() then 'expired' else 'current' end) order by pin->>'packKey'),'[]'::jsonb) from jsonb_array_elements(k.snapshot->'pins') pin))
 into result from private.r09_plan_pins k join private.r07_plans p on p.id=k.plan_id where k.plan_id=rid and k.business_id=b;
 end if; return result;
end $$;
create function private.r09_summary(b uuid,d text,rid uuid) returns jsonb language plpgsql stable set search_path='' as $$ declare item jsonb; result jsonb; begin
 if d='usage' then
 select jsonb_build_object('id',p.id,'businessId',b,'planVersion',p.version,'knowledgeCount',jsonb_array_length(k.snapshot->'pins'),'createdAt',k.created_at)
 into result from private.r09_plan_pins k join private.r07_plans p on p.id=k.plan_id where k.plan_id=rid and k.business_id=b;
 else
 item:=private.r09_item(b,d,rid);
 if d='proposals' then select jsonb_object_agg(key,value) into result from jsonb_each(item) where key=any(array['id','businessId','title','version','status','createdAt']);
 elsif d='releases' then select jsonb_object_agg(key,value) into result from jsonb_each(item) where key=any(array['id','packKey','title','version','status','reviewedAt']);
 elsif d='applications' then select jsonb_object_agg(key,value) into result from jsonb_each(item) where key=any(array['id','businessId','packKey','version','operation','status','releaseStatus','isCurrent','createdAt']); end if;
 end if; return result;
end $$;
create function public.r09_knowledge_read(p_business_id uuid,p_dataset text,p_query jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare lim integer:=25; off integer:=0; selected uuid; search text:=''; items jsonb; detail jsonb; total bigint; result jsonb; begin
 if auth.uid() is null or not private.is_business_owner(p_business_id) then raise exception 'r09_owner_required' using errcode='42501'; end if;
 if p_dataset is null or p_dataset not in ('proposals','releases','applications','usage') then raise exception 'r09_dataset_invalid'; end if;
 if jsonb_typeof(p_query) is distinct from 'object' or p_query-array['limit','offset','selectedId','query']<>'{}'::jsonb then raise exception 'r09_invalid_query'; end if;
 if p_query ? 'limit' then if jsonb_typeof(p_query->'limit') is distinct from 'number' or p_query->>'limit' !~ '^[0-9]{1,2}$' then raise exception 'r09_invalid_bounds'; end if; lim:=(p_query->>'limit')::integer; end if;
 if p_query ? 'offset' then if jsonb_typeof(p_query->'offset') is distinct from 'number' or p_query->>'offset' !~ '^[0-9]{1,5}$' then raise exception 'r09_invalid_bounds'; end if; off:=(p_query->>'offset')::integer; end if;
 if lim not between 1 and 25 or off not between 0 and 10000 then raise exception 'r09_invalid_bounds'; end if;
 if p_query ? 'selectedId' then selected:=private.r09_uuid(p_query->'selectedId'); end if;
 if p_query ? 'query' then if jsonb_typeof(p_query->'query') is distinct from 'string' or length(p_query->>'query')>200 then raise exception 'r09_invalid_query'; end if; search:=lower(p_query->>'query'); end if;
 select count(*) into total from private.r09_index(p_business_id,p_dataset) x where position(search in lower(x.search_text))>0;
 select coalesce(jsonb_agg(private.r09_summary(p_business_id,p_dataset,x.id) order by x.created_at desc,x.id desc),'[]'::jsonb) into items
 from (select * from private.r09_index(p_business_id,p_dataset) x where position(search in lower(x.search_text))>0 order by x.created_at desc,x.id desc limit lim offset off) x;
 if selected is not null then detail:=private.r09_item(p_business_id,p_dataset,selected); end if;
 result:=jsonb_build_object('businessId',p_business_id,'dataset',p_dataset,'items',items,'total',total,'limit',lim,'offset',off,'readOnly',true,
 'selection',jsonb_build_object('status',case when selected is null then 'none' when detail is null then 'missing' else 'selected' end,'item',detail));
 if octet_length(result::text)>262144 then raise exception 'r09_response_bound'; end if;
 return result;
end $$;
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like 'r09_%' loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 end loop;
end $$;
revoke all on function public.r09_knowledge_owner(uuid,text,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.r09_knowledge_owner(uuid,text,jsonb,uuid) to authenticated;
revoke all on function public.r09_knowledge_read(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.r09_knowledge_read(uuid,text,jsonb) to authenticated;
commit;
