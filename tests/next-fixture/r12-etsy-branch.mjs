import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import {closeR12Fixture,mirrorR12} from './r12-sql.mjs';

/** A fresh isolated DB branch, not a continuation or rewrite of the original
 * run. Captured after ordinary owner confirmation, before any inference call.
 * Both branches preserve their own results under distinct acceptance IDs. */
export async function snapshotConfirmedEtsyBranch(state) {
 const r=state.r12;
 assert.equal(r.adaptiveScope.version,'r12.discovery-owner-adaptive.2');
 assert.deepEqual(r.adaptiveCalls,[]);
 await (r.queue??Promise.resolve());
 const archive=await r.db.dumpDataDir('none');
 const metadata=structuredClone(Object.fromEntries(Object.entries(r).filter(([key])=>!['db','queue','closing'].includes(key))));
 return async function startIndependentReceiptBranch(host) {
  await closeR12Fixture(state);
  const require=createRequire(path.join(host,'package.json'));
  const {PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
  const db=new PGlite({extensions:{pgcrypto},loadDataDir:archive});await db.waitReady;
  state.r12={...structuredClone(metadata),db,technicalBranch:'independent-etsy-receipt-stop'};
  await db.exec("set timezone='UTC'");await db.query("select set_config('request.jwt.claim.sub',$1,false)",[state.owner]);
  await mirrorR12(state);state.businesses=state.db.businesses;
  assert.deepEqual(state.r12.adaptiveCalls,[]);
 };
}
