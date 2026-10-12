import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('POD scope optimization changes no permission, deadline or financial guard',()=>{
 const migration=readFileSync(new URL('../supabase/migrations/20261012084203_r12_pod_scope_projection_cost.sql',import.meta.url),'utf8');
 assert.match(migration,/r12_pod_scope_projection_patch_drift/);
 assert.doesNotMatch(migration,/alter\s+role|statement_timeout|lock_timeout|grant\s|delete\s+from|insert\s+into|update\s+private/i);
 const original=readFileSync(new URL('../supabase/migrations/20261012012704_r12_goal_driven_pod_research.sql',import.meta.url),'utf8');
 const calls=original.split('\n').filter(line=>line.includes('private.r12_pod_scope_resolve(')&&!line.startsWith('create function'));
 assert.equal(calls.length,8);
 for(const call of calls)assert.match(call,/perform private\.r12_pod_scope_resolve\(/,'Every current caller discards the return projection');
 const old=migration.match(/old text := \$old\$([\s\S]*?)\$old\$/)?.[1];
 const replacement=migration.match(/execute replace\(d,old,\$new\$([\s\S]*?)\$new\$\)/)?.[1];
 assert.ok(old&&replacement);
 assert.equal(old.replace(",'finance',private.r12_pod_finance(s.business_id)",''),replacement);
});
