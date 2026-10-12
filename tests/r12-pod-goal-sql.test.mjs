import test from 'node:test';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './helpers/r10-sql-fixture.mjs';
import {exercisePodOwnerAdmission,exercisePodFirstInputs,exercisePodUnknownHold,exercisePodRuntime,exercisePodRuntimeCapabilities,exercisePodUnsentCancellation,exercisePodStoppedStagedReceipt} from './helpers/r12-pod-sql-fixture.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),host=process.env.R12_SQL_TEST_HOST??process.env.R11_SQL_TEST_HOST;
test('NEW POD goal SQL uses new template authority and genuine R04/R05/R07 APIs',{skip:!host,timeout:180000},async t=>{
 const require=createRequire(path.resolve(host,'package.json')),{PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto'),db=new PGlite({extensions:{pgcrypto}});
 try{
  await db.exec(r04SqlBootstrap+sessionBootstrap);
  for(const file of readdirSync(root+'/supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync(root+'/supabase/migrations/'+file,'utf8'));
  await t.test('broad intent prepares and confirms without legacy grant mapping; wrong owner and stopped review fail closed',()=>exercisePodOwnerAdmission(db));
  await t.test('exact five-phase R07 plan schedules genuine public-only planner input; Stop blocks new inputs',()=>exercisePodFirstInputs(db));
  await t.test('marked unknown R05 hold blocks prepare and survives Stop without provider transport',()=>exercisePodUnknownHold(db));
  await t.test('five real phase builders, serializers and SQL receipt boundaries reject deferred-domain substitution',()=>exercisePodRuntime(db));
  await t.test('unsorted unique planner domains canonicalize identically across SQL and TypeScript without changing raw receipts',()=>exercisePodRuntime(db,{reverseSourceDomains:true}));
  await t.test('runtime read rejects wrong application capability and cross-Business scope substitution',()=>exercisePodRuntimeCapabilities(db));
  await t.test('Stop allows exact unmarked R07 cancellation with no paid liability',()=>exercisePodUnsentCancellation(db));
  await t.test('staged marked receipt settles after Stop and template revocation; fresh dispatch is refused',()=>exercisePodStoppedStagedReceipt(db));
 }finally{await db.close();}
});
