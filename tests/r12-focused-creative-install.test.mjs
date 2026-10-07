import test from 'node:test';
import assert from 'node:assert/strict';
import {TARGET,CATALOG_PINS_SQL,INSTALL_SQL,runOperatorRecipe} from '../scripts/r12-focused-creative-install.mjs';

test('creative installation is a reviewed operator-only definition with fixed live catalog pins',()=>{
 assert.equal(TARGET.businessId,'91ff7c87-60e4-4dbb-8e84-be63b53c2c79');assert.equal(TARGET.ownerId,'1b9642c5-3e08-478a-b215-4c095d2f4e58');assert.equal(TARGET.packId,'a236d30d-b453-4e94-8d34-4615d21b300a');
 assert.match(TARGET.snapshotHash,/^[a-f0-9]{64}$/);assert.match(TARGET.catalogHash,/^[a-f0-9]{64}$/);assert.ok(Object.isFrozen(TARGET));
 assert.match(CATALOG_PINS_SQL,/^with resolved as/);assert.doesNotMatch(CATALOG_PINS_SQL,/\b(insert|update|delete|alter|grant|revoke)\b/i);
 const writeTargets=[...INSTALL_SQL.matchAll(/\binsert into ([\w.]+)/g)].map(match=>match[1]);assert.deepEqual(writeTargets,['public.installed_packs','public.events','pg_temp.r12_bootstrap_result']);
 assert.doesNotMatch(INSTALL_SQL,/\b(grant|revoke|alter|delete|set role|set_config|stage10_qualify_pack)\b/i);
 assert.match(INSTALL_SQL,/private\.r12_focused_adoption_current\(a.id\)/);assert.match(INSTALL_SQL,/370494/);assert.match(INSTALL_SQL,/60 minutes/);
});
function client({fail,rows=[{payload:{installationId:'inert',authorityCreated:false,shouldDispatch:false}}]}={}){
 const calls=[];return{calls,query:async(sql,args)=>{calls.push({sql,args});if(fail===sql)throw Error('inert uncertain result');return{rows:sql==='select payload from pg_temp.r12_bootstrap_result'?rows:[]};}};
}
test('installation operator validates kind before querying and submits input only as a bound parameter',async()=>{
 const c=client();await assert.rejects(runOperatorRecipe(c,'activate',{}),/Unknown/);assert.equal(c.calls.length,0);
 const input={nonsecret:'reviewed parameter transport'};const result=await runOperatorRecipe(c,'install',input);
 assert.equal(result.authorityCreated,false);assert.equal(c.calls[0].sql,'begin');assert.equal(c.calls.at(-1).sql,'commit');
 assert.deepEqual(c.calls.filter(call=>call.args),[{sql:'insert into pg_temp.r12_bootstrap_input(payload) values($1::jsonb)',args:[JSON.stringify(input)]}]);
 assert.equal(c.calls.filter(call=>call.sql===INSTALL_SQL).length,1);
});
test('operator rejects SQL failure, ambiguous result and uncertain commit without retries',async()=>{
 for(const options of [{fail:INSTALL_SQL},{rows:[]},{rows:[{payload:{}},{payload:{}}]},{fail:'commit'}]){
  const c=client(options);await assert.rejects(runOperatorRecipe(c,'install',{}));assert.equal(c.calls.at(-1).sql,'rollback');
  assert.equal(c.calls.filter(call=>call.sql===INSTALL_SQL).length,1);assert.equal(c.calls.filter(call=>call.sql==='begin').length,1);
 }
});
