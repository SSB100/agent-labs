-- Actual 97-test quality/build gate and rolled-back owner/runtime regression passed.
do $$
declare v_pack record;
begin
  for v_pack in select id from public.packs where manifest->>'frameworkVersion'='1.0'
    and pack_key in ('capability.synthetic-transform','knowledge.synthetic-guide','worker.synthetic-summary','workflow.synthetic-summary') loop
    perform private.stage10_qualify_pack(v_pack.id,jsonb_build_object(
      'source','tests/packs.test.mjs and supabase/tests/stage10_packs.sql',
      'checks',jsonb_build_object('manifest','passed','dependencies','passed','scope','passed','version-pinning','passed','worker-output','passed'),
      'testCount',97,'build','passed','liveQualification','pending'));
  end loop;
end; $$;
