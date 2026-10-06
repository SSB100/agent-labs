import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSource } from './helpers/guided-ui.mjs';
const { consoleConnectionSummary } = loadSource('src/lib/core-ui/console-data.ts', {'@/products/discovery-v2-goal': {}, '@/products/discovery-v2-budget': {}});
const now = Date.parse('2026-10-05T23:00:00Z');
const connection = provider => ({id:`${provider}-binding`,revision:'current-revision',provider,label:`Exact ${provider} store`,externalAccountId:'42',status:'connected',custody:'encrypted_oauth',verifiedAt:'2026-10-05T22:00:00Z',expiresAt:'2026-11-05T22:00:00Z',permittedOperations:provider==='etsy'?['shop.read','listing.read']:['catalog.read'],providerExpiryVerified:true});
const workspace = () => ({businessId:'exact-business',unavailable:false,configured:true,connections:[connection('etsy'),connection('printful')],grants:[],attempts:[],readWindows:[]});
test('R12 connection summaries derive only qualified bindings and link exact Business without live calls',()=>{
 const data=workspace(),result=consoleConnectionSummary(data,'Business',now);assert.equal(result.status,'ready');
 assert.deepEqual(Array.from(result.items,x=>x.state),['verified','verified']);
 for(const item of result.items){assert.equal(item.href,'/dashboard/connections?business=exact-business');assert.match(item.detail,/no selling authority/);}
 assert.deepEqual(data,workspace());
});
test('R12 expired Etsy token distinguishes exact approved lazy refresh from disconnected or refreshed claims',()=>{
 const data=workspace(),etsy=data.connections[0];etsy.status='token_expired';etsy.tokenExpiresAt='2026-10-05T22:30:00Z';
 data.readWindows=[{id:'window',connectionId:etsy.id,bindingRevision:etsy.revision,expiresAt:'2026-11-05T00:00:00Z',mode:'lazy',state:'available',configured:true,maxReads:743,maxRefreshes:743,readsDispatched:0,refreshesDispatched:0,minRefreshSeconds:3000}];
 const item=consoleConnectionSummary(data,'Business',now).items[0];assert.equal(item.label,'Token expired · refresh approved');assert.equal(item.state,'needs_attention');assert.match(item.detail,/next authorized own-shop read/);assert.equal(data.readWindows[0].readsDispatched,0);
 for(const change of [{bindingRevision:'stale'},{connectionId:'other'},{state:'revoked'},{configured:false},{mode:'qualification'},{expiresAt:'2026-10-01T00:00:00Z'},{readsDispatched:743},{refreshesDispatched:743}]){
  const bad=structuredClone(data);Object.assign(bad.readWindows[0],change);assert.equal(consoleConnectionSummary(bad,'Business',now).items[0].label,undefined,JSON.stringify(change));
 }
});
test('R12 expired, revoked, changed, unavailable and conflicting records never claim verified access',()=>{
 for(const change of [{expiresAt:'2026-10-01T00:00:00Z'},{verifiedAt:'bad'},{verifiedAt:'2026-11-01T00:00:00Z'},{status:'revoked'},{status:'credential_changed'},{status:'refresh_uncertain'},{status:'refresh_unverified'},{tokenExpiresAt:'2026-10-01T00:00:00Z'}]){const data=workspace();Object.assign(data.connections[0],change);assert.equal(consoleConnectionSummary(data,'Business',now).items[0].state,'needs_attention');}
 const missing=workspace();missing.connections=[];assert.equal(consoleConnectionSummary(missing,'Business',now).items[0].state,'not_connected');
 const unavailable=workspace();unavailable.unavailable=true;assert.equal(consoleConnectionSummary(unavailable,'Business',now).status,'unavailable');
 const duplicate=workspace();duplicate.connections.push({...duplicate.connections[0]});assert.equal(consoleConnectionSummary(duplicate,'Business',now).status,'unavailable');
 assert.equal(consoleConnectionSummary(null,'Business',now).status,'unavailable');assert.equal(consoleConnectionSummary(workspace(),'Business',NaN).status,'unavailable');
 const disabled=workspace();disabled.configured=false;assert.equal(consoleConnectionSummary(disabled,'Business',now).items[0].state,'needs_attention');
});

test('R12 main Connections scopes unavailable status and keeps qualified Details reachable',async()=>{
 const {renderDashboard}=await import('./helpers/guided-ui.mjs');
 const businessId='00000000-0000-4000-8000-000000000001';
 const html=await renderDashboard({view:'connections',contextOverrides:{businesses:[{id:businessId,name:'Exact Business'}]},queryOverrides:{business:businessId},qualifiedConnectionRecords:{...workspace(),businessId,unavailable:true}});
 assert.match(html,new RegExp(`href="/dashboard/connections\\?business=${businessId}"[^>]*>Details`));
 assert.match(html,/Connection records unavailable/);assert.match(html,/<details><summary>Legacy setup requests/);assert.doesNotMatch(html,/Verified on record/);
});
test('R12 provider-only return leaves the selected legacy flow open without asserting its health',async()=>{
 const {renderDashboard}=await import('./helpers/guided-ui.mjs');
 const html=await renderDashboard({view:'connections',queryOverrides:{provider:'etsy'}});
 assert.match(html,/<details open=""><summary>Legacy setup requests/);assert.match(html,/Legacy setup registry:/);
});
test('R12 empty outputs and legacy cost ledgers keep separate qualified research discoverable',async()=>{
 const {renderDashboard}=await import('./helpers/guided-ui.mjs');
 const html=await renderDashboard({empty:true});
 assert.match(html,/No outputs linked in this view/);assert.match(html,/Qualified public-research results/);assert.match(html,/Qualified public-research receipts/);assert.doesNotMatch(html,/No saved outputs yet/);
});
