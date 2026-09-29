do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'artifacts',
    'businesses',
    'events',
    'owner_interventions',
    'task_contracts',
    'worker_runs',
    'workflow_runs',
    'workflow_stage_runs'
  ]
  loop
    if not exists (
      select 1
      from pg_publication_tables publication_table
      where publication_table.pubname = 'supabase_realtime'
        and publication_table.schemaname = 'public'
        and publication_table.tablename = table_name
    ) then
      execute format(
        'alter publication supabase_realtime add table public.%I',
        table_name
      );
    end if;
  end loop;
end;
$$;

comment on publication supabase_realtime is
  'Publishes owner-scoped Agent Labs Core activity so the private Stage 7 UI can update through authenticated Supabase Realtime subscriptions.';
