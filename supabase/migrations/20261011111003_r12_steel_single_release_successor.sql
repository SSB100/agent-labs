-- One non-cascading release transfer for an already-confirmed, unused repair.
-- Generated with official Supabase CLI 2.120.0. Definitions only, no live rows.
-- The old proposal, debit, release, package, recovery and envelope are immutable.
begin;
create table private.r12_steel_setup_release_successors(
 review_hash text primary key check(review_hash=private.stage14_hash(content-'reviewHash')),
 predecessor_review_hash text not null unique references private.r12_steel_setup_repair_releases(review_hash),
 envelope_id uuid not null unique references private.r12_direct_test_envelopes(id),
 proposal_id uuid not null unique references private.r12_steel_setup_replacement_proposals(id),
 debit_hash text not null unique references private.r12_steel_setup_repair_debits(debit_hash),
 replacement_operation_id uuid not null unique,
 content jsonb not null,expires_at timestamptz not null check(isfinite(expires_at)),created_at timestamptz not null default clock_timestamp());
create table private.r12_steel_setup_release_successor_revocations(
 review_hash text primary key references private.r12_steel_setup_release_successors(review_hash),
 created_at timestamptz not null default clock_timestamp());
do $$declare t text;begin foreach t in array array['r12_steel_setup_release_successors','r12_steel_setup_release_successor_revocations'] loop
 execute format('alter table private.%I enable row level security',t);
 execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 execute format('create trigger immutable_setup_successor before insert or update or delete on private.%I for each row execute function private.r05_guard()',t);
end loop;end $$;
create function private.r12_steel_setup_release_successor_revoke_lock() returns trigger language plpgsql set search_path='' as $$begin
 perform 1 from public.businesses b join private.r12_direct_test_envelopes e on e.business_id=b.id join private.r12_steel_setup_release_successors r on r.envelope_id=e.id where r.review_hash=new.review_hash for update of b;return new;
end $$;
create trigger r12_setup_successor_revoke_lock before insert on private.r12_steel_setup_release_successor_revocations for each row execute function private.r12_steel_setup_release_successor_revoke_lock();

-- Historical identity/terms validation deliberately does not compare its old
-- definition fingerprint with the new definitions. This is NOT an active release
-- check: only release_current can select an executable release.
create function private.r12_steel_setup_repair_predecessor(envelope uuid) returns private.r12_steel_setup_repair_releases language plpgsql set search_path='' as $$
declare r private.r12_steel_setup_repair_releases;e private.r12_direct_test_envelopes;p private.r12_direct_enrollment_packages;s private.r12_etsy_steel_setups;begin
 select * into strict e from private.r12_direct_test_envelopes where id=envelope;
 perform 1 from public.businesses where id=e.business_id and owner_user_id=e.owner_id for update;
 if not found then raise exception 'r12_setup_repair_release_inactive';end if;
 -- All release and revocation reads occur AFTER the shared Business lock.
 select * into strict r from private.r12_steel_setup_repair_releases where envelope_id=e.id;
 select p0.* into strict p from private.r12_direct_test_confirmations tc join private.r12_direct_enrollment_grants g on g.grant_id=tc.grant_id join private.r12_direct_enrollment_packages p0 on p0.package_hash=g.package_hash where tc.envelope_id=e.id;
 select * into strict s from private.r12_etsy_steel_setups where operation_id=r.original_operation_id;
 if r.expires_at<=clock_timestamp() or e.expires_at<=clock_timestamp() or p.expires_at<=clock_timestamp()
 or exists(select 1 from private.r12_steel_setup_repair_release_revocations where review_hash=r.review_hash)
 or exists(select 1 from private.r12_direct_enrollment_revocations where package_hash=p.package_hash)
 or r.review_hash is distinct from private.stage14_hash(r.content-'reviewHash') or r.content->>'reviewHash' is distinct from r.review_hash
 or r.content->>'version' is distinct from 'r12.steel-setup-repair-release.1'
 or r.package_hash is distinct from p.package_hash or r.content->>'reviewedPackageHash' is distinct from p.package_hash
 or r.content->>'businessId' is distinct from e.business_id::text or r.content->>'ownerId' is distinct from e.owner_id::text or r.content->>'goalId' is distinct from e.goal_id::text
 or r.content->>'testEnvelopeId' is distinct from e.id::text or r.content->>'testEnvelopeHash' is distinct from e.content_hash
 or r.content->>'originalOperationId' is distinct from s.operation_id::text or s.envelope_id is distinct from e.id or s.owner_id is distinct from e.owner_id
 or r.content->>'replacementOperationId' is distinct from r.replacement_operation_id::text
 or r.content->>'expiresAt' is distinct from private.r12_direct_time(r.expires_at)
 or r.content->>'originalReleaseHash' is distinct from private.stage14_hash(p.review_evidence->'release')
 or r.content->>'configurationHash' is distinct from private.stage14_hash(r.content->'configuration')
 or r.content->>'unchangedTermsHash' is distinct from private.r12_steel_setup_repair_terms(e,p)
 then raise exception 'r12_setup_repair_release_inactive';end if;
 return r;
end $$;

-- Confirmed proposal expiry is historical: its one debit persists. No renewal,
-- second debit, modified proposal or substituted replacement is accepted.
create function private.r12_steel_setup_repair_lineage(envelope uuid) returns private.r12_steel_setup_repair_debits language plpgsql set search_path='' as $$
declare r private.r12_steel_setup_repair_releases;d private.r12_steel_setup_repair_debits;p private.r12_steel_setup_replacement_proposals;z private.r12_steel_setup_recoveries;e private.r12_direct_test_envelopes;s private.r12_etsy_steel_setups;begin
 r:=private.r12_steel_setup_repair_predecessor(envelope);
 select * into strict e from private.r12_direct_test_envelopes where id=envelope;
 select * into strict s from private.r12_etsy_steel_setups where operation_id=r.original_operation_id;
 select * into d from private.r12_steel_setup_repair_debits where envelope_id=envelope;
 select * into p from private.r12_steel_setup_replacement_proposals where id=d.proposal_id;
 select * into z from private.r12_steel_setup_recoveries where operation_id=r.original_operation_id;
 if d.envelope_id is null or p.id is null or z.operation_id is null
 or d.debit_hash is distinct from private.stage14_hash(d.content-'debitHash') or d.content->>'debitHash' is distinct from d.debit_hash
 or p.proposal_hash is distinct from private.stage14_hash(p.content-'proposalHash') or p.content->>'proposalHash' is distinct from p.proposal_hash
 or d.owner_id is distinct from e.owner_id or p.owner_id is distinct from e.owner_id or p.envelope_id is distinct from e.id
 or d.original_operation_id is distinct from r.original_operation_id or p.operation_id is distinct from r.original_operation_id
 or d.replacement_operation_id is distinct from r.replacement_operation_id or p.replacement_operation_id is distinct from r.replacement_operation_id
 or d.content->>'releaseSuccessorHash' is distinct from r.review_hash or p.content->>'releaseSuccessorHash' is distinct from r.review_hash
 or d.content->>'proposalId' is distinct from p.id::text or d.content->>'proposalHash' is distinct from p.proposal_hash
 or d.content->>'ownerId' is distinct from e.owner_id::text or d.content->>'testEnvelopeId' is distinct from e.id::text or d.content->>'testEnvelopeHash' is distinct from e.content_hash
 or d.content->>'originalOperationId' is distinct from s.operation_id::text or d.content->>'replacementOperationId' is distinct from r.replacement_operation_id::text
 or d.content->>'recoveryHash' is distinct from z.recovery_hash or p.content->>'recoveryHash' is distinct from z.recovery_hash
 or p.content->>'failedReceiptHash' is distinct from z.failed_receipt_hash or r.content->>'failedReceiptHash' is distinct from z.failed_receipt_hash
 or p.content->>'businessId' is distinct from e.business_id::text or p.content->>'goalId' is distinct from e.goal_id::text or p.content->>'authorityRootId' is distinct from e.authority_root_id::text
 or p.content->>'testEnvelopeId' is distinct from e.id::text or p.content->>'testEnvelopeHash' is distinct from e.content_hash
 or p.content->>'originalOperationId' is distinct from s.operation_id::text or p.content->>'originalScopeHash' is distinct from s.scope_hash
 or p.content->>'replacementOperationId' is distinct from r.replacement_operation_id::text or p.content->>'accountId' is distinct from s.account_id::text
 or p.content->>'providerProjectId' is distinct from s.scope->>'providerProjectId' or p.content->>'routeHash' is distinct from s.route_hash
 or p.content->>'maximumBrowserMicrounits' is distinct from s.scope->>'maximumBrowserMicrounits' or p.content->>'originalHeldMaximumMicrounits' is distinct from s.scope->>'maximumBrowserMicrounits'
 or p.content->>'maximumTestMicrounits' is distinct from e.maximum_microunits::text
 or p.content->'originalMaximumUnits' is distinct from e.content->'maximumAttemptsInWindow' or d.content->'originalMaximumUnits' is distinct from e.content->'maximumAttemptsInWindow'
 or p.content->'setupRepairUnits' is distinct from '1'::jsonb or d.content->'setupRepairUnits' is distinct from '1'::jsonb
 or p.content->'remainingResearchUnits' is distinct from to_jsonb((e.content->>'maximumAttemptsInWindow')::integer-1) or d.content->'remainingResearchUnits' is distinct from p.content->'remainingResearchUnits'
 or p.content->>'releaseCommitSha' is distinct from r.content->'release'->>'commitSha' or p.content->>'deploymentId' is distinct from r.content->'configuration'->>'deploymentId'
 then raise exception 'r12_setup_successor_lineage_required';end if;
 return d;
end $$;

create or replace function private.r12_steel_setup_repair_release_current(envelope uuid) returns private.r12_steel_setup_repair_releases language plpgsql set search_path='' as $$
declare r private.r12_steel_setup_repair_releases;n private.r12_steel_setup_release_successors;d private.r12_steel_setup_repair_debits;begin
 r:=private.r12_steel_setup_repair_predecessor(envelope);
 select * into n from private.r12_steel_setup_release_successors where predecessor_review_hash=r.review_hash;
 if n.review_hash is not null then
 d:=private.r12_steel_setup_repair_lineage(envelope);
 if n.expires_at<=clock_timestamp() or exists(select 1 from private.r12_steel_setup_release_successor_revocations where review_hash=n.review_hash)
 or n.envelope_id is distinct from r.envelope_id or n.replacement_operation_id is distinct from r.replacement_operation_id
 or n.debit_hash is distinct from d.debit_hash or n.proposal_id is distinct from d.proposal_id
 or n.content->>'predecessorReviewHash' is distinct from r.review_hash or n.content->>'debitHash' is distinct from d.debit_hash
 or n.content->>'proposalHash' is distinct from d.content->>'proposalHash' or n.content->>'reviewHash' is distinct from n.review_hash
 or n.review_hash is distinct from private.stage14_hash(n.content-'reviewHash')
 or n.content->>'expiresAt' is distinct from private.r12_direct_time(n.expires_at)
 or n.content->>'unchangedTermsHash' is distinct from r.content->>'unchangedTermsHash'
 then raise exception 'r12_setup_successor_inactive';end if;
 -- In-memory projection only. Every returned review hash authenticates its own
 -- unmodified content; no original row or old proof is relabeled.
 r.review_hash:=n.review_hash;r.content:=n.content;r.expires_at:=n.expires_at;r.created_at:=n.created_at;
 end if;
 if r.content->'release'->>'databaseDefinitionHash' is distinct from private.r12_direct_enrollment_definition_hash() then raise exception 'r12_setup_repair_release_inactive';end if;
 return r;
end $$;

create function private.r12_steel_publish_release_successor(body jsonb) returns jsonb language plpgsql set search_path='' as $$
declare r private.r12_steel_setup_repair_releases;d private.r12_steel_setup_repair_debits;p private.r12_steel_setup_replacement_proposals;s private.r12_etsy_steel_setups;e private.r12_direct_test_envelopes;pkg private.r12_direct_enrollment_packages;n private.r12_steel_setup_release_successors;c jsonb;rel jsonb;ev jsonb;stamp timestamptz;expiry timestamptz;k text;begin
 if current_user in ('anon','authenticated','service_role') or not pg_has_role(current_user,(select proowner from pg_proc where oid='private.r12_steel_publish_release_successor(jsonb)'::regprocedure),'USAGE') then raise exception 'r12_setup_successor_operator_required' using errcode='42501';end if;
 perform private.r12_direct_scan(body);
 perform private.r04_keys(body,array['version','businessId','ownerId','goalId','testEnvelopeId','testEnvelopeHash','originalOperationId','originalScopeHash','replacementOperationId','accountId','providerProjectId','providerAccountHash','routeHash','predecessorReviewHash','proposalId','proposalHash','debitHash','recoveryHash','reviewedPackageHash','unchangedTermsHash','configuration','configurationHash','release','securityApprovalHash','releaseTransferApprovalHash','reviewedAt','expiresAt','reviewHash']);
 foreach k in array array['reviewedAt','expiresAt'] loop
 if coalesce(body->>k,'')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' or private.r12_direct_time((body->>k)::timestamptz) is distinct from body->>k then raise exception 'r12_setup_successor_invalid';end if;end loop;
 foreach k in array array['testEnvelopeHash','originalScopeHash','providerAccountHash','routeHash','predecessorReviewHash','proposalHash','debitHash','recoveryHash','reviewedPackageHash','unchangedTermsHash','configurationHash','securityApprovalHash','releaseTransferApprovalHash','reviewHash'] loop
 if coalesce(body->>k,'')!~'^[a-f0-9]{64}$' then raise exception 'r12_setup_successor_invalid';end if;end loop;
 stamp:=(body->>'reviewedAt')::timestamptz;expiry:=(body->>'expiresAt')::timestamptz;
 -- The FK targets the original repair table only. A successor cannot itself be
 -- a predecessor, even if its content is copied with a different review hash.
 select * into strict r from private.r12_steel_setup_repair_releases where review_hash=body->>'predecessorReviewHash';
 r:=private.r12_steel_setup_repair_predecessor(r.envelope_id);
 select * into n from private.r12_steel_setup_release_successors where predecessor_review_hash=r.review_hash;
 if n.review_hash is not null then
 if n.content is distinct from body then raise exception 'r12_setup_successor_conflict';end if;
 perform private.r12_steel_setup_repair_release_current(r.envelope_id);perform private.r12_direct_test_current(r.envelope_id);
 return jsonb_build_object('reviewHash',n.review_hash,'authorityCreated',false);end if;
 d:=private.r12_steel_setup_repair_lineage(r.envelope_id);
 select * into strict p from private.r12_steel_setup_replacement_proposals where id=d.proposal_id;
 select * into strict e from private.r12_direct_test_envelopes where id=r.envelope_id;
 select * into strict pkg from private.r12_direct_enrollment_packages where package_hash=r.package_hash;
 select * into strict s from private.r12_etsy_steel_setups where operation_id=r.original_operation_id;
 c:=body->'configuration';rel:=body->'release';perform private.r04_keys(c,array['version','provider','baseUrl','region','providerProjectId','environment','deploymentId','releaseCommitSha']);
 if body->>'version' is distinct from 'r12.steel-setup-release-successor.1' or body->>'reviewHash' is distinct from private.stage14_hash(body-'reviewHash')
 or body->>'businessId' is distinct from e.business_id::text or body->>'ownerId' is distinct from e.owner_id::text or body->>'goalId' is distinct from e.goal_id::text
 or body->>'testEnvelopeId' is distinct from e.id::text or body->>'testEnvelopeHash' is distinct from e.content_hash
 or body->>'originalOperationId' is distinct from s.operation_id::text or body->>'originalScopeHash' is distinct from s.scope_hash
 or body->>'replacementOperationId' is distinct from r.replacement_operation_id::text or body->>'accountId' is distinct from s.account_id::text
 or body->>'providerProjectId' is distinct from s.scope->>'providerProjectId' or body->>'routeHash' is distinct from s.route_hash
 or body->>'providerAccountHash' is distinct from pkg.content->'registry'->'browserRoute'->>'provider_account_hash'
 or body->>'proposalId' is distinct from p.id::text or body->>'proposalHash' is distinct from p.proposal_hash or body->>'debitHash' is distinct from d.debit_hash
 or body->>'recoveryHash' is distinct from d.content->>'recoveryHash' or body->>'reviewedPackageHash' is distinct from pkg.package_hash or body->>'unchangedTermsHash' is distinct from r.content->>'unchangedTermsHash'
 or stamp>clock_timestamp() or stamp<r.created_at or expiry<=clock_timestamp() or expiry>least(r.expires_at,e.expires_at,pkg.expires_at,s.profile_expires_at,stamp+interval '24 hours')
 or (c-'deploymentId'-'releaseCommitSha') is distinct from ((r.content->'configuration')-'deploymentId'-'releaseCommitSha')
 or c->>'releaseCommitSha' is distinct from rel->>'commitSha' or c->>'releaseCommitSha'=r.content->'release'->>'commitSha'
 or c->>'deploymentId'=r.content->'configuration'->>'deploymentId' or coalesce(c->>'deploymentId','')!~'^dpl_[A-Za-z0-9_-]{1,124}$'
 or body->>'configurationHash' is distinct from private.stage14_hash(c)
 or rel->>'treeSha'=r.content->'release'->>'treeSha' or rel->>'deploymentReceiptHash'=r.content->'release'->>'deploymentReceiptHash'
 then raise exception 'r12_setup_successor_invalid';end if;
 -- A transfer is permitted only before replacement preparation. Nothing may
 -- have reserved, dispatched, admitted configuration, handed off or researched.
 if exists(select 1 from private.r12_etsy_steel_setups where operation_id=r.replacement_operation_id)
 or exists(select 1 from private.r12_direct_browser_operations where envelope_id=e.id and id<>s.operation_id)
 or exists(select 1 from private.r12_steel_create_config_permits where operation_id=r.replacement_operation_id)
 or exists(select 1 from private.r12_steel_create_config_uses where operation_id=r.replacement_operation_id)
 or exists(select 1 from private.r12_etsy_steel_dispatches where operation_id=r.replacement_operation_id)
 or exists(select 1 from private.r12_etsy_steel_handoffs where operation_id=r.replacement_operation_id)
 or exists(select 1 from private.r12_etsy_steel_verification_runs where setup_operation_id=r.replacement_operation_id)
 or exists(select 1 from private.r12_direct_research_setups where envelope_id=e.id)
 then raise exception 'r12_setup_successor_unused_replacement_required';end if;
 perform private.r12_steel_setup_recovery_context(s.operation_id,r.content->>'failedReceiptHash');
 if private.r12_steel_setup_recovery_receipt(s.operation_id,r.content->>'failedReceiptHash')->>'status' not in ('qualified_bounded_pending','final_actual') then raise exception 'r12_setup_successor_recovery_required';end if;
 perform private.r12_direct_financial_check(e.id,(s.scope->>'maximumBrowserMicrounits')::bigint+(s.scope->>'verificationMaximumMicrounits')::bigint);
 -- All three required exact-head CI artifacts, commit/tree, deployment receipt
 -- and post-migration definition fingerprint pass the unchanged normal validator.
 ev:=jsonb_set(pkg.review_evidence,'{release}',rel);
 perform private.r12_direct_enrollment_evidence(jsonb_set(pkg.content,'{reviewEvidenceHash}',to_jsonb(private.stage14_hash(ev))),ev);
 insert into private.r12_steel_setup_release_successors values(body->>'reviewHash',r.review_hash,e.id,p.id,d.debit_hash,r.replacement_operation_id,body,expiry,clock_timestamp());
 -- Any stale current-test/ancestor/renderer/profile/grant check rolls back the
 -- insert atomically. No exemptions to definition coverage are introduced.
 perform private.r12_direct_test_current(e.id);
 return jsonb_build_object('reviewHash',body->>'reviewHash','authorityCreated',false);
end $$;

create or replace function private.r12_steel_setup_repair_attestation(body jsonb) returns boolean language plpgsql set search_path='' as $$
declare r private.r12_steel_setup_repair_releases;begin
 select x.* into r from private.r12_steel_setup_repair_releases x join private.r12_etsy_steel_setups s on s.operation_id=x.original_operation_id
 left join private.r12_steel_setup_release_successors n on n.predecessor_review_hash=x.review_hash
 where s.route_hash=body->>'routeHash' and coalesce(n.content->>'configurationHash',x.content->>'configurationHash')=body->>'configurationHash';
 if r.review_hash is null then return false;end if;r:=private.r12_steel_setup_repair_release_current(r.envelope_id);
 return body->'configuration'=r.content->'configuration' and body->>'configurationHash'=r.content->>'configurationHash' and body->>'deploymentEvidenceHash'=r.content->'release'->>'deploymentReceiptHash';
end $$;

-- Preserve existing operation/verification/research lineage and financial gates.
-- Only replace the obsolete comparison of the debit with the effective hash.
do $$declare def text;old text;begin
 def:=pg_get_functiondef('private.r12_steel_setup_repair_create_release(uuid,uuid,jsonb)'::regprocedure);
 old:='select * into d from private.r12_steel_setup_repair_debits where envelope_id=envelope;';
 if (length(def)-length(replace(def,old,'')))/length(old)<>1 then raise exception 'r12_successor_create_lineage_drift';end if;
 def:=replace(def,old,'d:=private.r12_steel_setup_repair_lineage(envelope);');
 old:='d.content->>''releaseSuccessorHash'' is distinct from r.review_hash or ';
 if (length(def)-length(replace(def,old,'')))/length(old)<>1 then raise exception 'r12_successor_create_release_drift';end if;execute replace(def,old,'');
 def:=pg_get_functiondef('private.r12_steel_setup_replacement_guard()'::regprocedure);
 old:='rr:=private.r12_steel_setup_repair_release_current(new.envelope_id);if d.content->>''releaseSuccessorHash'' is distinct from rr.review_hash or rr.replacement_operation_id<>new.operation_id';
 if (length(def)-length(replace(def,old,'')))/length(old)<>1 then raise exception 'r12_successor_setup_drift';end if;
 execute replace(def,old,'rr:=private.r12_steel_setup_repair_release_current(new.envelope_id);d:=private.r12_steel_setup_repair_lineage(new.envelope_id);if rr.replacement_operation_id<>new.operation_id');
 def:=pg_get_functiondef('private.r12_steel_create_config_context(uuid,text)'::regprocedure);
 old:='expires:=least(expires,(select expires_at from private.r12_steel_setup_repair_releases where envelope_id=e.id));';
 if (length(def)-length(replace(def,old,'')))/length(old)<>1 then raise exception 'r12_successor_config_expiry_drift';end if;
 execute replace(def,old,'if exists(select 1 from private.r12_steel_setup_repair_releases where envelope_id=e.id) then expires:=least(expires,(private.r12_steel_setup_repair_release_current(e.id)).expires_at);end if;');
end $$;

-- A separate, self-hashed projection authenticates effective deployment identity
-- and its immutable proposal/debit provenance. This read takes the shared lock;
-- it performs no inserts/updates and is intentionally VOLATILE, never STABLE.
create or replace function private.r12_steel_setup_replacement_view(operation uuid,proposal uuid default null) returns jsonb language plpgsql set search_path='' as $$
declare p private.r12_steel_setup_replacement_proposals;z private.r12_steel_setup_recoveries;d private.r12_steel_setup_repair_debits;r private.r12_steel_setup_repair_releases;effective jsonb;begin
 select * into z from private.r12_steel_setup_recoveries where operation_id=operation;
 select x.* into p from private.r12_steel_setup_replacement_proposals x left join private.r12_steel_setup_repair_debits debit on debit.proposal_id=x.id where x.operation_id=operation and (proposal is null or x.id=proposal) order by (debit.proposal_id is not null) desc,x.created_at desc,x.id desc limit 1;
 select * into d from private.r12_steel_setup_repair_debits where proposal_id=p.id;
 if d.envelope_id is not null then
 r:=private.r12_steel_setup_repair_release_current(d.envelope_id);d:=private.r12_steel_setup_repair_lineage(d.envelope_id);
 effective:=jsonb_build_object('version','etsy.steel-setup-effective-release.1','businessId',p.content->'businessId','testEnvelopeId',p.envelope_id,'testEnvelopeHash',p.content->'testEnvelopeHash','originalOperationId',operation,'replacementOperationId',d.replacement_operation_id,'proposalId',p.id,'proposalHash',p.proposal_hash,'debitHash',d.debit_hash,'predecessorReviewHash',d.content->'releaseSuccessorHash','effectiveReviewHash',r.review_hash,'releaseCommitSha',r.content->'release'->'commitSha','deploymentId',r.content->'configuration'->'deploymentId','configurationHash',r.content->'configurationHash','unchangedTermsHash',r.content->'unchangedTermsHash','expiresAt',private.r12_direct_time(r.expires_at));
 effective:=effective||jsonb_build_object('projectionHash',private.stage14_hash(effective));
 end if;
 return jsonb_build_object('version','etsy.steel-setup-replacement-view.2','operationId',operation,'recovery',case when z.operation_id is null then null else private.r12_steel_setup_recovery_receipt(operation,z.failed_receipt_hash) end,'proposal',p.content,'confirmed',d.envelope_id is not null,'effectiveRelease',effective);
end $$;

do $$declare f record;begin for f in select p.oid::regprocedure name from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and (p.proname like 'r12_steel_setup_%' or p.proname='r12_steel_publish_release_successor') loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.name);end loop;end $$;
commit;
