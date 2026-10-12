-- Scope resolution is an authorization check. Its callers all discard the
-- returned JSON; financial admission independently runs under the Business lock.
-- Do not recalculate the historical finance projection at each nested boundary.
-- No grant, deadline, role timeout, row, admission guard or marker is changed.
begin;
do $patch$ declare d text;old text := $old$return jsonb_build_object('setupId',setup.id,'policyId',setup.policy_id,'templateId',t.id,'pins',t.pins,'finance',private.r12_pod_finance(s.business_id));$old$;
begin
 d:=pg_get_functiondef('private.r12_pod_scope_resolve(private.r12_discovery_scopes,timestamp with time zone,boolean)'::regprocedure);
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then
  raise exception 'r12_pod_scope_projection_patch_drift';
 end if;
 execute replace(d,old,$new$return jsonb_build_object('setupId',setup.id,'policyId',setup.policy_id,'templateId',t.id,'pins',t.pins);$new$);
end $patch$;
commit;
