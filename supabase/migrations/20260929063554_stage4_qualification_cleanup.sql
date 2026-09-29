delete from public.businesses
where id in (
  '00000000-0000-4000-8000-000000004401'::uuid,
  '00000000-0000-4000-8000-000000004402'::uuid
);
