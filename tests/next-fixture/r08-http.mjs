import assert from 'node:assert/strict';
import {id} from './data.mjs';
export async function runWorkspaceHttp({origin,boundary,check}){
 await fetch(boundary.origin+'/control',{method:'POST',body:JSON.stringify({workspace:true})});
 const cases=[['overview',{},/Real progress|No execution plan recorded/],['work',{selected:id(1001),episode:id(1001)},/Steps in execution order/],['research',{},/Research/],['library',{type:'records',selected:id(880000)},/Saved package 0/],['products-catalog',{selected:id(880000)},/Readiness blockers/],['products-catalog',{type:'listings',selected:id(885000)},/Supplier\/store\/variant association/],['decision-log',{selected:'admission:1'},/Blocked original dispatch/],['knowledge',{selected:id(790000)},/Installed pack snapshots/],['decisions',{},/New account scope requires confirmation/]];
 for(const [view,extra,expected]of cases)await check(`R08 production HTTP ${view} ${extra.type??''}`,async()=>{
  const url=new URL('/dashboard',origin);for(const[k,v]of Object.entries({view,business:id(1),quest:id(820000),...extra}))url.searchParams.set(k,v);
  const response=await fetch(url);const html=await response.text();assert.equal(response.status,200);assert.match(html,expected);assert.doesNotMatch(html,/NEXT_HTTP_ERROR_FALLBACK;404|Application error: a server-side exception/);
 });
}
