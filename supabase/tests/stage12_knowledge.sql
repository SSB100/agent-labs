-- Run after the Stage 12 catalog migration. Assertions only; all session changes roll back.
begin;
do $$
declare
  root_id uuid;
  closure jsonb;
  worker jsonb;
  knowledge jsonb;
  expected_keys text[] := array[
    'knowledge.etsy-selling','knowledge.etsy-current-policy','knowledge.print-on-demand',
    'knowledge.product-research','knowledge.social-marketing','worker.etsy-market-researcher',
    'worker.etsy-product-strategist','worker.etsy-reviewer','workflow.etsy-product-discovery'
  ];
begin
  if (select count(*) from public.packs where pack_key=any(expected_keys) and version='1.0.0')<>9 then
    raise exception 'Stage 12 must register exactly nine version 1.0.0 releases.';
  end if;
  if exists(select 1 from public.packs where pack_key=any(expected_keys) and version='1.0.0' and status<>'experimental') then
    raise exception 'Simulation must not promote live pack competence.';
  end if;
  select id into strict root_id from public.packs where pack_key='workflow.etsy-product-discovery' and version='1.0.0';
  closure := private.stage10_resolve(root_id,true);
  if jsonb_array_length(closure)<>9 then raise exception 'Exact Stage 12 dependency closure is incomplete.'; end if;
  begin
    perform private.stage10_resolve(root_id,false);
    raise exception 'Unqualified live activation unexpectedly resolved.';
  exception when others then
    if sqlerrm='Unqualified live activation unexpectedly resolved.' then raise; end if;
  end;
  for knowledge in select value from public.packs p cross join lateral jsonb_array_elements(p.manifest->'knowledge')
    where p.pack_key=any(expected_keys) and p.version='1.0.0' loop
    if knowledge->>'source' not like 'https://%' or knowledge->>'version'<>'1.0.0'
      or (knowledge->>'freshnessDays')::integer not between 1 and 90
      or jsonb_array_length(knowledge->'content'->'guidelines')<5 then
      raise exception 'Knowledge provenance or substantive guidelines are missing.';
    end if;
  end loop;
  for worker in select value from public.packs p cross join lateral jsonb_array_elements(p.manifest->'workers')
    where p.pack_key=any(expected_keys) and p.version='1.0.0' loop
    if worker->'manifest'->'capabilityPolicy'->'allowed'<>'[]'::jsonb
      or worker->'manifest'->'modelRequirements'->>'qualificationScope'<>'simulation_only' then
      raise exception 'Stage 12 worker gained external execution authority.';
    end if;
  end loop;
  if (select manifest->'workers'->0->'execution'->>'routeKey' from public.packs
    where pack_key='worker.etsy-reviewer' and version='1.0.0')<>'reviewer.independent' then
    raise exception 'Reviewer must retain its independent route.';
  end if;
  if (select count(*) from public.pack_knowledge_definitions k join public.packs p on p.id=k.pack_id
    where p.pack_key=any(expected_keys) and p.version='1.0.0')<>5 then
    raise exception 'Knowledge definitions were not installed.';
  end if;
end $$;
rollback;
