import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('explicit native direct qualification never falls back to PGlite without a constrained database URL',{skip:!process.env.R12_SQL_TEST_HOST},()=>{
 const env={...process.env,R12_REQUIRE_POSTGRES:'1'};delete env.R12_POSTGRES_URL;
 const run=spawnSync(process.execPath,['--input-type=module','-e',"import {directControllerDatabase} from './tests/helpers/r12-direct-controller-database.mjs';await directControllerDatabase();"],{env,encoding:'utf8'});
 assert.notEqual(run.status,0);assert.match(run.stderr,/R12_POSTGRES_URL/);
});
