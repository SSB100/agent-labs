import {randomUUID} from 'node:crypto';
import {r07FixtureSetup,r07Seed,R07_OWNER} from './r07-sql-fixture.mjs';
export {R07_OWNER as R10_OWNER};
export const R10_KEY='inert-r10-authority-qualification-only-123456789';
export const R10_AUTH='aa100000-0000-4000-8000-000000000001';
export const R10_OTHER_AUTH='aa100000-0000-4000-8000-000000000002';
export const R10_SOURCE='9165948e0a968e0a00be7bc22d4ec89862b84733577ca4a4fb9622238c2c42cd';
export const value=async(db,sql,args=[])=>(await db.query(sql,args)).rows[0]?.result;
export const sessionBootstrap=`create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id),not_after timestamptz);`;
export async function setupR10(db,root){
 await db.exec(r07FixtureSetup(root));
 await db.query('insert into auth.sessions(id,user_id) values($1,$3),($2,$3)',[R10_AUTH,R10_OTHER_AUTH,R07_OWNER]);
 await db.query("insert into private.r10_server_keys values(encode(extensions.digest(convert_to($1,'UTF8'),'sha256'),'hex'),clock_timestamp()+interval '1 day')",[R10_KEY]);
 await authenticate(db);
}
export async function authenticate(db,owner=R07_OWNER,authSession=R10_AUTH){
 await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.session_id',$2,false)",[owner,authSession]);
}
export async function seedR10(db,overrides={}){
 const s=await r07Seed(db);s.questId=s.goalId;s.workflowRunId=randomUUID();s.sessionId=randomUUID();s.writerId=randomUUID();s.ownerId=R07_OWNER;s.authSessionId=R10_AUTH;s.contextId=randomUUID();s.pageId=randomUUID();s.cost=costFixture(s.maxRuntimeSeconds??120);Object.assign(s,overrides);
 await enroll(db,s);return s;
}
export const costFixture=(seconds=120)=>({provider:'steel',purpose:'r10.controlled-public-viewer-qualification',currency:'USD',maximumMicrounits:'1000',rateMicrounitsPerMinute:'100',billingQuantumSeconds:60,minimumChargeMicrounits:'0',estimatedMaximumMicrounits:String(Math.ceil(seconds/60)*100),quoteHash:'c'.repeat(64),quoteValidFrom:new Date(Date.now()-60000).toISOString(),quoteValidUntil:new Date(Date.now()+3600000).toISOString()});
export const enroll=(db,s,overrides={})=>{const v={...s,...overrides};return value(db,'select private.r10_enroll($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) result',[v.ownerId,v.authSessionId,v.businessId,v.questId,v.sourceHash??R10_SOURCE,v.approvalReference??'inert-approved-qualification-only',v.cost,v.grantSeconds??120,v.maxRuntimeSeconds??120,v.workflowRunId,v.sessionId]);};
export const owner=(db,s,operation='read',session=s.sessionId)=>value(db,'select public.r10_viewer_owner($1,$2,$3,$4,$5) result',[s.businessId,s.questId,s.workflowRunId,session,operation]);
export const catalog=(db,s,run=null)=>value(db,'select public.r10_viewer_catalog($1,$2,$3) result',[s.businessId,s.questId,run]);
export const server=(db,s,operation,payload={},key=R10_KEY)=>value(db,'select public.r10_viewer_server($1,$2,$3,$4,$5,$6,$7,$8,$9) result',[s.businessId,s.questId,s.workflowRunId,s.sessionId,s.ownerId,s.authSessionId,operation,payload,key]);
export const writer=s=>({writerId:s.writerId});
export const frame=s=>({...writer(s),contextId:s.contextId,pageId:s.pageId,epoch:1});
export async function startR10(db,s){const claim=await server(db,s,'claim',writer(s));await server(db,s,'create_dispatched',writer(s));await server(db,s,'created',{...writer(s),providerSessionId:`inert-${s.sessionId}`});await server(db,s,'attest',{...frame(s),sourceHash:R10_SOURCE});return claim;}
export const close=(db,s,overrides={})=>server(db,s,'close',{...writer(s),outcome:'ended',providerReceiptHash:overrides.releaseResult==='not_created'?null:'a'.repeat(64),releaseResult:'released',capturedFrames:0,deliveredFrames:0,...overrides});
