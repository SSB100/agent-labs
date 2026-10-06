import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('R12 actual owner Business amendment and same-scope policy rebind preserve budget and history',{skip:!process.env.R12_SQL_TEST_HOST&&!process.env.R11_SQL_TEST_HOST},()=>{
 const result=spawnSync(process.execPath,['tests/helpers/r12-bootstrap-rehearsal.mjs'],{cwd:process.cwd(),env:{...process.env,R12_REBIND_REHEARSAL:'1'},encoding:'utf8',timeout:120000,maxBuffer:2000000});
 assert.equal(result.status,0,result.stderr||result.stdout);const report=JSON.parse(result.stdout.trim().split('\n').at(-1));assert.equal(report.status,'passed');assert.equal(report.rebound,true);assert.equal(report.pinSubstitutions,24);assert.equal(report.checks.length,29);assert.ok(report.checks.every(item=>item.status==='passed'));
});
