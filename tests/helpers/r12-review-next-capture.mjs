/** Disposable Next-fixture capture only; no production database or transport. */
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {prepareR12ReviewFixture} from './r12-review-fixture.mjs';
import {exerciseR12ReviewRuntime} from './r12-review-runtime.mjs';
const directory=path.resolve(process.env.R12_REVIEW_NEXT_OUTPUT??'');
assert.ok(path.basename(directory).startsWith('r12-next-')&&!process.env.R12_POSTGRES_URL,'Designated isolated Next snapshot directory required');
const host=process.env.R12_SQL_TEST_HOST;assert.ok(host,'Isolated PGlite host required');
const require=createRequire(path.resolve(host,'package.json')),{PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
const metadata=JSON.parse(await readFile(path.join(directory,'metadata.json'),'utf8'));
const db=new PGlite({extensions:{pgcrypto},loadDataDir:new Blob([await readFile(path.join(directory,'scheduled-review.tgz'))])});await db.waitReady;await db.exec("set timezone='UTC'");
try{
 const capture=async(name,metadata)=>{assert.ok(['review-preparation','review-ready'].includes(name));const blob=await db.dumpDataDir('gzip');await writeFile(path.join(directory,name+'.tgz'),Buffer.from(await blob.arrayBuffer()));if(metadata)await writeFile(path.join(directory,'continuation-metadata.json'),JSON.stringify(metadata));};
 const prepared=await prepareR12ReviewFixture(db,metadata,{capture});assert.equal(prepared.activated.providerCalls,0);
 await exerciseR12ReviewRuntime(db,prepared.metadata,{failureCase:'json_parse'});
 const successorCapture=async(name,successor)=>{assert.ok(['review-preparation','review-ready'].includes(name));const blob=await db.dumpDataDir('gzip');await writeFile(path.join(directory,name.replace('review-','review-successor-')+'.tgz'),Buffer.from(await blob.arrayBuffer()));if(successor)await writeFile(path.join(directory,'successor-metadata.json'),JSON.stringify(successor));};
 const successor=await prepareR12ReviewFixture(db,metadata,{reviewSuccessor:true,capture:successorCapture});assert.equal(successor.activated.providerCalls,0);assert.equal(successor.envelope.reviewHistory.length,1);
 console.log('PASS: original outputs staged, genuine owner permission confirmed and actual continuation recipe initialized; zero provider calls');
}finally{await db.close();}
