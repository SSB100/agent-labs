alter table public.workflow_stage_runs
  add constraint workflow_stage_runs_identity_unique
  unique (id, workflow_run_id, business_id);

alter table public.task_contracts
  add constraint task_contracts_workflow_identity_unique
  unique (id, workflow_run_id, business_id);

alter table public.task_contracts
  add constraint task_contracts_execution_identity_unique
  unique (id, workflow_run_id, business_id, worker_definition_id);

alter table public.task_contracts
  drop constraint task_contracts_stage_fk;

alter table public.task_contracts
  add constraint task_contracts_stage_fk
  foreign key (workflow_stage_run_id, workflow_run_id, business_id)
  references public.workflow_stage_runs(id, workflow_run_id, business_id)
  on delete cascade;

alter table public.worker_runs
  drop constraint worker_runs_task_contract_fk;

alter table public.worker_runs
  add constraint worker_runs_task_contract_fk
  foreign key (
    task_contract_id,
    workflow_run_id,
    business_id,
    worker_definition_id
  )
  references public.task_contracts(
    id,
    workflow_run_id,
    business_id,
    worker_definition_id
  )
  on delete cascade;

alter table public.artifacts
  add constraint artifacts_task_contract_requires_workflow
  check (task_contract_id is null or workflow_run_id is not null);

alter table public.artifacts
  drop constraint artifacts_task_contract_fk;

alter table public.artifacts
  add constraint artifacts_task_contract_fk
  foreign key (task_contract_id, workflow_run_id, business_id)
  references public.task_contracts(id, workflow_run_id, business_id)
  on delete cascade;

alter table public.action_intents
  add constraint action_intents_task_contract_requires_workflow
  check (task_contract_id is null or workflow_run_id is not null);

alter table public.action_intents
  drop constraint action_intents_task_contract_fk;

alter table public.action_intents
  add constraint action_intents_task_contract_fk
  foreign key (task_contract_id, workflow_run_id, business_id)
  references public.task_contracts(id, workflow_run_id, business_id)
  on delete cascade;

alter table public.action_intents
  add constraint action_intents_workflow_identity_unique
  unique (id, workflow_run_id, business_id);

alter table public.owner_interventions
  add constraint owner_interventions_action_workflow_fk
  foreign key (action_intent_id, workflow_run_id, business_id)
  references public.action_intents(id, workflow_run_id, business_id)
  on delete cascade;
