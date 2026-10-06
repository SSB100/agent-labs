-- Align callable legacy research entry points with the R05/R12 lock order.
-- Matching capability is checked before taking the Business lock and rechecked
-- by the original locked workflow lookup. No permission, limit or grant changes.
begin;
do $migration$
declare signature text; definition text; old text; replacement text; begin
 old:=$old$  if coalesce(length(p_runtime_capability),0) not between 32 and 512 then raise exception 'Product runtime capability denied.' using errcode='42501'; end if;
  select * into r from public.workflow_runs where id=p_workflow_run_id and business_id=p_business_id and runtime_capability_hash=private.stage13_hash(p_runtime_capability) for update;$old$;
 replacement:=$new$  if coalesce(length(p_runtime_capability),0) not between 32 and 512 then raise exception 'Product runtime capability denied.' using errcode='42501'; end if;
  -- Business before workflow/round/shared root, including direct legacy RPCs.
  perform 1 from public.businesses b where b.id=p_business_id and exists(select 1 from public.workflow_runs w where w.id=p_workflow_run_id and w.business_id=b.id and w.runtime_capability_hash=private.stage13_hash(p_runtime_capability)) for update;
  if not found then raise exception 'Product runtime capability denied.' using errcode='42501';end if;
  select * into r from public.workflow_runs where id=p_workflow_run_id and business_id=p_business_id and runtime_capability_hash=private.stage13_hash(p_runtime_capability) for update;$new$;
 foreach signature in array array['public.reserve_product_research_cost(uuid,uuid,text,text,integer,text,jsonb)','public.record_product_research_cost(uuid,uuid,text,text,integer,text)'] loop
 definition:=pg_get_functiondef(signature::regprocedure);
 if (length(definition)-length(replace(definition,old,'')))/length(old)<>1 then raise exception 'r12_research_lock_definition_drift';end if;
 execute replace(definition,old,replacement);
 end loop;
end $migration$;
commit;
