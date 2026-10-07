/** REVIEWED OPERATOR RECIPE. Import is side-effect-free: no client, environment,
 * secrets, keys, provider request, approval or dispatch is created automatically.
 * Execution needs a dedicated approved operator client and the exact reviewed
 * post-TEST input. Installation grants no workflow or financial authority.
 */
export const TARGET=Object.freeze({
 businessId:'91ff7c87-60e4-4dbb-8e84-be63b53c2c79',
 ownerId:'1b9642c5-3e08-478a-b215-4c095d2f4e58',
 packId:'a236d30d-b453-4e94-8d34-4615d21b300a',
 snapshotHash:'c70ab401742dc8491da8d5dcfb25d783cabdc8f24eae3b8c71d4d04cd7ea6f61',
 catalogHash:'8f62a79e34297742b4cb5fbc64c3a64f20d28bcf4aa2c1dad633b64427d7d9ef'
});
const tables=[['packs','packs','id'],['workflowDefinitions','workflow_definitions','pack_id'],['workerDefinitions','worker_definitions','pack_id'],['knowledgeDefinitions','pack_knowledge_definitions','pack_id'],['capabilityDefinitions','pack_capability_definitions','pack_id']];
const catalogFor=releases=>`jsonb_build_object(${tables.map(([key,table,column])=>`'${key}',coalesce((select jsonb_agg(to_jsonb(row) order by row.id) from public.${table} row where row.${column} in(select (item->>'id')::uuid from jsonb_array_elements(${releases}) item)),'[]'::jsonb)`).join(',')})`;
/** Read-only evidence collection; never copy fresh hashes over reviewed pins. */
export const CATALOG_PINS_SQL=`with resolved as (
 select jsonb_build_object('rootPackId','${TARGET.packId}'::uuid,'releases',private.stage10_resolve('${TARGET.packId}'::uuid,true)) snapshot
), catalog as(select snapshot,${catalogFor("snapshot->'releases'")} value from resolved)
select '${TARGET.businessId}'::uuid business_id,(select owner_user_id from public.businesses where id='${TARGET.businessId}') owner_id,
 private.stage14_hash(snapshot) snapshot_hash,private.stage14_hash(value) catalog_hash,
 jsonb_array_length(snapshot->'releases') release_count,
 (select jsonb_agg(jsonb_build_object('id',item->'id','packKey',item->'manifest'->'packKey','status',item->'status') order by item->'manifest'->>'packKey') from jsonb_array_elements(snapshot->'releases') item) releases
from catalog;`;
export const INSTALL_SQL=`DO $r12_install$ <<recipe>> DECLARE
 x jsonb;a private.r12_focused_adoptions;c public.product_candidates;d public.product_decisions;e public.product_experiments;
 b constant uuid:='${TARGET.businessId}';owner_id constant uuid:='${TARGET.ownerId}';pack_id constant uuid:='${TARGET.packId}';
 iid uuid;event_id uuid;snapshot jsonb;catalog jsonb;field text;cutoff timestamptz;receipt jsonb;
BEGIN
 if current_user in ('anon','authenticated','service_role') then raise exception 'r12_creative_install_operator_required';end if;
 select payload into strict x from pg_temp.r12_bootstrap_input;
 if jsonb_typeof(x) is distinct from 'object' or octet_length(x::text)>16384 then raise exception 'r12_creative_install_input';end if;
 perform private.r12_pilot_safe(x);
 perform private.r04_keys(x,array['version','businessId','ownerId','adoptionId','adoptionProofHash','resultHash','installationId','snapshotHash','catalogHash','approvalHash','independentReviewHash','installBy','installForFocusedPrivateLearning','dispatchAuthorized']);
 if x->>'version' is distinct from 'r12.focused-creative-install.1' or x->>'businessId' is distinct from b::text
 or x->>'ownerId' is distinct from owner_id::text or x->'installForFocusedPrivateLearning' is distinct from 'true'::jsonb
 or x->'dispatchAuthorized' is distinct from 'false'::jsonb then raise exception 'r12_creative_install_exact_target_required';end if;
 foreach field in array array['adoptionProofHash','resultHash','snapshotHash','catalogHash','approvalHash','independentReviewHash'] loop
  if jsonb_typeof(x->field) is distinct from 'string' or not coalesce(x->>field ~ '^[a-f0-9]{64}$',false) then raise exception 'r12_creative_install_review_hash_required: %',field;end if;
 end loop;
 if x->>'snapshotHash' is distinct from '${TARGET.snapshotHash}' or x->>'catalogHash' is distinct from '${TARGET.catalogHash}' then raise exception 'r12_creative_install_reviewed_catalog_required';end if;
 perform 1 from public.businesses where id=b and owner_user_id=owner_id for update;
 if not found then raise exception 'r12_creative_install_owner_changed';end if;
 select * into a from private.r12_focused_adoptions where id=(x->>'adoptionId')::uuid and business_id=b and actor_id=owner_id;
 if a.id is null or a.proof_hash is distinct from x->>'adoptionProofHash' or private.stage14_hash(a.result) is distinct from x->>'resultHash'
 then raise exception 'r12_creative_install_exact_adopted_test_required';end if;
 a:=private.r12_focused_adoption_current(a.id);
 select * into c from public.product_candidates where id=a.candidate_id and business_id=b;
 select * into d from public.product_decisions where id=a.decision_id and business_id=b and candidate_id=a.candidate_id and focused_adoption_id=a.id;
 select * into e from public.product_experiments where id=a.experiment_id and business_id=b and candidate_id=a.candidate_id and status='completed';
 if c.id is null or d.id is null or e.id is null or d.experiment_id is distinct from e.id or d.assessment is distinct from a.result->'review'
 or a.result->'review'->>'outcome' is distinct from 'TEST' or a.proof->'maximumGenerations' is distinct from '1'::jsonb
 or a.proof->'executionAuthorized' is distinct from 'false'::jsonb or a.proof->'publicationAllowed' is distinct from 'false'::jsonb or a.proof->'commerceAllowed' is distinct from 'false'::jsonb
 or (a.proof->>'maximumCreativeProposalMicrousd')::bigint not between 1 and 370494
 or private.stage14_hash(jsonb_build_object('id',c.id,'businessId',c.business_id,'concept',c.concept,'audience',c.audience,'productType',c.product_type,'originalDesign',c.original_design,'rightsStatus',c.rights_status)) is distinct from a.proof->>'candidateIdentityHash'
 or exists(select 1 from public.product_decisions later where later.business_id=b and later.candidate_id=c.id and later.id<>d.id and later.created_at>=d.created_at)
 or exists(select 1 from public.product_experiments later where later.business_id=b and later.candidate_id=c.id and later.id<>e.id and later.status='completed' and later.created_at>=e.created_at)
 then raise exception 'r12_creative_install_current_test_required';end if;
 cutoff:=(x->>'installBy')::timestamptz;
 if jsonb_typeof(x->'installBy') is distinct from 'string' or cutoff is null or not isfinite(cutoff)
 or cutoff>least((a.proof->>'expiresAt')::timestamptz,clock_timestamp()+interval '1 day')
 or cutoff<clock_timestamp()+interval '60 minutes' then raise exception 'r12_creative_install_full_window_required';end if;
 iid:=private.stage4_deterministic_uuid('r12:focused-creative-installation:'||a.id);
 event_id:=private.stage4_deterministic_uuid('r12:focused-creative-installation-review:'||a.id);
 if x->>'installationId' is distinct from iid::text then raise exception 'r12_creative_install_identity_required';end if;
 if private.r05_paused(b,'business',b) or private.r05_paused(b,'quest',(a.proof->>'goalId')::uuid) or private.r05_paused(b,'pack',iid)
 then raise exception 'r12_creative_install_scope_paused';end if;
 if exists(select 1 from public.installed_packs where id=iid or business_id=b and (root_pack_id=pack_id or root_pack_key='workflow.etsy-creative-pipeline'))
 or exists(select 1 from public.events where id=event_id)
 or exists(select 1 from public.creative_approvals where business_id=b and candidate_id=a.candidate_id)
 then raise exception 'r12_creative_install_already_present_readback_required';end if;
 -- Lock the same registered rows whose complete bytes are reviewed; resolution
 -- is repeated after all locks. This never qualifies or rewrites a release.
 perform 1 from public.packs where id=pack_id and pack_key='workflow.etsy-creative-pipeline' and version='1.0.0' and status='experimental' for share;
 if not found then raise exception 'r12_creative_install_experimental_root_required';end if;
 snapshot:=jsonb_build_object('rootPackId',pack_id,'releases',private.stage10_resolve(pack_id,true));
 ${tables.map(([,table,column])=>`perform 1 from public.${table} row where row.${column} in(select (item->>'id')::uuid from jsonb_array_elements(snapshot->'releases') item) order by row.id for share;`).join('\n ')}
 snapshot:=jsonb_build_object('rootPackId',pack_id,'releases',private.stage10_resolve(pack_id,true));
 catalog:=${catalogFor("snapshot->'releases'")};
 if private.stage14_hash(snapshot) is distinct from x->>'snapshotHash' or private.stage14_hash(catalog) is distinct from x->>'catalogHash'
 or (select count(*) from jsonb_array_elements(snapshot->'releases') item where item->'manifest'->>'packKey' in ('capability.image-generation','worker.etsy-creative-director','worker.etsy-creative-reviewer','workflow.etsy-creative-pipeline') and item->>'status'='experimental')<>4
 then raise exception 'r12_creative_install_catalog_drift';end if;
 insert into public.installed_packs(id,business_id,root_pack_id,root_pack_key,status,snapshot)
 values(iid,b,pack_id,'workflow.etsy-creative-pipeline','active',snapshot);
 receipt:=jsonb_build_object('version','r12.focused-creative-install-receipt.1','businessId',b,'ownerId',owner_id,'installationId',iid,
 'adoptionId',a.id,'adoptionProofHash',a.proof_hash,'resultHash',private.stage14_hash(a.result),'scopeId',a.scope_id,
 'candidateId',a.candidate_id,'goalId',a.proof->'goalId','snapshotHash',x->'snapshotHash','catalogHash',x->'catalogHash',
 'reviewInputHash',private.stage14_hash(x),'installBy',x->'installBy','authorityCreated',false,'shouldDispatch',false,'providerCalls',0);
 insert into public.events(id,business_id,event_type,actor_type,payload)
 values(event_id,b,'r12.focused.creative.installation_reviewed','system',jsonb_build_object('review',x,'receipt',receipt));
 insert into pg_temp.r12_bootstrap_result values(receipt);
END $r12_install$;`;
/** Dedicated client, no surrounding transaction; no retry or upsert. An uncertain
 * commit must be reconciled by readback, never by changing the installation ID.
 * No session claims or database roles are set by this module. */
export async function runOperatorRecipe(client,kind,input){
 if(kind!=='install')throw Error('Unknown creative installation recipe');
 await client.query('begin');
 try{
  await client.query("set local timezone='UTC'; set local lock_timeout='5s'; set local statement_timeout='30s'");
  await client.query('create temporary table r12_bootstrap_input(payload jsonb not null) on commit drop; create temporary table r12_bootstrap_result(payload jsonb not null) on commit drop');
  await client.query('insert into pg_temp.r12_bootstrap_input(payload) values($1::jsonb)',[JSON.stringify(input)]);
  await client.query(INSTALL_SQL);
  const result=(await client.query('select payload from pg_temp.r12_bootstrap_result')).rows;
  if(result.length!==1)throw Error('Unexpected creative installation result');
  await client.query('commit');return result[0].payload;
 }catch(error){await client.query('rollback').catch(()=>{});throw error;}
}
