create or replace function public.record_stage5_live_model_qualification(
  p_qualification_token text,
  p_model_key text,
  p_qualification_type text,
  p_evidence jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_model_id uuid;
  v_now timestamptz := now();
  v_all_live boolean;
begin
  if p_qualification_token is null
    or encode(
      extensions.digest(convert_to(p_qualification_token, 'UTF8'), 'sha256'),
      'hex'
    ) <> '0ab257f46ee75fa19d41224c4e7c427c92637ecd02893fe82311bab9c02092a8' then
    raise exception 'Stage 5 qualification capability denied.' using errcode = '42501';
  end if;

  if p_qualification_type not in ('structured_output', 'tool_use')
    or p_evidence is null
    or jsonb_typeof(p_evidence) <> 'object' then
    raise exception 'Stage 5 qualification evidence is invalid.' using errcode = '22023';
  end if;

  select id
  into v_model_id
  from public.model_definitions
  where model_key = p_model_key
    and status = 'qualified';

  if v_model_id is null then
    raise exception 'The model is not registered as qualified.' using errcode = 'P0002';
  end if;

  update public.model_qualifications
  set
    status = 'qualified',
    evidence = evidence || p_evidence || jsonb_build_object(
      'liveValidated', true,
      'validatedAt', v_now
    ),
    checked_at = v_now,
    qualified_at = v_now,
    updated_at = v_now
  where model_definition_id = v_model_id
    and qualification_type = p_qualification_type;

  if not found then
    raise exception 'The qualification record is unavailable.' using errcode = 'P0002';
  end if;

  select bool_and(
    qualification.status = 'qualified'
    and coalesce((qualification.evidence ->> 'liveValidated')::boolean, false)
  )
  into v_all_live
  from public.model_qualifications qualification
  where qualification.model_definition_id = v_model_id;

  if coalesce(v_all_live, false) then
    update public.model_definitions
    set
      metadata = metadata || jsonb_build_object(
        'liveValidated', true,
        'liveValidatedAt', v_now
      ),
      updated_at = v_now
    where id = v_model_id;
  end if;

  return jsonb_build_object(
    'modelKey', p_model_key,
    'qualificationType', p_qualification_type,
    'liveValidated', true,
    'validatedAt', v_now
  );
end;
$$;

revoke all on function public.record_stage5_live_model_qualification(text, text, text, jsonb)
  from public, authenticated, service_role;
grant execute on function public.record_stage5_live_model_qualification(text, text, text, jsonb)
  to anon;

comment on function public.record_stage5_live_model_qualification(text, text, text, jsonb) is
  'Temporary capability-gated recorder used only for Stage 5 live model qualification.';
