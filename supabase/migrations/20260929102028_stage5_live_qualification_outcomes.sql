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
  v_passed boolean := false;
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

  if lower(coalesce(p_evidence ->> 'passed', 'false')) = 'true' then
    v_passed := true;
  end if;

  select id
  into v_model_id
  from public.model_definitions
  where model_key = p_model_key;

  if v_model_id is null then
    raise exception 'The model is not registered.' using errcode = 'P0002';
  end if;

  update public.model_qualifications
  set
    status = case when v_passed then 'qualified' else 'failed' end,
    evidence = evidence || p_evidence || jsonb_build_object(
      'liveValidated', v_passed,
      'validatedAt', v_now
    ),
    checked_at = v_now,
    qualified_at = case when v_passed then v_now else null end,
    updated_at = v_now
  where model_definition_id = v_model_id
    and qualification_type = p_qualification_type;

  if not found then
    raise exception 'The qualification record is unavailable.' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'modelKey', p_model_key,
    'qualificationType', p_qualification_type,
    'passed', v_passed,
    'validatedAt', v_now
  );
end;
$$;
