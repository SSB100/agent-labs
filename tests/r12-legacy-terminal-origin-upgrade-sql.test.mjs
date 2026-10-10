import test from 'node:test';
import assert from 'node:assert/strict';
import {legacyOriginBase,exerciseLegacyTerminalOriginUpgrade} from './helpers/r12-legacy-terminal-origin-upgrade.mjs';
const host=process.env.R12_SQL_TEST_HOST??process.env.R11_SQL_TEST_HOST;
// Reuse the genuine four-plan replay without registering its independent suite
// against this fresh database. This is the same isolation hook as native HTTP.
const previous=process.env.R12_RPC_HTTP_ONLY;
process.env.R12_RPC_HTTP_ONLY='1';
const {prepareR12OwnerWorkflows}=await import('./r12-discovery-scope-sql.test.mjs');
if(previous===undefined)delete process.env.R12_RPC_HTTP_ONLY;else process.env.R12_RPC_HTTP_ONLY=previous;
test('R12 legacy terminal origin preserves genuine old13 history through schema upgrades',{skip:!host,timeout:240000},async()=>{
 const fixture=await prepareR12OwnerWorkflows({migrationThrough:legacyOriginBase});
 try{await fixture.exerciseOwnerEpisode(async({db,evidence})=>assert.deepEqual(await exerciseLegacyTerminalOriginUpgrade(db,evidence),{inertDispatches:17,children:19,financialFailures:2,researchReceipts:5,historyPreserved:true}));}finally{await fixture.close();}
});
