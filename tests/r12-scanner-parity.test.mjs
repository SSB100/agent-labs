import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {scannerParityCases} from './helpers/r12-scanner-parity.mjs';
test('R12 scanner delegation reserves the null-key-wrapper boundary and pins released definitions',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/20261007114310_r12_pilot_scanner_subtrees.sql',import.meta.url),'utf8');
 assert.match(sql,/bytes<=19997/);assert.match(sql,/bytes>65536/);assert.match(sql,/perform private\.r04_safe\(jsonb_build_object\(k,null\)\)/);
 assert.match(sql,/56b69803bb4e1df99bf7402343d2fc2e05dfb6750642a73d33000f7b098b08f1/);assert.match(sql,/f9584ae06cf0ca889297120bc9754ecaa8ae9edbc33adeedb97a4bf43056c2a8/);
 assert.doesNotMatch(sql,/create or replace function private\.r04_safe|grant\s+execute|statement_timeout|security\s+definer/i);
 assert.ok(scannerParityCases().length>300);
});
