import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runOperatorRecipe,STAGING_SQL,ACTIVATION_SQL,CLOSE_SQL} from '../scripts/r12-focused-pilot-successor-bootstrap.mjs';
import {STAGING_SQL as ORIGINAL_STAGE,ACTIVATION_SQL as ORIGINAL_ACTIVATE,CLOSE_SQL as ORIGINAL_CLOSE} from '../scripts/r12-focused-pilot-bootstrap.mjs';
const migration=readFileSync(new URL('../supabase/migrations/20261007071106_r12_focused_pilot_successor.sql',import.meta.url),'utf8');
test('successor operator preserves every frozen original recipe byte and uses atomic parameterized payloads',async()=>{
 for(const [kind,sql,original] of [['stage',STAGING_SQL,ORIGINAL_STAGE],['activate',ACTIVATION_SQL,ORIGINAL_ACTIVATE],['close',CLOSE_SQL,ORIGINAL_CLOSE]]){
  assert.ok(sql.endsWith(original));const calls=[],input={scopeId:'inert-only'},result={providerCalls:0};
  const client={query:async(statement,args)=>{calls.push({statement,args});return statement==='select payload from pg_temp.r12_bootstrap_result'?{rows:[{payload:result}]}:{rows:[]};}};
  assert.deepEqual(await runOperatorRecipe(client,kind,input),result);assert.equal(calls[0].statement,'begin');assert.equal(calls.at(-1).statement,'commit');
  assert.deepEqual(calls.find(c=>c.statement.startsWith('insert into pg_temp')).args,[JSON.stringify(input)]);assert.equal(calls.filter(c=>c.statement===sql).length,1);
 }
 assert.equal(createHash('sha256').update(readFileSync(new URL('../scripts/r12-focused-pilot-bootstrap.mjs',import.meta.url))).digest('hex'),'161c4d2d42b93d16a3f5b9181eaf0ed9ecca15af790b2b081d924e3768b604ce');
});
test('successor operator fails without retries on SQL errors, ambiguous results and uncertain commit',async()=>{
 for(const failAt of ['sql','result','commit']){let writes=0;const calls=[];const client={query:async(statement)=>{calls.push(statement);if(statement===STAGING_SQL){writes++;if(failAt==='sql')throw Error('SQL denied');}if(statement==='select payload from pg_temp.r12_bootstrap_result')return{rows:failAt==='result'?[]:[{payload:{}}]};if(statement==='commit'&&failAt==='commit')throw Error('Commit unknown');return{rows:[]};}};
  await assert.rejects(runOperatorRecipe(client,'stage',{}));assert.equal(writes,1);assert.equal(calls.at(-1),'rollback');
 }
 let called=false;await assert.rejects(runOperatorRecipe({query:async()=>{called=true;}},'retry',{}));assert.equal(called,false);
});
test('successor definitions preserve original indexes and closed history, create no API grants or live rows',()=>{
 assert.match(migration,/enable row level security/);assert.match(migration,/revoke all on private\.r12_pilot_successor_authorizations from public,anon,authenticated,service_role/);
 assert.match(migration,/predecessor_scope_id uuid not null unique/);assert.match(migration,/budget_authority_root_id uuid not null unique/);
 assert.doesNotMatch(migration,/drop (?:index|constraint)|grant execute|insert into private\.(?:r12_discovery_scopes|r05_policies|r07_server_keys|r05_server_keys)/i);
 assert.match(migration,/r12_successor_strategy_terminal/);assert.match(migration,/blockingForTest/);assert.match(migration,/r12_discovery_proof_validate\(c,proof\)/);
 assert.doesNotMatch(migration,/r12_discovery_receipt_status\(c\).*verified/);assert.match(migration,/private\.r12_pilot_source\(old_scope,effective_at,false\)/);
});
