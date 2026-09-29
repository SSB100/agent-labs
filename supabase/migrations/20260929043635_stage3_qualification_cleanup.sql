drop function if exists public.claim_stage3_qualification_action(uuid, uuid, text, text);
drop function if exists public.release_stage3_qualification_action(uuid, uuid, text, text);
drop table if exists private.stage3_qualification_claims;

delete from public.businesses
where id in (
  '00000000-0000-4000-8000-000000003301'::uuid,
  '00000000-0000-4000-8000-000000003302'::uuid,
  '00000000-0000-4000-8000-000000003303'::uuid,
  '00000000-0000-4000-8000-000000003304'::uuid,
  '00000000-0000-4000-8000-000000003305'::uuid,
  '00000000-0000-4000-8000-000000003306'::uuid
);
