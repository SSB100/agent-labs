import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {scannerParityCases,assertR12ScannerParity} from './helpers/r12-scanner-parity.mjs';
test('R12 scanner delegation reserves the null-key-wrapper boundary and pins released definitions',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/20261007114310_r12_pilot_scanner_subtrees.sql',import.meta.url),'utf8');
 assert.match(sql,/bytes<=19997/);assert.match(sql,/bytes>65536/);assert.match(sql,/perform private\.r04_safe\(jsonb_build_object\(k,null\)\)/);
 assert.match(sql,/56b69803bb4e1df99bf7402343d2fc2e05dfb6750642a73d33000f7b098b08f1/);assert.match(sql,/f9584ae06cf0ca889297120bc9754ecaa8ae9edbc33adeedb97a4bf43056c2a8/);
 assert.doesNotMatch(sql,/create or replace function private\.r04_safe|grant\s+execute|statement_timeout|security\s+definer/i);
 assert.ok(scannerParityCases().length>300);
});

test('PGlite snapshot setup never executes the native scanner stress corpus',async()=>{
 let calls=0;const db={query:async()=>{calls++;throw Error('Unexpected PGlite stress query');},exec:async()=>{calls++;throw Error('Unexpected PGlite stress execution');}};
 assert.deepEqual(await assertR12ScannerParity(db,{engine:'pglite'}),{skipped:true,reason:'native_postgresql_qualification'});
 assert.equal(calls,0);
});
test('the explicit native PostgreSQL engine enters qualification and unknown engines fail closed',async()=>{
 const sentinel=Error('Native qualification reached');let calls=0;const db={query:async()=>{calls++;throw sentinel;}};
 await assert.rejects(assertR12ScannerParity(db,{engine:'postgresql'}),error=>error===sentinel);assert.equal(calls,1);
 await assert.rejects(assertR12ScannerParity(db,{engine:'unknown'}),/Explicit SQL fixture engine required/);assert.equal(calls,1);
 assert.equal(scannerParityCases().length,354);assert.equal(scannerParityCases().filter(row=>row.resourceProbe).length,4);
});
