import {randomUUID} from 'node:crypto';
import {R07_OWNER,R07_KEY,R05_KEY,R07_LEASE} from './r07-sql-fixture.mjs';
export const R09_REVIEWER='99090000-0000-4000-8000-000000000001';
export const R09_OUTSIDER='99090000-0000-4000-8000-000000000002';
export const value=async(db,sql,params=[])=>(await db.query(sql,params)).rows[0]?.result;
export const owner=(db,businessId,operation,payload,submission=randomUUID())=>value(db,'select public.r09_knowledge_owner($1,$2,$3,$4) result',[businessId,operation,payload,submission]);
export const read=(db,businessId,dataset,query={})=>value(db,'select public.r09_knowledge_read($1,$2,$3) result',[businessId,dataset,query]);
export const controller=(db,s,operation,payload={},overrides={})=>value(db,'select public.r07_controller($1,$2,$3,$4,$5,$6,$7,$8,$9) result',[s.businessId,s.goalId,operation,payload,overrides.submission??randomUUID(),R07_KEY,R07_LEASE,overrides.epoch??1,R05_KEY]);
export function reviewFixture(overrides={}){
 const verifiedAt=new Date(Date.now()-3600000).toISOString(),expiresAt=new Date(Date.now()+3600000).toISOString();
 return {redactionStatus:'accepted',proofPreserved:true,generalizable:true,privateContentRemoved:true,independentSourcesVerified:true,content:{guidance:'Use bounded experiments and independent evidence before reusing a result.',scope:'General research planning without account operations.',limitations:['This is informational guidance only.'],conflicts:[],generalizability:'Two independent public primary sources support the bounded method.'},sources:[{url:'https://www.nist.gov/research',title:'Public primary research reference',verifiedAt,expiresAt,contentHash:'a'.repeat(64),stance:'supports'},{url:'https://www.gov.uk/guidance',title:'Independent public guidance reference',verifiedAt,expiresAt,contentHash:'b'.repeat(64),stance:'supports'}],expiresAt,notes:'Independent review retained the necessary proof and removed private details.',...overrides};
}
export async function sourceArtifact(db,s,content={observation:'Private local result only',customerName:'Private Fixture Customer',accountId:'private-fixture-account'}){
 return value(db,"insert into public.artifacts(business_id,artifact_type,name,content) values($1,'r09.private.evidence','Private operational evidence',$2) returning id result",[s.businessId,content]);
}
export const proposalFixture=artifactId=>({proposalId:null,expectedVersion:0,title:'Bounded research lesson',lesson:'A local result suggests a reusable lesson, subject to independent review.',scope:'General bounded research',limitations:['Local evidence alone does not establish generalizability.'],artifactIds:[artifactId]});
export async function trustedRelease(db,s,artifact,version='1.0.0',previous=null,packKey='knowledge.learned.bounded-research',review=reviewFixture()){
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[R07_OWNER]);
 const proposal=await owner(db,s.businessId,'propose',proposalFixture(artifact));
 const reviewId=await value(db,'select private.r09_review($1,$2,$3,$4,$5) result',[proposal.id,R09_REVIEWER,'c'.repeat(64),'approved',review]);
 const releaseId=await value(db,'select private.r09_promote($1,$2,$3,$4,$5) result',[reviewId,packKey,version,previous,'Independent evidence supports this bounded revision.']);
 return {proposal,reviewId,releaseId};
}
