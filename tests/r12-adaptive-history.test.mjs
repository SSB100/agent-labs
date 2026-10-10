import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './helpers/r10-sql-fixture.mjs';
import {exerciseFourPlanResearchHistory} from './helpers/r12-adaptive-history-fixture.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const host=process.env.R12_SQL_TEST_HOST;
for(const legacy of [null,{committedMicrounits:1100,pending:false}]){
 test(`Four genuine closed plans preserve ${legacy?'legacy':'native'} funding and immutable predecessor records`,{skip:!host,timeout:120000},async()=>{
  const req=createRequire(path.resolve(host,'package.json'));
  const {PGlite}=req('@electric-sql/pglite'),{pgcrypto}=req('@electric-sql/pglite/contrib/pgcrypto');
  const db=new PGlite({extensions:{pgcrypto}}),originalFetch=globalThis.fetch;let externalCalls=0;
  globalThis.fetch=async()=>{externalCalls++;throw Error('External I/O forbidden in historical research qualification');};
  try{
   await db.exec(r04SqlBootstrap+sessionBootstrap);
   for(const name of readdirSync(path.join(root,'supabase/migrations')).filter(x=>x.endsWith('.sql')).sort())await db.exec(readFileSync(path.join(root,'supabase/migrations',name),'utf8'));
   const r=await exerciseFourPlanResearchHistory(db,{legacy});
   assert.deepEqual(r.history.map(h=>h.plan.version),[1,2,3,4]);
   assert.equal(r.inertPosts,20);assert.equal(r.inertReceiptGets,20);
   assert.equal(r.scopes.length,4);assert.equal(externalCalls,0);
  }finally{globalThis.fetch=originalFetch;await db.close();}
 });
}
