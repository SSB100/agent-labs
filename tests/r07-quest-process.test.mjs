import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {r07FixtureSetup,r07Seed,R07_KEY,R05_KEY,R07_LEASE} from './helpers/r07-sql-fixture.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('R07 finite Quest recovers from real process exits at reserve, dispatch, response and projection cuts',{skip:!process.env.R07_SQL_TEST_HOST},async t=>{
 const require=createRequire(path.resolve(process.env.R07_SQL_TEST_HOST,'package.json'));
 const {PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
 const temp=mkdtempSync(path.join(tmpdir(),'r07-recovery-')),dir=path.join(temp,'database'),scopeFile=path.join(temp,'scope.json');
 let db=new PGlite(dir,{extensions:{pgcrypto}});
 try{
 await db.exec(r04SqlBootstrap);
 for(const f of readdirSync(path.join(root,'supabase/migrations')).filter(x=>x.endsWith('.sql')).sort())await db.exec(readFileSync(path.join(root,'supabase/migrations',f),'utf8'));
 await db.exec(r07FixtureSetup(root));
 await db.exec('create table public.r07_inert_effects(id uuid primary key,response jsonb not null);');
 const create=async()=>{
  const scope=await r07Seed(db);
  await db.query('select public.r07_controller($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9)',[scope.businessId,scope.goalId,'plan',JSON.stringify({plan:scope.plan,expectedVersion:0,reason:'Process qualification',evidenceHash:'a'.repeat(64)}),randomUUID(),R07_KEY,R07_LEASE,0,R05_KEY]);
  writeFileSync(scopeFile,JSON.stringify(scope));return scope;
 };
 await create();await db.close();db=null;
 const worker=(mode,ticks,expected=0)=>{
  const result=spawnSync(process.execPath,['tests/helpers/r07-process-worker.mjs',dir,scopeFile,mode,String(ticks)],{cwd:root,encoding:'utf8',timeout:60000});
  assert.equal(result.status,expected,result.stderr);return expected===0?JSON.parse(result.stdout):null;
 };
 let run=worker('normal',2);assert.equal(run.snapshot.attempts[0].status,'reserved');assert.equal(run.effects,0);
 worker('crash-after-effect',1,71);
 run=worker('normal',1);assert.equal(run.results[0].reason,'trusted_readback_required');assert.equal(run.effects,1);
 run=worker('reconcile',1);assert.equal(run.snapshot.attempts[0].status,'responded');assert.equal(run.effects,1);
 run=worker('normal',1);assert.equal(run.snapshot.attempts[0].status,'completed');assert.equal(run.effects,1);
 run=worker('normal',8);assert.equal(run.effects,3);
 run=worker('normal',1);assert.equal(run.results[0].status,'completed');assert.equal(run.snapshot.head.dispatches,3);
 // A second Quest dies after committing the marker and before any external effect.
 db=new PGlite(dir,{extensions:{pgcrypto}});await create();await db.close();db=null;
 worker('normal',2);worker('crash-before-effect',1,70);
 run=worker('reconcile',1);assert.equal(run.results[0].reason,'effect_still_uncertain');assert.equal(run.effects,3);
 run=worker('normal',1);assert.equal(run.results[0].reason,'trusted_readback_required');assert.equal(run.effects,3);
 assert.equal(run.snapshot.head.dispatches,1);
 // An immutable valid output with unknown cost can later reconcile financially.
 db=new PGlite(dir,{extensions:{pgcrypto}});await create();await db.close();db=null;
 run=worker('unknown-cost',3);assert.equal(run.snapshot.attempts[0].status,'responded');assert.equal(run.effects,4);
 run=worker('normal',1);assert.equal(run.results[0].reason,'unresolved_liability');
 run=worker('reconcile',1);assert.equal(run.snapshot.attempts[0].status,'completed');assert.equal(run.effects,4);
 t.diagnostic('Fresh Node processes reload durable storage at each boundary; exactly four effects, known late cost and one explicit uncertainty; zero provider network calls');
 }finally{if(db)await db.close();rmSync(temp,{recursive:true,force:true});}
});
