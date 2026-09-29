create table private.stage5_build_diagnostics (
  id bigint generated always as identity primary key,
  stage text not null,
  details jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now()
);

revoke all on table private.stage5_build_diagnostics from public, anon, authenticated;

create or replace function public.record_stage5_build_diagnostic(
  p_diagnostic_token text,
  p_stage text,
  p_details jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
begin
  if p_diagnostic_token is null
    or encode(
      extensions.digest(convert_to(p_diagnostic_token, 'UTF8'), 'sha256'),
      'hex'
    ) <> '912a7ba1e68e27c44ea4c5b974bac3b46bde6894d65bc5ddea05c6cbe935cb7c' then
    raise exception 'Stage 5 build diagnostic capability denied.' using errcode = '42501';
  end if;

  if p_stage is null
    or char_length(btrim(p_stage)) not between 1 and 120
    or p_details is null
    or jsonb_typeof(p_details) <> 'object' then
    raise exception 'Stage 5 build diagnostic is invalid.' using errcode = '22023';
  end if;

  insert into private.stage5_build_diagnostics (stage, details, recorded_at)
  values (btrim(p_stage), p_details, v_now);

  return jsonb_build_object('stage', btrim(p_stage), 'recordedAt', v_now);
end;
$$;

revoke all on function public.record_stage5_build_diagnostic(text, text, jsonb)
  from public, authenticated, service_role;
grant execute on function public.record_stage5_build_diagnostic(text, text, jsonb)
  to anon;
