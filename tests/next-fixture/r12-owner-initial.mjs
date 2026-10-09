/** Fresh isolated SQL state for the actual Next owner Goal journey.
 * No setup, policy, scope, authority, provider request or paid effect is created.
 * Catalog reviews/grants and retained legacy history are synthetic test data. */
import {createRequire} from 'node:module';
import {readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {r04SqlBootstrap} from '../helpers/r04-sql-bootstrap.mjs';
import {sessionBootstrap} from '../helpers/r10-sql-fixture.mjs';
import {ownerInitialSqlFixture} from '../helpers/r12-owner-initial-sql-fixture.mjs';
import {r12QuoteFixture} from '../helpers/r12-provider-fixture.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const INERT_ROOT='inert-r12-owner-root-configuration-0123456789';
export async function createOwnerInitialNextFixture(host,kind='native'){
 if(!['native','legacy'].includes(kind))throw Error('Unknown inert owner-initial fixture kind');
 const require=createRequire(path.resolve(host,'package.json')),{PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
 const db=new PGlite({extensions:{pgcrypto}});
 try{
  await db.exec(r04SqlBootstrap+sessionBootstrap);await db.exec("set timezone='UTC'");
  for(const file of (await readdir(path.join(root,'supabase/migrations'))).filter(x=>x.endsWith('.sql')).sort())await db.exec(await readFile(path.join(root,'supabase/migrations',file),'utf8'));
  const f=await ownerInitialSqlFixture(db,{bootstrapRoot:INERT_ROOT,legacy:kind==='legacy'?{committedMicrounits:1900000}:null});
  return {db,metadata:{scenario:'owner-initial-'+kind,businessId:f.businessId,goalId:f.goalId,ownerId:f.ownerId,profileId:f.profileId,grantId:f.grantId,bindingId:f.bindingId,grantRootId:f.rootId,profile:f.profile,goalContent:f.content,initialInput:f.input,priorRoundId:f.legacy?.rootId??null,budgetAuthorityRootId:f.legacy?.rootId??f.businessId,quote:r12QuoteFixture(),outputs:{},scopeId:null,plan:null}};
 }catch(error){await db.close();throw error;}
}
