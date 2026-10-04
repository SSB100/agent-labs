import assert from 'node:assert/strict';
import {id} from './data.mjs';
import {knowledgeId} from './knowledge.mjs';
export const knowledgeRoute=(type='installed',extra={})=>'/dashboard?'+new URLSearchParams({view:'knowledge',business:id(1),type,...extra});
/** These production HTTP probes complement, rather than substitute, the Chromium journeys. */
export async function runKnowledgeHttp({origin,boundary,check}){
 await fetch(boundary.origin+'/control',{method:'POST',body:JSON.stringify({workspace:true,knowledge:true}),signal:AbortSignal.timeout(10_000)});
 const before=boundary.effects.length;
 const cases=[
  ['installed',id(790000),/Installed pack snapshots/],
  ['proposals',knowledgeId('version'),/Rejected redaction preserves this private evidence/],
  ['releases',knowledgeId('release',0,1),/Reviewed source comparison guidance/],
  ['applications',knowledgeId('application'),/Historical pins remain/],
  ['usage',knowledgeId('usage'),/Historical usage/],
 ];
 for(const[type,selected,expected]of cases)await check(`R09 production HTTP exact ${type}`,async()=>{
  const response=await fetch(origin+knowledgeRoute(type,{selected}),{signal:AbortSignal.timeout(30_000)}),html=await response.text();
  assert.equal(response.status,200);assert.match(html,expected);assert.doesNotMatch(html,/NEXT_HTTP_ERROR_FALLBACK;404|Application error: a server-side exception|Private inert Knowledge diagnostic/);
 });
 await check('R09 production HTTP rejects ambiguous and inaccessible Knowledge scopes',async()=>{
  for(const route of [knowledgeRoute('releases',{business:id(999999)}),knowledgeRoute('unknown'),knowledgeRoute('usage',{page:'402'}),knowledgeRoute('releases')+'&selected='+knowledgeId('release')+'&selected='+knowledgeId('release',0,1)]){
   const response=await fetch(origin+route,{signal:AbortSignal.timeout(30_000)});assert.equal(response.status,404,route);
  }
 });
 assert.equal(boundary.effects.length,before,'R09 HTTP reads must not invoke mutations');
}
