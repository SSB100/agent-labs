-- Definition-only recovery send fence. Generic send and every existing full
-- validation remain unchanged; no timeout, permission or authority is widened.
begin;
do $patch$
declare d text;old text;replacement text;begin
 d:=pg_get_functiondef('public.r12_discovery_server(uuid,uuid,text,jsonb,text)'::regprocedure);
 old:=$old$ perform private.r12_discovery_key(key_hash);return jsonb_build_object('shouldDispatch',true,'reason','claimed_once');$old$;
 replacement:=$new$ perform private.r12_discovery_key(key_hash);
 -- Full source/financial/wire checks above can consume the remaining lease or
 -- quote lifetime. Recheck only advancing time after the final claim/FK write.
 -- A failure rolls that one-shot claim back before any transport permission.
 if exists(select 1 from private.r12_pilot_unsent_recovery_authorizations where scope_id=w.scope_id and business_id=p_business_id) then
 if not exists(
 select 1 from private.r12_discovery_authorities authority
 join private.r07_heads head on head.business_id=authority.business_id and head.goal_id=authority.goal_id and head.plan_id=p.id
 join private.r07_markers marker on marker.attempt_id=a.id and marker.business_id=p_business_id and marker.lease_epoch=head.lease_epoch
 where authority.scope_id=w.scope_id and authority.business_id=p_business_id and authority.goal_id=a.goal_id
 and authority.plan_hash=p.content_hash and authority.plan=p.content and authority.controller_key_hash=key_hash
 and authority.valid_until>clock_timestamp() and authority.receipt_until>clock_timestamp()
 and head.lease_expires_at>clock_timestamp()
 and (p.content->>'deadline')::timestamptz>clock_timestamp() and (p.content->>'expiresAt')::timestamptz>clock_timestamp()
 and (s.amendment->>'expiresAt')::timestamptz>clock_timestamp()
 and (w.binding->'quote'->>'verifiedAt')::timestamptz<=clock_timestamp()
 and (w.binding->'quote'->>'validUntil')::timestamptz>clock_timestamp()
 ) then raise exception 'r12_recovery_send_window_changed';end if;
 end if;
 return jsonb_build_object('shouldDispatch',true,'reason','claimed_once');$new$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'r12_recovery_send_definition_drift';end if;
 execute replace(d,old,replacement);
end $patch$;
commit;
