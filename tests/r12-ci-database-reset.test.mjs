import test from 'node:test';
import assert from 'node:assert/strict';
import {validateR12CiResetTarget} from '../scripts/reset-r12-ci-database.mjs';
const valid={CI:'true',GITHUB_ACTIONS:'true',R12_REQUIRE_POSTGRES:'1',R12_POSTGRES_URL:'postgresql://r12_test:r12-isolated-fixture@127.0.0.1:5432/r12_test',R12_CI_POSTGRES_ADDRESS:'172.18.0.2'};

test('R12 full-shape CI reset accepts only the exact inert service target',()=>{
 assert.equal(validateR12CiResetTarget(valid).pathname,'/r12_test');
 for(const change of [{CI:'false'},{GITHUB_ACTIONS:'false'},{R12_REQUIRE_POSTGRES:'0'},
  {PGOPTIONS:'-c role=other'},{PGSERVICE:'other'},{PGSERVICEFILE:'/tmp/other'},
  {R12_CI_POSTGRES_ADDRESS:undefined},{R12_CI_POSTGRES_ADDRESS:'not-an-address'},
  {R12_CI_POSTGRES_ADDRESS:'172.999.1.2'},{R12_CI_POSTGRES_ADDRESS:'172.18.0.2\n172.19.0.2'}])assert.throws(()=>validateR12CiResetTarget({...valid,...change}));
 for(const url of ['postgresql://r12_test:r12-isolated-fixture@production.example:5432/r12_test',
  'postgresql://r12_test:r12-isolated-fixture@127.0.0.1:5433/r12_test',
  'postgresql://postgres:r12-isolated-fixture@127.0.0.1:5432/r12_test',
  'postgresql://r12_test:other@127.0.0.1:5432/r12_test',
  'postgresql://r12_test:r12-isolated-fixture@127.0.0.1:5432/postgres',
  valid.R12_POSTGRES_URL+'?options=anything',valid.R12_POSTGRES_URL+'#other'])assert.throws(()=>validateR12CiResetTarget({...valid,R12_POSTGRES_URL:url}));
});
