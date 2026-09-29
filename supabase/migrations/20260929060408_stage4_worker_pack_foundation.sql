alter table public.workflow_runs
  drop constraint if exists workflow_runs_stage3_capability_required_check;

alter table public.workflow_runs
  drop constraint if exists workflow_runs_runtime_capability_required_check;

alter table public.workflow_runs
  add constraint workflow_runs_runtime_capability_required_check check (
    workflow_definition_id not in (
      '00000000-0000-4000-8000-000000000301'::uuid,
      '00000000-0000-4000-8000-000000000403'::uuid
    )
    or runtime_capability_hash is not null
  );

insert into public.packs (
  id, pack_key, version, name, kind, status, manifest
)
values (
  '00000000-0000-4000-8000-000000000401',
  'worker.generic-researcher-fixture',
  '1.0.0',
  'Generic Researcher Fixture',
  'worker',
  'experimental',
  '{"manifestVersion":"1.0","packKey":"worker.generic-researcher-fixture","version":"1.0.0","name":"Generic Researcher Fixture","worker":{"workerKey":"generic.researcher.fixture","version":"1.0.0","role":"Generic Researcher","charter":"Collect only the evidence requested by the Task Contract, clearly separate evidence from inference, use only referenced artifacts, and stop immediately when the completion criteria are satisfied."},"inputSchema":{"type":"object","additionalProperties":false,"required":["taskContract","inputArtifacts"],"properties":{"taskContract":{"type":"object","additionalProperties":false,"required":["id","objective","inputArtifactIds","permittedCapabilities","requiredKnowledge","requiredOutputSchema","completionCriteria","failureCriteria","nonGoals","escalationRules"],"properties":{"id":{"type":"string","format":"uuid"},"objective":{"type":"string","minLength":1,"maxLength":4000},"inputArtifactIds":{"type":"array","minItems":1,"uniqueItems":true,"items":{"type":"string","format":"uuid"}},"permittedCapabilities":{"type":"array","maxItems":0,"items":{"type":"string"}},"requiredKnowledge":{"type":"array","minItems":1,"uniqueItems":true,"items":{"type":"string"}},"requiredOutputSchema":{"type":"object"},"completionCriteria":{"type":"object"},"failureCriteria":{"type":"object"},"nonGoals":{"type":"array","minItems":1,"uniqueItems":true,"items":{"type":"string"}},"escalationRules":{"type":"object"}}},"inputArtifacts":{"type":"array","minItems":1,"uniqueItems":true,"items":{"type":"object","additionalProperties":false,"required":["id","artifactType","name","mediaType","content","metadata"],"properties":{"id":{"type":"string","format":"uuid"},"artifactType":{"type":"string","minLength":1},"name":{"type":"string","minLength":1},"mediaType":{"type":"string","minLength":1},"content":{"type":"object"},"metadata":{"type":"object"}}}}}},"outputSchema":{"type":"object","additionalProperties":false,"required":["decision","summary","findings","evidenceCount","usedArtifactIds","stopReason","scopeBoundary"],"properties":{"decision":{"type":"string","const":"complete"},"summary":{"type":"string","minLength":1,"maxLength":1000},"findings":{"type":"array","minItems":3,"items":{"type":"object","additionalProperties":false,"required":["signalId","evidence","inference","evidenceArtifactId"],"properties":{"signalId":{"type":"string","minLength":1,"maxLength":120},"evidence":{"type":"string","minLength":1,"maxLength":500},"inference":{"type":"string","minLength":1,"maxLength":500},"evidenceArtifactId":{"type":"string","format":"uuid"}}}},"evidenceCount":{"type":"integer","minimum":3},"usedArtifactIds":{"type":"array","minItems":1,"uniqueItems":true,"items":{"type":"string","format":"uuid"}},"stopReason":{"type":"string","const":"completion_criteria_satisfied"},"scopeBoundary":{"type":"string","const":"task_contract_only"}}},"capabilityPolicy":{"allowed":[],"forbidden":["browser.interact","money.spend","marketplace.publish","shell.execute"]},"knowledgeRequirements":["fixture.synthetic-market-signals"],"modelRequirements":{"executionMode":"deterministic_fixture","modelRouterRequired":false,"structuredOutput":true},"instructions":["Read only the Task Contract and artifacts explicitly supplied with it.","Represent each source observation as evidence and keep inference in a separate field.","Do not choose a business strategy, create a product, publish, browse or request hidden context.","Stop after every referenced signal has been represented and the completion criteria are satisfied."],"examples":[{"name":"bounded evidence completion","input":{"objective":"Summarise three supplied signals without recommending a strategy.","signalCount":3},"expectedOutput":{"decision":"complete","evidenceCount":3,"stopReason":"completion_criteria_satisfied"}}],"negativeExamples":[{"name":"unbounded research","forbiddenBehaviour":"Continue searching after all supplied evidence satisfies the contract.","reason":"The worker must stop on completion and has no research capability in this fixture."},{"name":"strategy selection","forbiddenBehaviour":"Recommend a final business or product strategy.","reason":"Strategy selection belongs to a different specialist worker."}],"escalationPolicy":{"validationFailure":"fail_task","unavailableKnowledge":"fail_task","unexpectedFailure":"classify_and_stop"}}'::jsonb
)
on conflict (pack_key, version) do update
set
  name = excluded.name,
  kind = excluded.kind,
  status = excluded.status,
  manifest = excluded.manifest,
  updated_at = now();

insert into public.worker_definitions (
  id,
  pack_id,
  worker_key,
  version,
  name,
  role,
  charter,
  status,
  input_schema,
  output_schema,
  knowledge_requirements,
  capability_requirements,
  model_requirements
)
values (
  '00000000-0000-4000-8000-000000000402',
  '00000000-0000-4000-8000-000000000401',
  'generic.researcher.fixture',
  '1.0.0',
  'Generic Researcher Fixture',
  'Generic Researcher',
  'Collect only the evidence requested by the Task Contract, clearly separate evidence from inference, use only referenced artifacts, and stop immediately when the completion criteria are satisfied.',
  'experimental',
  '{"type":"object","additionalProperties":false,"required":["taskContract","inputArtifacts"],"properties":{"taskContract":{"type":"object","additionalProperties":false,"required":["id","objective","inputArtifactIds","permittedCapabilities","requiredKnowledge","requiredOutputSchema","completionCriteria","failureCriteria","nonGoals","escalationRules"],"properties":{"id":{"type":"string","format":"uuid"},"objective":{"type":"string","minLength":1,"maxLength":4000},"inputArtifactIds":{"type":"array","minItems":1,"uniqueItems":true,"items":{"type":"string","format":"uuid"}},"permittedCapabilities":{"type":"array","maxItems":0,"items":{"type":"string"}},"requiredKnowledge":{"type":"array","minItems":1,"uniqueItems":true,"items":{"type":"string"}},"requiredOutputSchema":{"type":"object"},"completionCriteria":{"type":"object"},"failureCriteria":{"type":"object"},"nonGoals":{"type":"array","minItems":1,"uniqueItems":true,"items":{"type":"string"}},"escalationRules":{"type":"object"}}},"inputArtifacts":{"type":"array","minItems":1,"uniqueItems":true,"items":{"type":"object","additionalProperties":false,"required":["id","artifactType","name","mediaType","content","metadata"],"properties":{"id":{"type":"string","format":"uuid"},"artifactType":{"type":"string","minLength":1},"name":{"type":"string","minLength":1},"mediaType":{"type":"string","minLength":1},"content":{"type":"object"},"metadata":{"type":"object"}}}}}}'::jsonb,
  '{"type":"object","additionalProperties":false,"required":["decision","summary","findings","evidenceCount","usedArtifactIds","stopReason","scopeBoundary"],"properties":{"decision":{"type":"string","const":"complete"},"summary":{"type":"string","minLength":1,"maxLength":1000},"findings":{"type":"array","minItems":3,"items":{"type":"object","additionalProperties":false,"required":["signalId","evidence","inference","evidenceArtifactId"],"properties":{"signalId":{"type":"string","minLength":1,"maxLength":120},"evidence":{"type":"string","minLength":1,"maxLength":500},"inference":{"type":"string","minLength":1,"maxLength":500},"evidenceArtifactId":{"type":"string","format":"uuid"}}}},"evidenceCount":{"type":"integer","minimum":3},"usedArtifactIds":{"type":"array","minItems":1,"uniqueItems":true,"items":{"type":"string","format":"uuid"}},"stopReason":{"type":"string","const":"completion_criteria_satisfied"},"scopeBoundary":{"type":"string","const":"task_contract_only"}}}'::jsonb,
  '["fixture.synthetic-market-signals"]'::jsonb,
  '[]'::jsonb,
  '{"executionMode":"deterministic_fixture","modelRouterRequired":false,"structuredOutput":true}'::jsonb
)
on conflict (pack_id, worker_key, version) do update
set
  name = excluded.name,
  role = excluded.role,
  charter = excluded.charter,
  status = excluded.status,
  input_schema = excluded.input_schema,
  output_schema = excluded.output_schema,
  knowledge_requirements = excluded.knowledge_requirements,
  capability_requirements = excluded.capability_requirements,
  model_requirements = excluded.model_requirements,
  updated_at = now();

insert into public.workflow_definitions (
  id,
  pack_id,
  workflow_key,
  version,
  name,
  description,
  status,
  input_schema,
  output_schema,
  stage_definition
)
values (
  '00000000-0000-4000-8000-000000000403',
  '00000000-0000-4000-8000-000000000201',
  'synthetic.worker-pack.runtime-proof',
  '1.0.0',
  'Synthetic Worker Pack Runtime Proof',
  'Stage 4 proof that one bounded Generic Researcher Worker Pack executes only a Task Contract and referenced artifacts, validates output and records a receipt.',
  'experimental',
  '{"type":"object","required":["businessId","coreWorkflowRunId","runtimeCapability","fixtureMode"],"additionalProperties":false}'::jsonb,
  '{"type":"object","required":["coreWorkflowRunId","runtimeRunId","status","workerOutput","workerReceipt"],"additionalProperties":false}'::jsonb,
  '{"stages":[{"key":"start","type":"system","sequence":0},{"key":"task-contract","type":"contract","sequence":1},{"key":"worker","type":"worker","sequence":2},{"key":"validate","type":"validation","sequence":3},{"key":"complete","type":"terminal","sequence":4}]}'::jsonb
)
on conflict (pack_id, workflow_key, version) do update
set
  name = excluded.name,
  description = excluded.description,
  status = excluded.status,
  input_schema = excluded.input_schema,
  output_schema = excluded.output_schema,
  stage_definition = excluded.stage_definition,
  updated_at = now();

create or replace function private.stage4_deterministic_uuid(p_value text)
returns uuid
language sql
immutable
strict
set search_path = ''
as $$
  select (
    substr(md5(p_value), 1, 8) || '-' ||
    substr(md5(p_value), 9, 4) || '-' ||
    '5' || substr(md5(p_value), 14, 3) || '-' ||
    'a' || substr(md5(p_value), 18, 3) || '-' ||
    substr(md5(p_value), 21, 12)
  )::uuid;
$$;

revoke all on function private.stage4_deterministic_uuid(text)
  from public, anon, authenticated;

create or replace function public.begin_worker_pack_workflow_run(
  p_business_id uuid,
  p_idempotency_key text,
  p_launch_nonce uuid,
  p_runtime_capability text,
  p_fixture_mode text default 'valid'
)
returns table (
  workflow_run_id uuid,
  should_start boolean,
  runtime_launch_status text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_workflow_run_id uuid;
  v_launch_status text;
begin
  if not private.is_business_owner(p_business_id) then
    raise exception 'Business ownership is required.' using errcode = '42501';
  end if;

  if p_launch_nonce is null then
    raise exception 'A launch nonce is required.' using errcode = '22023';
  end if;

  if p_runtime_capability is null
    or char_length(p_runtime_capability) < 32
    or char_length(p_runtime_capability) > 512 then
    raise exception 'The runtime capability is invalid.' using errcode = '22023';
  end if;

  if p_fixture_mode not in ('valid', 'invalid-output') then
    raise exception 'The fixture mode is invalid.' using errcode = '22023';
  end if;

  if p_idempotency_key is null
    or char_length(btrim(p_idempotency_key)) < 1
    or char_length(btrim(p_idempotency_key)) > 200 then
    raise exception 'The idempotency key is invalid.' using errcode = '22023';
  end if;

  insert into public.workflow_runs (
    business_id,
    workflow_definition_id,
    status,
    current_stage_key,
    idempotency_key,
    input,
    state,
    runtime_provider,
    runtime_launch_status,
    runtime_launch_nonce,
    runtime_launch_reserved_at,
    runtime_capability_hash
  )
  values (
    p_business_id,
    '00000000-0000-4000-8000-000000000403',
    'queued',
    null,
    btrim(p_idempotency_key),
    jsonb_build_object('fixtureMode', p_fixture_mode),
    jsonb_build_object(
      'runtime', 'vercel_workflow',
      'workerKey', 'generic.researcher.fixture',
      'workerVersion', '1.0.0'
    ),
    'vercel_workflow',
    'reserved',
    p_launch_nonce,
    now(),
    encode(
      extensions.digest(convert_to(p_runtime_capability, 'UTF8'), 'sha256'),
      'hex'
    )
  )
  on conflict (business_id, idempotency_key) do nothing
  returning id, workflow_runs.runtime_launch_status
  into v_workflow_run_id, v_launch_status;

  if v_workflow_run_id is not null then
    insert into public.events (
      id, business_id, workflow_run_id, event_type, actor_type, payload
    )
    values (
      private.stage4_deterministic_uuid(
        'event:' || v_workflow_run_id::text || ':workflow.queued'
      ),
      p_business_id,
      v_workflow_run_id,
      'workflow.queued',
      'owner',
      jsonb_build_object('workflowKey', 'synthetic.worker-pack.runtime-proof')
    )
    on conflict (id) do nothing;

    return query select v_workflow_run_id, true, v_launch_status;
    return;
  end if;

  select id, workflow_runs.runtime_launch_status
  into v_workflow_run_id, v_launch_status
  from public.workflow_runs
  where business_id = p_business_id
    and idempotency_key = btrim(p_idempotency_key);

  return query select v_workflow_run_id, false, v_launch_status;
end;
$$;

revoke all on function public.begin_worker_pack_workflow_run(uuid, text, uuid, text, text)
  from public, anon;
grant execute on function public.begin_worker_pack_workflow_run(uuid, text, uuid, text, text)
  to authenticated;
