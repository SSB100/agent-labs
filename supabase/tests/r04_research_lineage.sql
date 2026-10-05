-- Run inside the existing shared-budget suite's transaction, immediately before its rollback.
-- Reuses its actual guarded RPC-created roots and exact paid-cost fixtures; creates no provider effects.
select set_config('request.jwt.claim.sub',current_setting('v2context.owner'),true);
do $$
declare b uuid:=current_setting('v2context.business')::uuid; root uuid:=current_setting('v2chain.root')::uuid;
 before_rows jsonb; before_cost jsonb; goal uuid; preview jsonb; payload jsonb; content jsonb; key uuid:=gen_random_uuid(); denied boolean:=false; wd uuid; legacy uuid; v1 uuid; cand uuid;
begin
 select jsonb_agg(to_jsonb(e) order by id) into before_rows from public.product_experiments e where business_id=b;
 before_cost:=private.stage13v2_budget_authority(root,false);
 content:=jsonb_build_object('title','Preserved research intent','originalIntent',(select variables->'intent'->>'objective' from public.product_experiments where id=root),
 'objective',(select variables->'intent'->>'objective' from public.product_experiments where id=root),'parsed',jsonb_build_object('target',null,'budget',null,'deadline',null,'geography','[]'::jsonb,'scope',null,'stopConstraints','[]'::jsonb),'ambiguities',jsonb_build_array('Legacy facts need review'));
 goal:=(public.r04_quest_transition(b,'quest.save',jsonb_build_object('goalId',null,'expectedRevision',0,'content',content),gen_random_uuid())->>'id')::uuid;
 preview:=public.r04_research_link_preview(b,root);
 assert preview->>'status'='linkable','A verified authority chain is linkable';
 assert jsonb_array_length(preview->'experimentIds')>=2,'Original and successor are represented';
 payload:=jsonb_build_object('experimentId',root,'goalId',goal,'expectedRevision',1);
 perform public.r04_quest_transition(b,'research.link',payload,key);
 assert public.r04_quest_transition(b,'research.link',payload,key)->>'replayed'='true','Link duplicate is idempotent';
 assert public.r04_research_link_preview(b,root)->>'goalId'=goal::text,'Canonical Goal resolves through immutable association';
 assert (select jsonb_agg(to_jsonb(e) order by id) from public.product_experiments e where business_id=b)=before_rows,'All research bytes remain unchanged';
 assert private.stage13v2_budget_authority(root,false)=before_cost,'Paid accounting and authority remain unchanged';
 assert (select count(*) from private.r04_research_links where business_id=b)=jsonb_array_length(preview->'experimentIds'),'Every verified round is mapped';
 -- A second Goal with identical wording is still a conflicting identity, not an authority merge.
 legacy:=(public.r04_quest_transition(b,'quest.save',jsonb_build_object('goalId',null,'expectedRevision',0,'content',content),gen_random_uuid())->>'id')::uuid;
 begin perform public.r04_quest_transition(b,'research.link',jsonb_set(payload,'{goalId}',to_jsonb(legacy)),gen_random_uuid()); exception when others then denied:=true; end;
 assert denied,'Existing deterministic association cannot be relabeled';
 -- v1 without an exact workflow Goal stays explicitly unlinked.
 select id into wd from public.workflow_definitions where workflow_key='etsy.creative-pipeline' limit 1;
 if wd is null then select id into wd from public.workflow_definitions limit 1; end if;
 cand:=gen_random_uuid();v1:=gen_random_uuid();legacy:=gen_random_uuid();
 insert into public.product_candidates(id,business_id,fingerprint,concept,audience,hypothesis,original_design,rights_status,source_domains)
 values(cand,b,private.stage13_hash(cand::text),'R04 legacy product','Synthetic audience','Synthetic original hypothesis for lineage test',true,'confirmed',array['etsy.com']);
 insert into public.workflow_runs(id,business_id,workflow_definition_id,idempotency_key) values(legacy,b,wd,legacy::text);
 insert into public.product_experiments(id,business_id,candidate_id,workflow_run_id,fingerprint,hypothesis,variables,audience,status,measurement_plan)
 values(v1,b,cand,legacy,private.stage13_hash(v1::text),'Synthetic hypothesis','{}','Synthetic audience','reserved',private.stage13_plan());
 assert public.r04_research_link_preview(b,v1)->>'status'='unlinked_ambiguous','No guessed v1 mapping';
 insert into public.goals(business_id,title,status) values(b,'Legacy Core Goal','active') returning id into goal;
 update public.workflow_runs set goal_id=goal where id=legacy;
 assert public.r04_research_link_preview(b,v1)->>'status'='legacy_bound','Existing unversioned Goal is preserved and not advertised as mutable';
 assert (public.r04_research_link_preview(b,v1)->>'goalId')::uuid=goal,'Original canonical Goal identity is retained';
end $$;
