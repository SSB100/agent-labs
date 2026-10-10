/** Genuine closed five-phase predecessor lineage. Inert provider transports only.
 * No raw terminal row, receipt, root allocation or history proof is fabricated. */
import {exerciseFourPlanResearchHistory} from './r12-adaptive-history-fixture.mjs';
import {one} from './r12-owner-initial-sql-fixture.mjs';
import {discoveryV2Hash as hash} from '../../.core-tests/products/discovery-v2.js';
export async function prepareDirectOriginLegacyFixture(db,{legacy=null,onClosed=null}={}){
 return exerciseFourPlanResearchHistory(db,{legacy,onClosed:async ctx=>{
  const {f}=ctx;
  const build=async()=>(await one(db,'select private.r12_direct_origin_build($1,$2) packet',[f.businessId,f.goalId])).packet;
  const packet=await build(),originHash=hash(packet);
  const freeze=async(expected=originHash)=>{
   await db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.ownerId]);
   return(await one(db,'select private.r12_direct_origin_freeze($1,$2,$3) packet',[f.businessId,f.goalId,expected])).packet;
  };
  const check=async(expected=originHash)=>(await one(db,'select private.r12_direct_origin_frozen_check($1,$2,$3) packet',[f.businessId,f.goalId,expected])).packet;
  const result={...ctx,db,packet,originHash,build,freeze,check};return onClosed?onClosed(result):result;
 }});
}
