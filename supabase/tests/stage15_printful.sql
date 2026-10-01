-- Run after Stage15 migration. Pure registry checks; no account or provider access.
begin;
do $$
declare p public.packs; c public.pack_capability_definitions; n integer;
begin
  select * into strict p from public.packs where pack_key='capability.printful' and version='1.0.0';
  assert p.status='experimental', 'Printful must remain experimental';
  assert jsonb_array_length(p.manifest->'workers')=0 and jsonb_array_length(p.manifest->'workflows')=0, 'Foundation must not install live workers';
  select * into strict c from public.pack_capability_definitions where pack_id=p.id;
  assert c.adapter='printful.foundation' and c.capability_key='fulfilment.print', 'Exact trusted adapter required';
  select count(*) into n from public.worker_definitions where pack_id=p.id;
  assert n=0, 'No Printful worker may be installed';
  select count(*) into n from public.workflow_definitions where pack_id=p.id;
  assert n=0, 'No Printful workflow may be installed';
  assert not has_function_privilege('authenticated','private.stage10_register_pack(jsonb)','execute'), 'Client registration must remain revoked';
  assert not has_function_privilege('anon','private.stage10_register_pack(jsonb)','execute'), 'Anonymous registration must remain revoked';
end $$;
rollback;
