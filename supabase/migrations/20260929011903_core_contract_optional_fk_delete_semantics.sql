alter table public.evidence
  drop constraint evidence_artifact_fk;

alter table public.evidence
  add constraint evidence_artifact_fk
  foreign key (artifact_id, business_id)
  references public.artifacts(id, business_id)
  on delete set null (artifact_id);

alter table public.action_receipts
  drop constraint action_receipts_external_resource_fk;

alter table public.action_receipts
  add constraint action_receipts_external_resource_fk
  foreign key (external_resource_id, business_id)
  references public.external_resources(id, business_id)
  on delete set null (external_resource_id);
