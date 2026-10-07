import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const migration=readFileSync(new URL('../supabase/migrations/20261007093053_r12_successor_source_reuse.sql',import.meta.url),'utf8');
const original=readFileSync(new URL('../supabase/migrations/20261007071106_r12_focused_pilot_successor.sql',import.meta.url),'utf8');

test('R12 source reuse has no caller-supplied proof or persistent validation cache',()=>{
 assert.match(migration,/FUNCTION private\.r12_pilot_successor_closure_context\(/);
 assert.match(migration,/FUNCTION private\.r12_pilot_successor_validate_context\(/);
 assert.match(migration,/context:=private\.r12_pilot_successor_validate_context\(s,a\.authorization_data\)/);
 assert.doesNotMatch(migration,/create\s+(?:unlogged\s+|temporary\s+)?table|set_config|statement_timeout|security\s+definer|grant\s+/i);
 assert.doesNotMatch(migration,/create or replace function (?:public\.|private\.(?:r07_gate|r07_controller|r05_admissible|r12_pilot_profile_validate|r04_safe))/i);
});

test('R12 source reuse preserves closure wall-clock and predecessor effective-time validation',()=>{
 assert.match(original,/source:=private\.r12_pilot_source\(s,clock_timestamp\(\),false\)/);
 assert.match(migration,/pg_get_functiondef\('private\.r12_pilot_successor_closure\(uuid\)'::regprocedure\)/);
 assert.match(migration,/perform private\.r12_pilot_profile_validate\(s,effective_at,p_current\)/);
 assert.match(migration,/perform private\.r12_pilot_profile_validate\(old_scope,effective_at,false\)/);
 assert.doesNotMatch(migration,/replace\([^;]*(?:clock_timestamp|effective_at)/);
});

test('R12 source reuse retains canonical closure and authorization wrappers and private ACLs',()=>{
 assert.match(migration,/return private\.r12_pilot_successor_closure_context\(p_scope_id\)->'closure'/);
 assert.match(migration,/return private\.r12_pilot_successor_validate_context\(s,v\)->'closure'/);
 assert.match(migration,/revoke all on function private\.r12_pilot_successor_closure_context\(uuid\),\s+private\.r12_pilot_successor_validate_context\(private\.r12_discovery_scopes,jsonb\)\s+from public,anon,authenticated,service_role/);
 for(const guard of ['r12_successor_authorization_mutated','r12_successor_row_binding','r12_pilot_no_research_relink'])assert.ok(migration.includes(guard));
 assert.equal((migration.match(/then raise exception 'r12_source_reuse_/g)||[]).length,7,'Each cloned-definition edit requires its single exact anchor');
});
