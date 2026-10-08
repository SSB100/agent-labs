import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {recoverySendFenceParts} from './helpers/r12-recovery-send-freshness.mjs';
const sql=readFileSync(new URL('../supabase/migrations/20261007192502_r12_recovery_send_freshness.sql',import.meta.url),'utf8');
const runtimeSql=readFileSync(new URL('../supabase/migrations/20261007232026_r12_recovery_runtime_deadlines.sql',import.meta.url),'utf8');
test('the recovery send fence follows the final claim/key check and leaves generic controls unchanged',()=>{
 assert.match(sql,/pg_get_functiondef\('public\.r12_discovery_server\(uuid,uuid,text,jsonb,text\)'::regprocedure\)/);
 assert.match(sql,/scope_id=w.scope_id and business_id=p_business_id/);
 assert.match(sql,/marker.lease_epoch=head.lease_epoch/);
 assert.match(sql,/head.lease_expires_at>clock_timestamp\(\)/);
 for(const path of ["authority.valid_until>clock_timestamp()","authority.receipt_until>clock_timestamp()","(p.content->>'deadline')::timestamptz>clock_timestamp()","(p.content->>'expiresAt')::timestamptz>clock_timestamp()","(s.amendment->>'expiresAt')::timestamptz>clock_timestamp()","(w.binding->'quote'->>'verifiedAt')::timestamptz<=clock_timestamp()","(w.binding->'quote'->>'validUntil')::timestamptz>clock_timestamp()"] )assert.ok(sql.includes(path),path);
 assert.match(sql,/replacement:=\$new\$ perform private\.r12_discovery_key\(key_hash\)/);
 assert.match(sql,/r12_recovery_send_definition_drift/);
 assert.doesNotMatch(sql,/grant\s|revoke\s|statement_timeout|lock_timeout|set_config|create function|create or replace function/i);
 assert.equal(sql.match(/execute replace\(d,old,replacement\)/g)?.length,1);
});
test('the final-send fixture reapplies only the exact explicit terminal fence patch',()=>{
 const parts=recoverySendFenceParts(sql,runtimeSql);
 for(const version of ['r12.focused-pilot-unsent-recovery-authorization.1','r12.focused-pilot-terminal-qualification-authorization.1'])assert.ok(parts.currentFence.includes(version));
 assert.equal(parts.currentFence.split(parts.anchor).length,2);
 assert.ok(parts.currentFence.endsWith("return jsonb_build_object('shouldDispatch',true,'reason','claimed_once');"));
 assert.match(parts.reapplyTerminal,/r12_recovery_send_fence_definition_drift/);
 assert.doesNotMatch(parts.reapplyTerminal,/r12_recovery_dispatch|create function|grant execute|statement_timeout/);
 assert.throws(()=>recoverySendFenceParts(sql,runtimeSql+runtimeSql),/Exactly one runtime send patch/);
 assert.throws(()=>recoverySendFenceParts(sql,runtimeSql.replaceAll('r12.focused-pilot-terminal-qualification-authorization.1','unrecognized-authorization')),/assert|false/i);
});
