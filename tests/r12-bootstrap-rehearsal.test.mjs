import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile),host=process.env.R12_SQL_TEST_HOST??process.env.R11_SQL_TEST_HOST;
test('R12 reviewed operator recipes and actual owner bootstrap APIs preserve exact scope and fail on drift',{skip:!host,timeout:120000},async()=>{
 const result=await run(process.execPath,['tests/helpers/r12-bootstrap-rehearsal.mjs'],{env:{...process.env,R12_SQL_TEST_HOST:host},timeout:110000,maxBuffer:1024*1024});
 const record=JSON.parse(result.stdout.trim().split('\n').at(-1));assert.equal(record.status,'passed');assert.equal(record.checks.length,19);assert.ok(record.checks.every(check=>check.status==='passed'));assert.equal(record.pinSubstitutions,19);
});
