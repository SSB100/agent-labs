/** Real candidate verification RPC/runtime; all Steel/renderer IO is inert. */
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {landingPins} from './r12-landing-sql-fixture.mjs';
import {directControllerDatabase} from './r12-direct-controller-database.mjs';
import {landingSqlVerification} from './r12-landing-verification-sql-fixture.mjs';
import {prepareDirectTestAuthorityFixture} from './r12-direct-test-authority-fixture.mjs';
import {qualifyInertOwnerRenderer} from './r12-direct-setup-renewal-fixture.mjs';
import {runCandidateApprovedSetup} from './r12-candidate-approved-setup-fixture.mjs';
import {one} from './r12-owner-initial-sql-fixture.mjs';
import {discoveryV2Hash as hash} from '../../.core-tests/products/discovery-v2-hash.js';
const {ETSY_INSIGHTS_VERIFICATION_CANDIDATE_POLICY:policy}=await import(pathToFileURL(resolve(process.env.R12_INSIGHTS_CORE_DIR||'.core-tests','browser/etsy-insights-renderer-candidate.js')).href);
export {policy};
export const candidateImage='https://i.etsystatic.com/site-assets/images/seller-tools/mission-control/channel-icons/pattern-channel-inactive.svg';
export const candidateScript='https://bat.bing.com/bat.js';
export const candidateQueriedImage='https://i.etsystatic.com/site-assets/images/avatars/default_avatar.png?inert_value=never_retained';
export async function candidateDatabase({beforeCandidate=null}={}){const db=await directControllerDatabase();try{for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')&&f.slice(0,14)>'20261010120600'&&f.slice(0,14)<='20261010120900'&&!f.startsWith('20261010120760')).sort()){if(file.startsWith('20261010120900')&&beforeCandidate)await beforeCandidate(db);await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));}return db;}catch(error){await db.close();throw error;}}
export async function insertCandidateReview(db,authority,{changes={},policyValue=policy}={}){
 const route=await one(db,'select * from private.r12_direct_browser_routes where route_hash=$1',[authority.routeHash]);
 const validFrom=new Date(route.valid_from).toISOString(),validUntil=new Date(route.valid_until).toISOString();
 const content={version:'r12.insights-verification-candidate-review.3',purpose:'etsy_insights_verify_only',routeHash:authority.routeHash,providerProjectId:route.provider_project_id,policy:policyValue,policyHash:hash(policyValue),...landingPins,validFrom,validUntil,...changes};
 const reviewHash=hash(content);await db.query('insert into private.r12_verification_candidate_reviews values($1,$2,$3,$4,$5,$6,$7)',[reviewHash,authority.routeHash,route.provider_project_id,hash(policyValue),content,validFrom,validUntil]);return reviewHash;
}
export async function withCandidateVerification(db,run,options={}){
 return prepareDirectTestAuthorityFixture(db,{configureReview:c=>qualifyInertOwnerRenderer(db,c),onPrepared:async a=>{const reviewHash=await insertCandidateReview(db,a,options.review);return runCandidateApprovedSetup(db,a,{beforeApproval:options.beforeApproval,runVerification:async ctx=>{
  let h;h=landingSqlVerification(ctx,{browserOptions:options.browserOptions,beforeRpc:options.beforeRpc,beforeNavigate:async()=>{
   for(const request of options.requests??[{url:candidateImage,resourceType:'Image'},{url:candidateScript,resourceType:'Script'},{url:candidateQueriedImage,resourceType:'Image'}]){
    if(options.beforeRequest)await options.beforeRequest(request,ctx,h,reviewHash);
    await h.browser.request(request.url,{resourceType:request.resourceType,request:{url:request.url,method:request.method??'GET'}});
   }
  }});
  const rpc=h.input.rpc;h.input.rpc=async(operation,payload)=>{
   const result=await rpc(operation,payload);
   if(options.afterRpc)await options.afterRpc(operation,payload,result,ctx,h,reviewHash);
   return operation==='admit_renderer'&&options.acknowledge?options.acknowledge(result,payload.request):result;
  };
  return run({ctx,h,reviewHash});
 }});}});
}
