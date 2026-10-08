/** Focused boundary regression. Actual controls, owner/server/Core/adapter and
 * SQL run; only public catalog/provider transport is the existing inert fixture.
 * A fresh closedFocused source is required, never a prebuilt closedMarked. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {R12_INERT_ROOT,r12FixtureState} from '../next-fixture/r12-sql.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),require=createRequire(import.meta.url),ts=require('typescript');

function actualOwnerSource(boundary,post){
 const runtimeClient=createClient(boundary.origin,'inert-publishable-key',{auth:{autoRefreshToken:false,persistSession:false,detectSessionInUrl:false}}),cache=new Map();
 const inertProcess=Object.freeze({env:Object.freeze({VERCEL_ENV:'production',R05_ADMISSION_SERVER_KEY:R12_INERT_ROOT,OPENROUTER_API_KEY:'inert-r12-provider-placeholder',R03_BOUNDARY:boundary.origin})});
 const source=file=>{
  if(cache.has(file))return cache.get(file);const loaded={exports:{}};cache.set(file,loaded.exports);
  const filename=file.startsWith('tests/')?path.join(root,file):path.join(root,'src',file+'.ts');
  new Function('require','module','exports','process',ts.transpileModule(readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{
   if(name==='server-only')return{};if(name.startsWith('node:'))return require(name);
   if(name==='./supabase/runtime'||name==='@/lib/supabase/runtime')return{createRuntimeClient:()=>runtimeClient};
   if(name==='./discovery-r12-server-dependencies')return source('tests/next-fixture/r12-dependencies.ts');
   const target=name.startsWith('@/')?name.slice(2):path.posix.normalize(path.posix.join(path.posix.dirname(file),name));
   assert.ok(name.startsWith('.')||name.startsWith('@/'),name);
   const compiled=path.join(root,'.core-tests',target+'.js');return existsSync(compiled)?require(compiled):source(target);
  },loaded,loaded.exports,inertProcess);cache.set(file,loaded.exports);return loaded.exports;
 };
 const r=boundary.state().r12,context={userId:r.ownerId,businesses:[{id:r.businessId,name:'Inert boundary owner'}],supabase:{auth:{getClaims:()=>post('/claims',{})},rpc:(name,args)=>post('/rpc',{name,args})}};
 return{context,preparation:source('products/discovery-r12-pilot-preparation-server'),confirmation:source('products/discovery-r12-review-preparation-server'),server:source('products/discovery-r12-server'),owner:source('products/discovery-r12-owner')};
}

export async function exerciseR12TerminalBoundaryPreflight(db,closedFocused){
 const {startFixtureBoundary}=await import('../next-fixture/server.mjs'),boundary=await startFixtureBoundary(),transactions=[];let serial=0;
 const sql=async(statement,args)=>{
  const operation=statement.trim().toLowerCase();
  if(operation==='begin'){const name='terminal_boundary_'+serial++;transactions.push(name);return db.exec('savepoint '+name);}
  if(operation==='commit'||operation==='rollback'){const name=transactions.pop();assert.ok(name);if(operation==='rollback')await db.exec('rollback to savepoint '+name);else await db.exec('drop table if exists pg_temp.r12_bootstrap_input,pg_temp.r12_bootstrap_result');return db.exec('release savepoint '+name);}
  return args?db.query(statement,args):db.exec(statement);
 };
 const adapter={query:sql,exec:sql,close:async()=>{}},state=boundary.state(),metadata=closedFocused.metadata;
 state.owner=metadata.ownerId;state.r12={...await r12FixtureState(adapter,metadata,'focused-successor-preparation'),closedFocused,sourceScopeId:closedFocused.scopeId,preparationId:randomUUID(),setupUntil:metadata.focusedProfile.expiresAt};
 const names=['VERCEL_ENV','R05_ADMISSION_SERVER_KEY','OPENROUTER_API_KEY'],prior=Object.fromEntries(names.map(name=>[name,process.env[name]])),originalFetch=globalThis.fetch;let externalCalls=0;
 const report={version:'r12.terminal-boundary-preflight.1',engine:typeof db.dumpDataDir==='function'?'pglite':'native_postgresql',hostEnvAbsent:true,terminalSourceMs:null,providerCalls:0,passed:false};
 const fingerprint=async()=>(await db.query(`select (select count(*)::int from private.r12_pilot_technical_qualification_authorizations) terminal,(select count(*)::int from private.r12_discovery_scopes) scopes,(select count(*)::int from private.r05_markers) financial_markers,(select count(*)::int from private.r07_markers) controller_markers,(select count(*)::int from private.r12_discovery_transport_claims) claims`)).rows[0];
 const before=await fingerprint();await db.exec('savepoint terminal_boundary_preflight');
 try{
  for(const name of names)delete process.env[name];
  globalThis.fetch=(input,init)=>{if(new URL(String(input)).origin!==boundary.origin){externalCalls++;throw Error('Only the inert loopback boundary is allowed');}return originalFetch(input,init);};
  const post=async(endpoint,input,timeoutMs=10000)=>{const response=await fetch(boundary.origin+endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(timeoutMs)});const data=await response.json();assert.equal(response.status,200,JSON.stringify(boundary.denied));return data;};
  // This is the exact previously missed /control entry, under its existing60s
  // setup limit. No parent/Next-child process environment is inherited.
  const started=performance.now(),created=await post('/control',{r12FocusedSuccessorUnsent:'terminal-source'},60000);report.terminalSourceMs=Math.round(performance.now()-started);assert.ok(created.r12.handled.includes('r12FocusedSuccessorUnsent'));
  console.log('R12 exact terminal-source control:',JSON.stringify({hostEnvAbsent:true,elapsedMs:report.terminalSourceMs,providerCalls:0}));
  const r=state.r12,failed=structuredClone(r.closedMarked.markedClosure);assert.deepEqual(r.calls,[]);assert.deepEqual(r.receipts,[]);
  let app=actualOwnerSource(boundary,post);
  const input={businessId:r.businessId,sourceScopeId:r.sourceScopeId,preparationId:r.preparationId,setupUntil:r.setupUntil};
  const prepared=await app.preparation.prepareR12PilotGoal(app.context,input);assert.equal(prepared.authorityCreated,false);assert.deepEqual(await app.preparation.prepareR12PilotGoal(app.context,input),prepared);
  await post('/control',{r12FocusedSuccessorStage:prepared},60000);
  const confirmed=await app.confirmation.confirmR12ReviewPreparation(app.context,r.businessId,r.scopeId,r.staged.proposalHash);assert.equal(confirmed.executionAuthorized,false);assert.deepEqual(await app.confirmation.confirmR12ReviewPreparation(app.context,r.businessId,r.scopeId,r.staged.proposalHash),confirmed);
  await post('/control',{r12FocusedSuccessorActivate:confirmed,r12DelayReceipt:true},60000);
  const current=async()=>{const raw=await post('/rpc',{name:'r12_discovery_owner_read',args:{p_business_id:r.businessId,p_scope_id:r.scopeId,p_activation:false}});assert.equal(raw.error,null);return app.owner.parseDiscoveryR12Workspace(raw.data,r.businessId,r.scopeId);};
  const safeProgress=workspace=>{
   assert.ok(['prepared','ready','running','waiting','completed'].includes(workspace.state),JSON.stringify(workspace));assert.equal(workspace.policyRevoked,false);assert.equal(workspace.paused,false);
   assert.ok(r.calls.length<=2);assert.equal(new Set(r.calls).size,r.calls.length,'Saved progress never regenerates');assert.deepEqual(r.calls,['strategy','review'].slice(0,r.calls.length));
   assert.ok(r.receipts.length<=3);assert.deepEqual(r.receipts,['strategy','strategy','review'].slice(0,r.receipts.length));
   for(const phase of workspace.phases){assert.ok(!phase.responseDiagnostic);assert.ok(!['rejected','failed','cancelled'].includes(phase.status));if(['dispatched','uncertain'].includes(phase.status))assert.equal(phase.candidateSaved,true,'An uncertain unsaved response cannot be retried');if(phase.receipt)assert.ok(['awaiting_receipt','checking_receipt','verified'].includes(phase.receipt.status));if(phase.status==='completed')assert.equal(phase.outcome,'TEST');}
  };
  const waiting=workspace=>Boolean(workspace.continueAfter&&Date.parse(workspace.continueAfter)>Date.now()||workspace.phases.some(phase=>phase.status!=='completed'&&phase.receipt?.nextCheckAt&&Date.parse(phase.receipt.nextCheckAt)>Date.now()));
  const advanceDue=async(workspace,controls={})=>{safeProgress(workspace);assert.equal(waiting(workspace),true,'Only an observed future lease or receipt wait can become due');assert.equal(app.owner.discoveryR12CanContinue(workspace),false);await post('/control',{r12Due:true,...controls});};
  // Saved progress may span requests on a slower runner. Both checkpoints share
  // one eight-Continue ceiling; a terminal/ambiguous state is never a retry.
  let continues=0;
  const continueUntil=async predicate=>{for(;;){let workspace=await current();safeProgress(workspace);if(predicate(workspace))return workspace;assert.ok(continues<8,'Terminal boundary flow exceeded eight Continue calls');if(waiting(workspace)){await advanceDue(workspace);workspace=await current();safeProgress(workspace);}assert.equal(app.owner.discoveryR12CanContinue(workspace),true,JSON.stringify(workspace));continues++;const result=await app.server.continueDiscoveryR12(app.context,r.businessId,r.scopeId);assert.ok(result.status==='completed'||result.status==='waiting'&&['receipt_pending','continue_saved_progress'].includes(result.reason),JSON.stringify(result));}};
  const first=await continueUntil(workspace=>workspace.phases[0].candidateSaved&&workspace.phases[0].receipt?.status==='awaiting_receipt');assert.equal(first.phases[0].receipt.attempts,1);assert.deepEqual(r.calls,['strategy']);assert.deepEqual(r.receipts,['strategy']);
  // Fresh module/client/store instances represent reload. Read saved truth;
  // do not invoke another generation while its receipt/lease is not due.
  app=actualOwnerSource(boundary,post);
  const workspace=await current();assert.equal(workspace.phases[0].candidateSaved,true);assert.equal(workspace.phases[0].receipt.status,'awaiting_receipt');assert.equal(app.owner.discoveryR12CanContinue(workspace),false);assert.deepEqual(r.calls,['strategy']);
  await advanceDue(workspace,{r12DelayReceipt:false});
  const second=await continueUntil(saved=>saved.state==='completed');assert.equal(second.phases[1].outcome,'TEST');assert.deepEqual(r.calls,['strategy','review']);assert.deepEqual(r.receipts,['strategy','strategy','review']);report.continueCalls=continues;
  assert.deepEqual(await app.server.stopDiscoveryR12(app.context,r.businessId,r.scopeId),{stopped:true});
  const close={businessId:r.businessId,scopeId:r.scopeId,scopeHash:r.staged.scopeHash,policyId:confirmed.policyId,policyHash:confirmed.policyHash,planHash:r.activated.planHash,terminalAuthorizationHash:r.authorizationHash};
  await post('/control',{r12FocusedSuccessorClose:close},60000);assert.equal(r.successorClosed.activeAuthority,false);
  assert.deepEqual((await db.query('select private.r12_pilot_marked_closure($1) result',[failed.scopeId])).rows[0].result,failed);
  assert.equal((await db.query('select count(*)::int n from private.r12_pilot_technical_qualification_authorizations where budget_authority_root_id=$1',[metadata.focusedProfile.budgetAuthorityRootId])).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int n from public.creative_runs')).rows[0].n,0);
  assert.deepEqual(transactions,[]);assert.deepEqual(boundary.denied,[]);assert.equal(externalCalls,0);assert.ok(names.every(name=>process.env[name]===undefined));
  report.inertPosts=r.calls.length;report.inertReceiptGets=r.receipts.length;report.activeAuthority=false;report.passed=true;return report;
 }catch(error){
  console.log('R12 terminal boundary failure:',JSON.stringify({message:error.message,terminalSourceMs:report.terminalSourceMs,denied:boundary.denied,transports:boundary.log.filter(row=>row.kind==='inert-r12-provider-transport'),inertPosts:state.r12?.calls,inertReceiptGets:state.r12?.receipts,externalCalls}));throw error;
 }finally{
  globalThis.fetch=originalFetch;for(const[name,value]of Object.entries(prior)){if(value===undefined)delete process.env[name];else process.env[name]=value;}
  await boundary.close();await db.exec('rollback to savepoint terminal_boundary_preflight');await db.exec('release savepoint terminal_boundary_preflight');assert.deepEqual(await fingerprint(),before,'The focused boundary test restores its parent fixture');
 }
}
