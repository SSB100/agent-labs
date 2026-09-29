update public.model_qualifications
set
  evidence = (evidence - 'category' - 'message') || jsonb_build_object(
    'passed', true,
    'liveValidated', true
  ),
  status = 'qualified',
  qualified_at = coalesce(qualified_at, checked_at),
  updated_at = now()
where lower(coalesce(evidence ->> 'passed', 'false')) = 'true'
  and lower(coalesce(evidence ->> 'liveValidated', 'false')) = 'true';

with live_models as (
  select
    model_definition_id,
    max(checked_at) as live_validated_at
  from public.model_qualifications
  group by model_definition_id
  having count(*) = 2
    and bool_and(
      status = 'qualified'
      and lower(coalesce(evidence ->> 'passed', 'false')) = 'true'
      and lower(coalesce(evidence ->> 'liveValidated', 'false')) = 'true'
    )
)
update public.model_definitions model
set
  status = 'qualified',
  metadata = model.metadata || jsonb_build_object(
    'liveValidated', true,
    'liveValidatedAt', live.live_validated_at,
    'qualificationSource', 'vercel_preview_openrouter_live'
  ),
  updated_at = now()
from live_models live
where model.id = live.model_definition_id;

delete from public.businesses
where id in (
  '00000000-0000-4000-8000-000000005501'::uuid,
  '00000000-0000-4000-8000-000000005502'::uuid
);

drop function if exists public.record_stage5_live_model_qualification(
  text,
  text,
  text,
  jsonb
);

drop function if exists public.record_stage5_build_diagnostic(
  text,
  text,
  jsonb
);

drop table if exists private.stage5_build_diagnostics;

comment on table public.model_qualifications is
  'Structured-output and tool-use qualification evidence for registered models, including completed Stage 5 live OpenRouter proofs.';
