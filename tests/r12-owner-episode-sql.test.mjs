import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './helpers/r10-sql-fixture.mjs';
import {exerciseOwnerEpisodeSql,exerciseOwnerEpisodeCatalogSql} from './helpers/r12-owner-episode-sql-fixture.mjs';
const host=process.env.R12_SQL_TEST_HOST??process.env.R11_SQL_TEST_HOST;
test('Owner episode catalog filters initial-only, expired and short-lived grants before newest-per-profile selection',{skip:!host,timeout:120000},async()=>{
 const req=createRequire(path.resolve(host,'package.json')),{PGlite}=req('@electric-sql/pglite'),{pgcrypto}=req('@electric-sql/pglite/contrib/pgcrypto'),db=new PGlite({extensions:{pgcrypto}});
 try{await db.exec(r04SqlBootstrap+sessionBootstrap);for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
  assert.deepEqual(await exerciseOwnerEpisodeCatalogSql(db),{oneProfile:true,newestInitialPreserved:true,ineligibleContinuationSkipped:true});
 }finally{await db.close();}
});
for(const legacy of [null,{committedMicrounits:1000}])test(`Owner episode ${legacy?'legacy':'native'} genuine initial, atomic successor, zero-call Stop and cumulative five-phase execution`,{skip:!host,timeout:120000},async()=>{
 const req=createRequire(path.resolve(host,'package.json')),{PGlite}=req('@electric-sql/pglite'),{pgcrypto}=req('@electric-sql/pglite/contrib/pgcrypto'),db=new PGlite({extensions:{pgcrypto}});
 try{await db.exec(r04SqlBootstrap+sessionBootstrap);for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
  assert.deepEqual(await exerciseOwnerEpisodeSql(db,{legacy}),{providerCalls:0,initialPosts:5,episodePosts:5,episodes:legacy?2:3,lateReceiptPosts:legacy?0:1,goalUnchanged:true});
 }finally{await db.close();}
});
