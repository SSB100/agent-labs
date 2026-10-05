-- Isolated fixtures only. Single backend validates transactions/CAS, not simultaneous locks.
begin;
insert into auth.users(id,email) values('94040000-0000-4000-8000-000000000001','r04-owner@example.invalid'),('94040000-0000-4000-8000-000000000002','r04-other@example.invalid');
insert into public.businesses(id,owner_user_id,name) values
 ('94040000-0000-4000-8000-000000000011','94040000-0000-4000-8000-000000000001','R04 A'),
 ('94040000-0000-4000-8000-000000000012','94040000-0000-4000-8000-000000000001','R04 same owner B'),
 ('94040000-0000-4000-8000-000000000013','94040000-0000-4000-8000-000000000002','R04 other owner');
select set_config('request.jwt.claim.sub','94040000-0000-4000-8000-000000000001',true);
create function pg_temp.r04_assert(ok boolean,label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'R04 assertion: %',label; end if; end $$;
create function pg_temp.r04_reject(statement text, message text default null) returns void language plpgsql as $$
declare denied boolean:=false;
begin
 begin execute statement;
 exception when others then
 if message is not null and position(message in sqlerrm)=0 then raise exception 'Wrong rejection: %; wanted %',sqlerrm,message; end if; denied:=true;
 end;
 if not denied then raise exception 'Expected rejection: %',statement; end if;
end $$;
create function pg_temp.r04_save(b uuid,op text,p jsonb,k uuid default gen_random_uuid()) returns jsonb language sql as $$ select public.r04_quest_transition(b,op,p,k) $$;
set local role authenticated;
select pg_temp.r04_assert((public.r04_quest_read('94040000-0000-4000-8000-000000000011')->'business'->>'preference')='legacy_unmanaged','legacy is not paused');
select set_config('request.jwt.claim.sub','',true);
select pg_temp.r04_reject($q$select public.r04_quest_read('94040000-0000-4000-8000-000000000011')$q$,'r04_owner_required');
select pg_temp.r04_reject($q$select public.r04_quest_transition('94040000-0000-4000-8000-000000000011','quest.save','{}',gen_random_uuid())$q$,'r04_owner_required');
select set_config('request.jwt.claim.sub','94040000-0000-4000-8000-000000000001',true);
select pg_temp.r04_reject($q$select public.r04_quest_read('94040000-0000-4000-8000-000000000013')$q$,'r04_owner_required');
select pg_temp.r04_reject($q$select public.r04_quest_read('94040000-0000-4000-8000-000000000011',null,51)$q$,'r04_invalid_page');
select set_config('r04.business_payload','{"expectedRevision":0,"content":{"brandContext":"Brand","operatingRules":"No sales","allowedActivity":"Research planning","restrictions":"No paid operations"},"preference":"setup"}',true);
select set_config('r04.business_result',pg_temp.r04_save('94040000-0000-4000-8000-000000000011','business.save',current_setting('r04.business_payload')::jsonb,'94040000-0000-4000-8000-000000000101')::text,true);
select pg_temp.r04_assert((pg_temp.r04_save('94040000-0000-4000-8000-000000000011','business.save',current_setting('r04.business_payload')::jsonb,'94040000-0000-4000-8000-000000000101')->>'replayed')::boolean,'business duplicate');
select pg_temp.r04_reject($q$select pg_temp.r04_save('94040000-0000-4000-8000-000000000011','business.save',jsonb_set(current_setting('r04.business_payload')::jsonb,'{preference}','"paused"'),'94040000-0000-4000-8000-000000000101')$q$,'r04_idempotency_conflict');
select pg_temp.r04_reject($q$select pg_temp.r04_save('94040000-0000-4000-8000-000000000011','business.save',current_setting('r04.business_payload')::jsonb)$q$,'r04_stale_revision');
select set_config('r04.content','{"title":"Research intent","originalIntent":"Research a possible market","objective":"Research a possible market","parsed":{"target":{"amount":"1","currency":null,"metric":"units"},"budget":{"amount":"0","currency":"USD"},"deadline":{"date":"2027-01-01","time":"12:00","timezone":"UTC"},"scope":"Research planning","geography":["New Zealand"],"stopConstraints":["No paid operations"]},"ambiguities":["currency"]}',true);
select set_config('r04.goal',(pg_temp.r04_save('94040000-0000-4000-8000-000000000011','quest.save',jsonb_build_object('goalId',null,'expectedRevision',0,'content',current_setting('r04.content')::jsonb),'94040000-0000-4000-8000-000000000102')->>'id'),true);
select pg_temp.r04_assert((pg_temp.r04_save('94040000-0000-4000-8000-000000000011','quest.save',jsonb_build_object('goalId',null,'expectedRevision',0,'content',current_setting('r04.content')::jsonb),'94040000-0000-4000-8000-000000000102')->>'id')=current_setting('r04.goal'),'quest duplicate same identity');
select pg_temp.r04_assert((select status='draft' from public.goals where id=current_setting('r04.goal')::uuid),'Core Goal stays draft');
select pg_temp.r04_reject($q$update public.goals set status='active' where id=current_setting('r04.goal')::uuid$q$,'r04_managed_goal_immutable');
select pg_temp.r04_reject($q$select * from private.r04_goal_versions$q$,'permission denied');
select pg_temp.r04_reject($q$select pg_temp.r04_save('94040000-0000-4000-8000-000000000012','quest.preference',jsonb_build_object('goalId',current_setting('r04.goal'),'expectedRevision',1,'preference','ready'))$q$,'r04_quest_unavailable');
select pg_temp.r04_reject($q$select public.r04_quest_read('94040000-0000-4000-8000-000000000012',current_setting('r04.goal')::uuid)$q$,'r04_quest_unavailable');
select pg_temp.r04_reject($q$select pg_temp.r04_save('94040000-0000-4000-8000-000000000011','quest.preference',jsonb_build_object('goalId',current_setting('r04.goal'),'expectedRevision',1,'preference','ready'))$q$,'r04_ambiguous_intent');
select pg_temp.r04_reject($q$select pg_temp.r04_save('94040000-0000-4000-8000-000000000011','quest.save',jsonb_build_object('goalId',null,'expectedRevision',0,'content',jsonb_set(current_setting('r04.content')::jsonb,'{originalIntent}','"password=never-store-this"')))$q$,'r04_credential_content_rejected');
select pg_temp.r04_save('94040000-0000-4000-8000-000000000011','quest.save',jsonb_build_object('goalId',current_setting('r04.goal'),'expectedRevision',1,'content',jsonb_set(current_setting('r04.content')::jsonb,'{ambiguities}','[]')));
select pg_temp.r04_save('94040000-0000-4000-8000-000000000011','quest.preference',jsonb_build_object('goalId',current_setting('r04.goal'),'expectedRevision',2,'preference','ready'));
select pg_temp.r04_save('94040000-0000-4000-8000-000000000011','quest.select',jsonb_build_object('goalId',current_setting('r04.goal'),'expectedRevision',3));
select pg_temp.r04_assert(public.r04_quest_read('94040000-0000-4000-8000-000000000011')->>'selection'='current','current explicit persistent selection');
select set_config('r04.envelope',jsonb_build_object('purposes',jsonb_build_array('Research planning'),'operations',jsonb_build_array('plan'),'accounts','[]'::jsonb,'packs','[]'::jsonb,'dataSharing','[]'::jsonb,'limits',jsonb_build_array(jsonb_build_object('category','all','currency','USD','maximum','0')),'startsAt',to_char(clock_timestamp(),'YYYY-MM-DD"T"HH24:MI:SS"Z"'),'expiresAt',to_char(clock_timestamp()+interval '1 day','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'stopRules',jsonb_build_array('No dispatch until reviewed admission'))::text,true);
select set_config('r04.proposal',(pg_temp.r04_save('94040000-0000-4000-8000-000000000011','envelope.propose',jsonb_build_object('goalId',current_setting('r04.goal'),'expectedRevision',3,'businessRevision',1,'envelope',current_setting('r04.envelope')::jsonb))->>'id'),true);
select set_config('r04.proposal_hash',(public.r04_quest_read('94040000-0000-4000-8000-000000000011')->'selected'->'proposals'->0->>'hash'),true);
select pg_temp.r04_reject($q$select pg_temp.r04_save('94040000-0000-4000-8000-000000000011','envelope.confirm',jsonb_build_object('proposalId',current_setting('r04.proposal'),'proposalHash',repeat('a',64)))$q$,'r04_proposal_hash_mismatch');
select pg_temp.r04_save('94040000-0000-4000-8000-000000000011','envelope.confirm',jsonb_build_object('proposalId',current_setting('r04.proposal'),'proposalHash',current_setting('r04.proposal_hash')),'94040000-0000-4000-8000-000000000103');
select pg_temp.r04_assert(public.r04_quest_read('94040000-0000-4000-8000-000000000011')->'selected'->'proposals'->0->>'status'='confirmed_intent_only','confirmation is intent only');
select pg_temp.r04_assert(public.r04_quest_read('94040000-0000-4000-8000-000000000011')->>'executionAvailable'='false','no execution grant');
select pg_temp.r04_save('94040000-0000-4000-8000-000000000011','business.save',jsonb_set(jsonb_set(current_setting('r04.business_payload')::jsonb,'{expectedRevision}','1'),'{preference}','"paused"'));
select pg_temp.r04_assert(public.r04_quest_read('94040000-0000-4000-8000-000000000011')->'selected'->'proposals'->0->>'status'='stale','rule edit invalidates confirmation');
select pg_temp.r04_save('94040000-0000-4000-8000-000000000011','envelope.confirm',jsonb_build_object('proposalId',current_setting('r04.proposal'),'proposalHash',current_setting('r04.proposal_hash')),'94040000-0000-4000-8000-000000000103');
select pg_temp.r04_assert(public.r04_quest_read('94040000-0000-4000-8000-000000000011')->'selected'->'proposals'->0->>'status'='stale','replay does not revive confirmation');
select pg_temp.r04_assert(pg_temp.r04_save('94040000-0000-4000-8000-000000000011','envelope.confirm',jsonb_build_object('proposalId',current_setting('r04.proposal'),'proposalHash',current_setting('r04.proposal_hash')),'94040000-0000-4000-8000-000000000103')->>'status'='stale','Replay result itself reports current status');
select pg_temp.r04_reject($q$select pg_temp.r04_save('94040000-0000-4000-8000-000000000011','envelope.confirm',jsonb_build_object('proposalId',current_setting('r04.proposal'),'proposalHash',current_setting('r04.proposal_hash')))$q$,'r04_proposal_stale');
select pg_temp.r04_save('94040000-0000-4000-8000-000000000011','envelope.revoke',jsonb_build_object('proposalId',current_setting('r04.proposal')));
select pg_temp.r04_assert(public.r04_quest_read('94040000-0000-4000-8000-000000000011')->'selected'->'proposals'->0->>'status'='revoked','revocation retained');
select pg_temp.r04_assert(public.r04_quest_read('94040000-0000-4000-8000-000000000011')->'business'->>'preference'='paused','selection never resumes business');
-- Every server entry rejects known credential forms before persistence, including decoded JSON newlines.
do $$ declare sample text; denied boolean; before_count integer; begin
 for sample in select unnest(array[E'password\nsynthetic-value','password is synthetic-value','client_secret=synthetic-value','secret_key=synthetic-value','token=synthetic-value',
 'postgres://user:synthetic-value@example.invalid/db','Basic c3ludGhldGljOmZpeHR1cmU=','sk_live_abcdefghijklmnop','xoxb-abcdefghijklmnop','github_pat_abcdefghijklmnopqrst','ASIAABCDEFGHIJKLMNOP']) loop
 denied:=false;
 begin perform pg_temp.r04_save('94040000-0000-4000-8000-000000000011','quest.save',jsonb_build_object('goalId',null,'expectedRevision',0,'content',jsonb_set(current_setting('r04.content')::jsonb,'{originalIntent}',to_jsonb(sample))));
 exception when others then assert sqlerrm='r04_credential_content_rejected','Known secret rejected with generic error only'; denied:=true; end;
 assert denied,'Server screens decoded known credential forms';
 end loop;
end $$;
-- A caller cannot clear ambiguity flags while leaving consequential facts unresolved.
do $$ declare bad jsonb; saved uuid; denied boolean; begin
 bad:=jsonb_set(jsonb_set(current_setting('r04.content')::jsonb,'{ambiguities}','[]'),'{parsed,target}','null');
 saved:=(pg_temp.r04_save('94040000-0000-4000-8000-000000000011','quest.save',jsonb_build_object('goalId',null,'expectedRevision',0,'content',bad))->>'id')::uuid;
 denied:=false;
 begin perform pg_temp.r04_save('94040000-0000-4000-8000-000000000011','quest.preference',jsonb_build_object('goalId',saved,'expectedRevision',1,'preference','ready')); exception when others then assert sqlerrm='r04_consequential_facts_required'; denied:=true; end;
 assert denied,'Ready independently validates parsed facts';
 bad:=jsonb_set(current_setting('r04.content')::jsonb,'{parsed,deadline,date}','"2027-02-30"'); denied:=false;
 begin perform pg_temp.r04_save('94040000-0000-4000-8000-000000000011','quest.save',jsonb_build_object('goalId',null,'expectedRevision',0,'content',bad)); exception when others then denied:=true; end;
 assert denied,'Invalid actual date rejected';
 bad:=jsonb_set(current_setting('r04.content')::jsonb,'{parsed,budget,amount}','"999999999999999999999"'); denied:=false;
 begin perform pg_temp.r04_save('94040000-0000-4000-8000-000000000011','quest.save',jsonb_build_object('goalId',null,'expectedRevision',0,'content',bad)); exception when others then assert sqlerrm='r04_invalid_amount'; denied:=true; end;
 assert denied,'Overflow amounts rejected';
end $$;
reset role;
-- Safe same-Business account references and changing-revision invalidation.
insert into private.connected_accounts(id,business_id,owner_id,provider,provider_account_id,status,connection_revision,verified_at) values
 ('94040000-0000-4000-8000-000000000201','94040000-0000-4000-8000-000000000011','94040000-0000-4000-8000-000000000001','printful','r04-synthetic-a','connected','94040000-0000-4000-8000-000000000211',now()),
 ('94040000-0000-4000-8000-000000000202','94040000-0000-4000-8000-000000000012','94040000-0000-4000-8000-000000000001','printful','r04-synthetic-b','connected','94040000-0000-4000-8000-000000000212',now());
set local role authenticated;
select pg_temp.r04_reject($q$select pg_temp.r04_save('94040000-0000-4000-8000-000000000011','envelope.propose',jsonb_build_object('goalId',current_setting('r04.goal'),'expectedRevision',3,'businessRevision',2,'envelope',jsonb_set(current_setting('r04.envelope')::jsonb,'{accounts}','[{"id":"94040000-0000-4000-8000-000000000202","revision":"94040000-0000-4000-8000-000000000212"}]')))$q$,'r04_account_unavailable');
select set_config('r04.account_proposal',(pg_temp.r04_save('94040000-0000-4000-8000-000000000011','envelope.propose',jsonb_build_object('goalId',current_setting('r04.goal'),'expectedRevision',3,'businessRevision',2,'envelope',jsonb_set(current_setting('r04.envelope')::jsonb,'{accounts}','[{"id":"94040000-0000-4000-8000-000000000201","revision":"94040000-0000-4000-8000-000000000211"}]')))->>'id'),true);
select set_config('r04.account_hash',(public.r04_quest_read('94040000-0000-4000-8000-000000000011')->'selected'->'proposals'->0->>'hash'),true);
select pg_temp.r04_save('94040000-0000-4000-8000-000000000011','envelope.confirm',jsonb_build_object('proposalId',current_setting('r04.account_proposal'),'proposalHash',current_setting('r04.account_hash')));
select pg_temp.r04_assert(jsonb_array_length(public.r04_quest_read('94040000-0000-4000-8000-000000000011')->'references'->'accounts')=1,'Account refs do not cross Businesses');
reset role;
update private.connected_accounts set connection_revision='94040000-0000-4000-8000-000000000213' where id='94040000-0000-4000-8000-000000000201';
set local role authenticated;
select pg_temp.r04_assert(public.r04_quest_read('94040000-0000-4000-8000-000000000011')->'selected'->'proposals'->0->>'status'='stale','Changed connection revision invalidates confirmation');
select pg_temp.r04_reject($q$select pg_temp.r04_save('94040000-0000-4000-8000-000000000011','envelope.confirm',jsonb_build_object('proposalId',current_setting('r04.account_proposal'),'proposalHash',current_setting('r04.account_hash')))$q$,'r04_proposal_stale');
reset role;
select pg_temp.r04_assert((select count(*)=0 from public.workflow_runs where business_id='94040000-0000-4000-8000-000000000011'),'no workflow side effects');
select pg_temp.r04_assert((select count(*)=0 from public.product_research_cost_reservations where business_id='94040000-0000-4000-8000-000000000011'),'no budget side effects');
select pg_temp.r04_reject($q$update private.r04_goal_versions set content='{}'$q$,'r04_immutable_history');
select pg_temp.r04_reject($q$delete from private.r04_confirmations$q$,'r04_immutable_history');
set local role service_role;
select pg_temp.r04_reject($q$select public.r04_quest_read('94040000-0000-4000-8000-000000000011')$q$,'permission denied');
select pg_temp.r04_reject($q$insert into private.r04_goal_state(goal_id,business_id,revision) values(gen_random_uuid(),'94040000-0000-4000-8000-000000000011',1)$q$,'permission denied');
reset role;
set local role anon;
select pg_temp.r04_reject($q$select public.r04_quest_read('94040000-0000-4000-8000-000000000011')$q$,'permission denied');
reset role;
rollback;
