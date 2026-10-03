-- R08 additive owner reads only. No execution authority, keys, tables or data mutations.
begin;
create index r08_research_workflow_scope on private.r04_research_links(business_id,workflow_run_id,goal_id);
create function public.r08_workflow_quest(p_business_id uuid,p_workflow_run_id uuid) returns uuid
language sql stable security definer set search_path='' as $$
 select case when count(distinct x.goal_id)=1 then (array_agg(distinct x.goal_id))[1] else null end
 from (
  select w.goal_id from public.workflow_runs w where w.business_id=p_business_id and w.id=p_workflow_run_id and w.goal_id is not null
  union all
  select l.goal_id from private.r04_research_links l join public.product_experiments e on e.id=l.experiment_id and e.business_id=l.business_id and e.workflow_run_id=l.workflow_run_id
   where l.business_id=p_business_id and l.workflow_run_id=p_workflow_run_id
 ) x
 where private.is_business_owner(p_business_id)
 -- Conflicting links never manufacture a canonical Quest. A legacy Core Goal is not an R04 Quest.
 having count(distinct x.goal_id)=1 and exists(select 1 from private.r04_goal_state g where g.business_id=p_business_id and g.goal_id=(array_agg(distinct x.goal_id))[1]);
$$;
revoke all on function public.r08_workflow_quest(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.r08_workflow_quest(uuid,uuid) to authenticated;

create view public.r08_workflow_runs with(security_invoker=true,security_barrier=true) as
 select w.*,public.r08_workflow_quest(w.business_id,w.id) quest_id from public.workflow_runs w;
create view public.r08_product_experiments with(security_invoker=true,security_barrier=true) as
 select e.*,public.r08_workflow_quest(e.business_id,e.workflow_run_id) quest_id from public.product_experiments e;
create view public.r08_artifacts with(security_invoker=true,security_barrier=true) as
 select a.*,public.r08_workflow_quest(a.business_id,a.workflow_run_id) quest_id from public.artifacts a;
create view public.r08_creative_runs with(security_invoker=true,security_barrier=true) as
 select r.*,public.r08_workflow_quest(r.business_id,r.workflow_run_id) quest_id from public.creative_runs r;
create view public.r08_creative_assets with(security_invoker=true,security_barrier=true) as
 select a.*,public.r08_workflow_quest(r.business_id,r.workflow_run_id) quest_id from public.creative_assets a join public.creative_runs r on r.id=a.creative_run_id and r.business_id=a.business_id;
create view public.r08_owner_interventions with(security_invoker=true,security_barrier=true) as
 select i.*,public.r08_workflow_quest(i.business_id,case when i.workflow_run_id is not null and a.workflow_run_id is not null and i.workflow_run_id<>a.workflow_run_id then null else coalesce(i.workflow_run_id,a.workflow_run_id) end) quest_id from public.owner_interventions i left join public.action_intents a on a.id=i.action_intent_id and a.business_id=i.business_id;
create view public.r08_events with(security_invoker=true,security_barrier=true) as
 select e.*,public.r08_workflow_quest(e.business_id,e.workflow_run_id) quest_id from public.events e;
revoke all on public.r08_workflow_runs,public.r08_product_experiments,public.r08_artifacts,public.r08_creative_runs,public.r08_creative_assets,public.r08_owner_interventions,public.r08_events from public,anon,authenticated,service_role;
grant select on public.r08_workflow_runs,public.r08_product_experiments,public.r08_artifacts,public.r08_creative_runs,public.r08_creative_assets,public.r08_owner_interventions,public.r08_events to authenticated;

create function public.r08_owner_read(p_business_id uuid,p_goal_id uuid,p_dataset text,p_query jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare src text; scoped text; filtered text; n integer:=25; off integer:=0; needle text:=''; selected text; total bigint; items jsonb; detail jsonb; result jsonb;
begin
 if not private.is_business_owner(p_business_id) then raise exception 'r08_owner_required' using errcode='42501'; end if;
 if p_goal_id is not null and not exists(select 1 from private.r04_goal_state where business_id=p_business_id and goal_id=p_goal_id) then raise exception 'r08_quest_unavailable'; end if;
 if jsonb_typeof(p_query) is distinct from 'object' or octet_length(p_query::text)>2048 or p_query-array['limit','offset','query','selectedId']<>'{}'::jsonb then raise exception 'r08_invalid_query'; end if;
 if p_query ? 'limit' then
  if jsonb_typeof(p_query->'limit')<>'number' or (p_query->>'limit')!~'^[0-9]+$' then raise exception 'r08_invalid_limit'; end if;
  n:=(p_query->>'limit')::integer;
 end if;
 if p_query ? 'offset' then
  if jsonb_typeof(p_query->'offset')<>'number' or (p_query->>'offset')!~'^[0-9]+$' then raise exception 'r08_invalid_offset'; end if;
  off:=(p_query->>'offset')::integer;
 end if;
 if n not between 1 and 25 or off not between 0 and 249999 then raise exception 'r08_invalid_bounds'; end if;
 if p_query ? 'query' and (jsonb_typeof(p_query->'query')<>'string' or length(p_query->>'query')>120) then raise exception 'r08_invalid_search'; end if;
 if p_query ? 'selectedId' and (jsonb_typeof(p_query->'selectedId')<>'string' or length(p_query->>'selectedId') not between 1 and 100) then raise exception 'r08_invalid_selection'; end if;
 needle:=coalesce(p_query->>'query','');selected:=p_query->>'selectedId';
 case p_dataset
 when 'decisions' then src:=$src$
 select 'notice:'||i.id id,i.business_id,public.r08_workflow_quest(i.business_id,case when i.workflow_run_id is not null and a.workflow_run_id is not null and i.workflow_run_id<>a.workflow_run_id then null else coalesce(i.workflow_run_id,a.workflow_run_id) end) goal_id,i.requested_at at,i.title label,
 jsonb_build_object('id','notice:'||i.id,'kind','owner_notice','businessId',i.business_id,'workflowRunId',case when i.workflow_run_id is not null and a.workflow_run_id is not null and i.workflow_run_id<>a.workflow_run_id then null else coalesce(i.workflow_run_id,a.workflow_run_id) end,'recordId',i.id,'title',i.title,'status',i.status,'reason',i.description,'actor','owner request','at',i.requested_at,'resolution',i.resolution) item
 from public.owner_interventions i left join public.action_intents a on a.id=i.action_intent_id and a.business_id=i.business_id
 union all
 select 'research:'||d.id,d.business_id,public.r08_workflow_quest(e.business_id,e.workflow_run_id),d.created_at,coalesce(d.assessment->>'outcome','Saved assessment'),
 jsonb_build_object('id','research:'||d.id,'kind','research_decision','businessId',d.business_id,'workflowRunId',e.workflow_run_id,'recordId',d.id,'experimentId',d.experiment_id,'title',coalesce(d.assessment->>'outcome','Saved assessment'),'status',d.assessment->>'outcome','reason',d.assessment->>'rationale','actor',d.assessment->>'assessmentOrigin','at',d.created_at,'assessment',d.assessment)
 from public.product_decisions d join public.product_experiments e on e.id=d.experiment_id and e.business_id=d.business_id
 union all
 select 'admission:'||d.id,d.business_id,public.r08_workflow_quest(d.business_id,r.workflow_run_id),d.created_at,d.decision||' '||d.reason,
 jsonb_build_object('id','admission:'||d.id,'kind','admission_decision','businessId',d.business_id,'workflowRunId',r.workflow_run_id,'recordId',d.id::text,'title',d.decision,'status',d.decision,'reason',d.reason,'actor','admission controller','at',d.created_at,'requestId',d.request_id)
 from private.r05_decisions d left join private.r05_requests r on r.id=d.request_id and r.business_id=d.business_id
 union all
 select 'policy_confirmed:'||c.policy_id,c.business_id,p.goal_id,c.created_at,'Operating policy confirmed',
 jsonb_build_object('id','policy_confirmed:'||c.policy_id,'kind','owner_policy_decision','businessId',c.business_id,'recordId',c.policy_id,'title','Operating policy confirmed','status','confirmed','reason','Exact saved policy confirmation; current authority must be checked separately','actor','owner','at',c.created_at,'policyId',c.policy_id)
 from private.r05_confirmations c join private.r05_policies p on p.id=c.policy_id and p.business_id=c.business_id
 union all
 select 'policy_revoked:'||r.policy_id,r.business_id,p.goal_id,r.created_at,'Operating policy revoked',
 jsonb_build_object('id','policy_revoked:'||r.policy_id,'kind','owner_policy_decision','businessId',r.business_id,'recordId',r.policy_id,'title','Operating policy revoked','status','revoked','reason','New admissions under this policy are revoked; prior effects and liability remain','actor','owner','at',r.created_at,'policyId',r.policy_id)
 from private.r05_revocations r join private.r05_policies p on p.id=r.policy_id and p.business_id=r.business_id
 union all
 select 'controller:'||e.id,e.business_id,e.goal_id,e.created_at,e.operation||' '||coalesce(e.payload->>'reason',''),
 jsonb_build_object('id','controller:'||e.id,'kind','controller_decision','businessId',e.business_id,'workflowRunId',e.attempt_id,'recordId',e.id::text,'title',e.operation,'status',e.payload->>'state','reason',e.payload->>'reason','actor','Quest controller','at',e.created_at,'planId',e.plan_id,'result',e.payload)
 from private.r07_events e where e.operation in ('evaluate','exception','cancel','plan')
 $src$;
 when 'products' then src:=$src$
 select a.id::text id,a.business_id,public.r08_workflow_quest(a.business_id,a.workflow_run_id) goal_id,a.created_at at,a.name label,
 jsonb_build_object('id',a.id,'kind','product_package','businessId',a.business_id,'workflowRunId',a.workflow_run_id,'title',a.name,'at',a.created_at,
 'schemaVersion',a.content->>'version','checksum',a.checksum,'candidateId',a.content->>'candidateId','creativeRunId',a.content->>'creativeRunId',
 'productIdentity',a.content->>'productIdentity','printfulResourceId',a.content->>'printfulResourceId','printfulReceiptId',a.content->>'printfulReceiptId',
 'readiness','unqualified','blockers',jsonb_build_array('Provider-neutral Product identity not qualified','Exact selling-variant linkage not qualified','Account-specific fees not qualified','Supported fulfilment not qualified'),
 'listingCount',(select count(*) from private.etsy_draft_runs d where d.owner_id=auth.uid() and d.business_id=a.business_id and d.package_artifact_id=a.id),
 'listings',coalesce((select jsonb_agg(x.item order by x.at desc,x.id desc) from(select d.id,d.approved_at at,jsonb_build_object('id',d.id,'listingId',d.state->'listingId','status',d.state->>'status') item from private.etsy_draft_runs d where d.owner_id=auth.uid() and d.business_id=a.business_id and d.package_artifact_id=a.id order by d.approved_at desc,d.id desc limit 25) x),'[]'::jsonb)) item
 from public.artifacts a where a.artifact_type='product.package.v1'
 $src$;
 when 'listings' then src:=$src$
 select d.id::text id,d.business_id,public.r08_workflow_quest(a.business_id,a.workflow_run_id) goal_id,d.approved_at at,coalesce(d.package->>'title',a.name) label,
 jsonb_build_object('id',d.id,'kind','listing','businessId',d.business_id,'workflowRunId',a.workflow_run_id,'title',coalesce(d.package->>'title',a.name),'at',d.approved_at,
 'packageArtifactId',d.package_artifact_id,'packageHash',d.package_hash,'productIdentity',d.product_identity,'connectionId',d.connection_id,'connectionRevision',d.connection_revision,'shopId',d.shop_id,'listingId',d.state->'listingId','status',d.state->>'status','reason',d.state->>'reason',
 'draftReadback',case when d.state->>'status'='verified' then 'Recorded verified draft; historical receipt, not fresh provider readback' else 'Not established' end,
 'feeReady','unqualified','fulfilmentReady','unqualified','publicSellingReady',false,
 'supplier',coalesce((select jsonb_build_object('runId',p.id,'sourceId',p.source_id,'resourceId',p.resource_id,'receiptId',p.receipt_id,'storeId',p.store_id,'connectionId',p.connection_id,'connectionRevision',p.connection_revision,'storeKind',p.source->>'storeKind','catalogVariantId',p.source->'plan'->'variantId','assetSha256',p.source->>'assetSha256','status',p.state->>'status','association','saved resource and receipt references only; cross-provider variant linkage unqualified') from private.printful_product_runs p where p.owner_id=auth.uid() and p.business_id=d.business_id and p.resource_id::text=d.package->>'printfulResourceId' and p.receipt_id::text=d.package->>'printfulReceiptId'),'null'::jsonb)) item
 from private.etsy_draft_runs d join public.artifacts a on a.id=d.package_artifact_id and a.business_id=d.business_id where d.owner_id=auth.uid()
 $src$;
 else raise exception 'r08_dataset_invalid';
 end case;
 scoped:=' from ('||src||') s where s.business_id=$1 and ($2 is null or s.goal_id=$2)';
 filtered:=scoped||' and ($3='''' or position(lower($3) in lower(s.label||'' ''||coalesce(s.item->>''reason'','''')))>0)';
 execute 'select count(*)'||filtered into total using p_business_id,p_goal_id,needle;
 execute 'select coalesce(jsonb_agg(x.item order by x.at desc,x.id desc),''[]''::jsonb) from (select s.item,s.at,s.id'||filtered||' order by s.at desc,s.id desc limit $4 offset $5) x' into items using p_business_id,p_goal_id,needle,n,off;
 -- Pages carry metadata; wide decision evidence and linked-provider details are exact-selection only.
 select coalesce(jsonb_agg(value-array['assessment','resolution','result','listings','supplier'] order by ordinal),'[]'::jsonb) into items from jsonb_array_elements(items) with ordinality x(value,ordinal);
 if selected is not null then execute 'select s.item'||scoped||' and s.id=$3' into detail using p_business_id,p_goal_id,selected; end if;
 result:=jsonb_build_object('businessId',p_business_id,'goalId',p_goal_id,'dataset',p_dataset,'items',items,'total',total,'limit',n,'offset',off,'selection',jsonb_build_object('status',case when selected is null then 'none' when detail is null then 'missing' else 'found' end,'item',detail));
 if octet_length(result::text)>262144 then raise exception 'r08_read_too_large'; end if;
 return result;
end $$;
revoke all on function public.r08_owner_read(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.r08_owner_read(uuid,uuid,text,jsonb) to authenticated;
commit;
