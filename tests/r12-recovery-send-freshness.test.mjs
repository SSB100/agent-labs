import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../supabase/migrations/20261007192502_r12_recovery_send_freshness.sql',import.meta.url),'utf8');
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
