/** In-process HTTP/form composition of actual owner pages, actions and servers.
 * Next hosting/shell and provider/browser leaf IO are inert. The explicit legacy
 * enrollment read has no offers. Existing authority RPCs, owner ACLs, persistent
 * access approval, encrypted handoff and verification are real.
 * The new configuration admission is an explicitly synthetic pre-21300 leaf.
 * This does not qualify Next action serialization, Chromium, or hosted workflows. */
import assert from 'node:assert/strict';
import {readbackSource} from './r12-steel-readback-sql-fixture.mjs';
import {inertSteelCreateConfigurationPermit} from './etsy-steel-create-config-fixture.mjs';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {prepareDirectTestAuthorityFixture} from './r12-direct-test-authority-fixture.mjs';
import {qualifyInertOwnerRenderer} from './r12-direct-setup-renewal-fixture.mjs';
import {one} from './r12-owner-initial-sql-fixture.mjs';
import {r12CatalogFixture} from './r12-provider-fixture.mjs';
import {verificationFixture} from './etsy-insights-playwright-fixture.mjs';
import {INERT_DIRECT_RUNTIME_ROOT} from './r12-direct-runtime-composition-fixture.mjs';
const require=createRequire(import.meta.url),ts=require('typescript'),React=require('react'),jsx=require('react/jsx-runtime'),{renderToStaticMarkup}=require('react-dom/server');
const core=name=>require('../../.core-tests/'+name+'.js');
const {discoveryV2Hash:hash}=core('products/discovery-v2-hash');
const quote=core('products/discovery-r12-adaptive-quote');
const policy=core('browser/etsy-insights-policy');
const handoff=core('accounts/etsy-steel-handoff-rpc'),verification=core('accounts/etsy-steel-verification-runtime');
const {SteelBrowserAdapter}=core('browser/providers/steel');
export {INERT_DIRECT_RUNTIME_ROOT};
export function loadActualOwnerModule(file,deps){
 const source=readFileSync(file,'utf8'),loaded={exports:{}};
 const code=ts.transpileModule(source,{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new Function('require','module','exports',code)(name=>{assert.ok(Object.hasOwn(deps,name),'Unexpected source import '+name+' in '+file);return deps[name];},loaded,loaded.exports);
 return {...loaded.exports,sourceHash:createHash('sha256').update(source).digest('hex')};
}
export async function ownerJourneyAuthority(db){
 return prepareDirectTestAuthorityFixture(db,{legacy:{committedMicrounits:1900000},beforePrepare:a=>a,configureReview:async v=>{
  const {f,project,routeHash,validFrom,validUntil}=v;
  await qualifyInertOwnerRenderer(db,{...v,policy:core('accounts/etsy-steel-owner-bootstrap').ETSY_OWNER_BOOTSTRAP_POLICY});
  const inference=quote.qualifyEtsyOwnerResearchQuote(r12CatalogFixture(),Date.now());
  const worker=await one(db,'select to_jsonb(w) row from public.worker_definitions w where id=$1',[f.pins.workers.search1.id]),sourceId=randomUUID();
  const sourceRow={...worker.row,id:sourceId,worker_key:'product.discovery-v2.etsy-insights',name:'Synthetic qualified owner journey Insights source',status:'qualified',role:'etsy_insights_read_only',charter:'Inert reviewed source for owner journey qualification. Read only approved aggregate evidence, never credentials or private account data.',input_schema:{type:'object',properties:{version:{const:'r12.etsy-insights-source-scope.1'}}},output_schema:{type:'object',properties:{version:{const:'r12.etsy-insights-source-receipt.1'}}},capability_requirements:['browser.etsy.insights.read_only'],model_requirements:{}};
  await db.query('insert into public.worker_definitions select (jsonb_populate_record(null::public.worker_definitions,$1)).*',[sourceRow]);
  const source=await one(db,'select id,private.r04_hash(to_jsonb(w)) hash from public.worker_definitions w where id=$1',[sourceId]),installation=await one(db,"select id from public.installed_packs where business_id=$1 and root_pack_id=$2 and status='active'",[f.businessId,f.pins.packId]);
  const qualification={version:'r12.direct-source-qualification.1',mode:'execution',providerProjectId:project,workerHash:source.hash,workflowHash:f.pins.workflowHash,sourcePolicyHash:policy.ETSY_INSIGHTS_SOURCE_POLICY_HASH,capturePolicyHash:policy.ETSY_INSIGHTS_CAPTURE_POLICY_HASH,routeHash,purpose:'etsy_insights_read_only',guardedRendererQualified:true,privateDataExclusionQualified:true,rendererPolicy:{version:'etsy.insights-renderer-policy.1',staticOrigins:[],maximumRequests:256,navigation:'fixed_insights_get_only',sameOrigin:'renderer_get_only',post:'denied',extraction:'visible_aggregate_dom_only'}};
  const qualificationHash=hash(qualification);
  await db.query(`insert into private.r12_direct_source_qualifications values($1,$2,$3,$4,$5,$6,$7,$8,$9,'etsy_insights_read_only',$10,$11,$12)`,[qualificationHash,sourceId,source.hash,f.pins.workflowDefinitionId,f.pins.workflowHash,project,routeHash,policy.ETSY_INSIGHTS_SOURCE_POLICY_HASH,policy.ETSY_INSIGHTS_CAPTURE_POLICY_HASH,qualification,validFrom,validUntil]);
  const reviewed={researchPins:{version:'r12.direct-research-pins.1',installationId:installation.id,packId:f.pins.packId,snapshot:f.pins.snapshot,snapshotHash:f.pins.snapshotHash,workflowDefinitionId:f.pins.workflowDefinitionId,workflowHash:f.pins.workflowHash,workers:{plan:f.pins.workers.plan,source,strategy:f.pins.workers.strategy,review:f.pins.workers.review},sourcePolicyHash:policy.ETSY_INSIGHTS_SOURCE_POLICY_HASH,capturePolicyHash:policy.ETSY_INSIGHTS_CAPTURE_POLICY_HASH,inferenceCatalogHash:inference.baseQuoteHash,executionReviewHash:qualificationHash,eligibilityReviewHash:f.pins.eligibilityReviewHash,policyInterpretationHash:f.pins.policyInterpretationHash,knowledgeValidUntil:validUntil},profileTemplate:{id:randomUUID(),marketSetKey:'gb',topicKey:'astronomy',publicGoal:'Investigate original astronomy T-shirt opportunities for adult buyers.',productFormat:'original_pod_tshirt',category:'original apparel',markets:[{countryCode:'GB',currency:'GBP'}],audience:'Adult astronomy enthusiasts'}};
  if(process.env.R12_OWNER_PINS_CAPTURE)writeFileSync(process.env.R12_OWNER_PINS_CAPTURE,JSON.stringify(reviewed.researchPins));
  return reviewed;
 }});
}
export function ownerJourneyComposition(db,a){
 const historicalReadbackCalls=[],historicalReadbackErrors=[],rpcCalls=[],errors=[],cleanup=[],providerCalls=[],browsers=[],workflowStarts=[],resumes=[],sourceHashes={},boundarySubstitutions=[];
 const preparation={...core('products/discovery-r12-public-preparation'),validatePublicResearchOwnerTestReceipt(...args){try{return core('products/discovery-r12-public-preparation').validatePublicResearchOwnerTestReceipt(...args);}catch(error){errors.push({name:'receipt_validation',message:error.stack,pinsBytes:Buffer.byteLength(JSON.stringify(args[0]?.preview?.researchPins??null))});throw error;}}};
 const profileId=randomUUID(),sessions=new Map(),transports=[];let activeUser=a.f.ownerId,tail=Promise.resolve();
 const serial=work=>{const next=tail.then(work,work);tail=next.catch(()=>{});return next;};
 const allowed=new Set(['r12_owner_steel_config_readback','r12_steel_config_readback_server','r12_steel_create_config_admit','r12_owner_direct_enrollment_read','r12_owner_direct_read','r12_owner_direct_server','r12_etsy_steel_owner','r12_owner_etsy_steel_verification_read','r12_owner_etsy_steel_renderer_review','r12_etsy_steel_server','r12_etsy_steel_verification_server','r12_direct_browser_ledger','r12_direct_setup_quote_revalidate','r12_direct_owner_renderer_qualification','r12_direct_controller_server']);
 function client(role){return{rpc:async(name,args)=>serial(async()=>{
  assert.ok(allowed.has(name));const owner=activeUser;(name==='r12_owner_steel_config_readback'||name==='r12_steel_config_readback_server'?historicalReadbackCalls:rpcCalls).push({role,name,operation:args.p_operation,owner});
  // This owner journey ends before 21300. The only new boundary substitution
  // echoes a correctly scoped inert configuration permit; it is forbidden if
  // real configuration authority exists in the database.
  if(name==='r12_steel_create_config_admit'){
   assert.equal(role,'anon');assert.equal(args.p_business_id,a.f.businessId);
   assert.equal((await one(db,"select to_regprocedure('public.r12_steel_create_config_admit(uuid,jsonb,text)') is null absent")).absent,true,'Historical configuration leaf cannot bypass 21300');
   const saved=await one(db,`select o.scope_hash,o.scope->>'providerProjectId' project,
    case when s.operation_id is not null then 'handoff' else 'verification' end expected_purpose,k.purpose
    from private.r12_direct_browser_operations o
    join private.r12_direct_test_envelopes e on e.id=o.envelope_id and e.business_id=$2
    left join private.r12_etsy_steel_setups s on s.operation_id=o.id
    join private.r12_etsy_steel_keys k on k.envelope_id=e.id and k.route_hash=o.route_hash and k.key_hash=encode(extensions.digest(convert_to($3,'UTF8'),'sha256'),'hex')
    where o.id=$1`,[args.p_request.operationId,a.f.businessId,args.p_server_key]);
   assert.ok(saved);assert.equal(saved.purpose,saved.expected_purpose);assert.equal(args.p_request.scopeHash,saved.scope_hash);assert.equal(args.p_request.providerProjectId,saved.project);
   if(!boundarySubstitutions.length)boundarySubstitutions.push('historical_pre_21300_configuration_admission_leaf');
   return{data:inertSteelCreateConfigurationPermit(args.p_request),error:null};
  }
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[role==='authenticated'?owner:'']);await db.exec('set role '+role);
  try{
   // Explicit legacy-only UI projection. The separate enrollment journey executes
   // the real migrated enrollment RPC; this old authority fixture has no offers.
   if(name==='r12_owner_direct_enrollment_read'){assert.equal(role,'authenticated');assert.equal(owner,a.f.ownerId);assert.equal(args.p_business_id,a.f.businessId);assert.equal(args.p_goal_id,a.f.goalId);assert.equal(args.p_proposal_id,null);return{data:{version:'r12.owner-direct-enrollment-catalog.1',businessId:a.f.businessId,goalId:a.f.goalId,ownerId:owner,eligible:false,reason:'reviewed_package_required',offers:[],current:null},error:null};}
   if(name==='r12_owner_etsy_steel_renderer_review'&&faults.rendererReadUnavailable)throw Error('Inert renderer review read unavailable');
   const names=Object.keys(args);assert.ok(names.every(x=>/^p_[a-z_]+$/.test(x)));
   const data=(await one(db,`select public.${name}(${names.map((x,i)=>x+' => $'+(i+1)).join(',')}) result`,Object.values(args))).result;
   if(args.p_operation==='transport')transports.push(args.p_payload.request);
   return{data,error:null};
  }catch(error){const historical=name==='r12_owner_steel_config_readback'&&error.code==='42883';(historical?historicalReadbackErrors:errors).push({role,name,operation:args.p_operation,message:error.message});return{data:null,error};}
  finally{await db.exec('reset role');}
 }),auth:{getClaims:async()=>({data:{claims:{sub:activeUser}},error:null})},from(table){assert.equal(table,'businesses');const filters={};const chain={select(){return chain;},eq(k,v){filters[k]=v;return chain;},async maybeSingle(){return serial(async()=>({data:await one(db,'select id,name,created_at,updated_at from public.businesses where id=$1 and owner_user_id=$2',[filters.id,filters.owner_user_id])??null,error:null}));}};return chain;}};}
 const authenticated=client('authenticated'),runtime=client('anon');
 const context=()=>({userId:activeUser,supabase:authenticated,businesses:activeUser===a.f.ownerId?[{id:a.f.businessId,name:'Inert owner Business'}]:[]});
 const config={apiKey:'inert-owner-journey-steel-key',baseUrl:'https://api.steel.dev'};
 const rawFetcher=async(address,init={})=>{
  const url=new URL(address),method=init.method??'GET',admitted=transports.shift();assert.ok(admitted,'Provider IO requires a successful real SQL transport receipt');assert.equal(admitted.endpoint,url.href);assert.equal(admitted.method,method);
  providerCalls.push({operation:admitted.operation,method,path:url.pathname});assert.equal(url.origin,'https://api.steel.dev');
  if(url.pathname==='/v1/sessions'){
   assert.equal(method,'POST');const b=JSON.parse(init.body);assert.equal(b.projectId,a.project);assert.equal(sessions.has(b.sessionId),false,'Never repeat a paid session create');
   assert.equal(b.useProxy,false);assert.equal(b.solveCaptcha,false);if(!b.persistProfile)assert.equal(b.profileId,profileId);
   sessions.set(b.sessionId,{body:b,released:false});
   return Response.json(metadata(b.sessionId));
  }
  if(url.pathname.startsWith('/v1/profiles/')){assert.equal(url.pathname,'/v1/profiles/'+profileId);const login=[...sessions].find(([,s])=>s.body.persistProfile);assert.ok(login?.[1].released);return Response.json({id:profileId,projectId:a.project,sourceSessionId:login[0],status:'READY'});}
  const id=url.pathname.split('/')[3],s=sessions.get(id);assert.ok(s);
  if(url.pathname.endsWith('/release')){assert.equal(method,'POST');assert.equal(s.released,false);s.released=true;return Response.json({success:true});}
  assert.equal(method,'GET');return Response.json(metadata(id));
 };
 const fetcher=(...args)=>rawFetcher(...args).catch(error=>{errors.push({name:'inert_provider_assertion',message:error.stack});throw error;});
 function metadata(id){const s=sessions.get(id);return{id,projectId:a.project,profileId,status:s.released?'released':'live',debugUrl:`https://api.steel.dev/v1/sessions/${id}/player`,solveCaptcha:false,useProxy:false,proxyBytesUsed:0,proxySource:null,timeout:s.body.timeout,duration:1000};}
 function browser(){const options={shop:'SyntheticShop'},f=verificationFixture(options);options.beforeNavigate=url=>f.request(url);const go=f.page.goto;f.page.goto=async(...args)=>{await go(...args);return{status:()=>200};};browsers.push(f);return f;}
 const shared={'server-only':{},'node:crypto':require('node:crypto'),'../core/request-deadline':core('core/request-deadline'),'../lib/supabase/runtime':{createRuntimeClient:()=>runtime},'../lib/core-ui/owner-business':loadActualOwnerModule('src/lib/core-ui/owner-business.ts',{}),'../products/discovery-r12-public-preparation':core('products/discovery-r12-public-preparation'),'../products/discovery-r12-public-server-key':core('products/discovery-r12-public-server-key'),'../products/discovery-v2-hash':core('products/discovery-v2-hash')};
 const load=(file,deps)=>{const result=loadActualOwnerModule(file,{...shared,...deps});sourceHashes[file]=result.sourceHash;return result;};
 const owner=load('src/accounts/etsy-steel-handoff-owner-server.ts',{'./etsy-steel-handoff-contracts':core('accounts/etsy-steel-handoff-contracts'),'./etsy-steel-handoff-owner':load('src/accounts/etsy-steel-handoff-owner.ts',{'./etsy-steel-handoff-contracts':core('accounts/etsy-steel-handoff-contracts')})});
 const account=load('src/accounts/etsy-steel-handoff-server.ts',{
  get '../browser/etsy-steel-create-binding'(){const actual=core('browser/etsy-steel-create-binding');return{...actual,getSteelCreateDeployment:()=>actual.getSteelCreateDeployment({VERCEL_ENV:'production',VERCEL_DEPLOYMENT_ID:'dpl_inert_historical_owner',VERCEL_GIT_COMMIT_SHA:'1'.repeat(40)})};},
  'next/server':{after:work=>cleanup.push(work)},'./etsy-steel-handoff-owner-server':owner,'./etsy-steel-handoff-contracts':core('accounts/etsy-steel-handoff-contracts'),
  './etsy-steel-handoff-rpc':{...handoff,createEtsySteelHandoffRpcDependencies:input=>{const f=browser();return handoff.createEtsySteelHandoffRpcDependencies({...input,config,fetcher,connect:f.input.connect});}},
  '../browser/providers/steel':{SteelBrowserAdapter:class extends SteelBrowserAdapter{constructor(input){super({...input,config,fetcher});}}},
  './etsy-steel-verification-runtime':{...verification,verifyApprovedEtsySteelProfile:input=>{const f=browser();return verification.verifyApprovedEtsySteelProfile({...input,config,fetcher,connect:f.input.connect});}},
  '../browser/etsy-steel-accounting':core('browser/etsy-steel-accounting'),'./etsy-steel-handoff-runtime':core('accounts/etsy-steel-handoff-runtime'),
 });
 const enrollmentContracts=load('src/products/discovery-r12-direct-enrollment-contracts.ts',{'./discovery-r12-public-utils':core('products/discovery-r12-public-utils')});
 const enrollment=load('src/products/discovery-r12-direct-enrollment-server.ts',{'./discovery-r12-public-utils':core('products/discovery-r12-public-utils'),'./discovery-r12-direct-enrollment-contracts':enrollmentContracts});
 const hooks=new Map(),faults={hookLookupUnavailable:false,rendererReadUnavailable:false};class HookNotFoundError extends Error{static is(error){return error instanceof HookNotFoundError;}}
 const workflow={directResearchRuntimeWorkflow:()=>{throw Error('Hosting is inert');},directResearchResumeToken:id=>'agent-labs:direct-etsy-reconcile:'+id};
 const product=load('src/products/discovery-r12-public-owner-server.ts',{'./discovery-r12-public-repair':core('products/discovery-r12-public-repair'),
  'workflow/api':{start:async(fn,inputs)=>{assert.equal(fn,workflow.directResearchRuntimeWorkflow);const runId='inert-owner-workflow-'+randomUUID();workflowStarts.push({runId,input:structuredClone(inputs[0])});const token=workflow.directResearchResumeToken(inputs[0].scopeId);hooks.set(token,{token,runId,isWebhook:false});return{runId};},getHookByToken:async token=>{if(faults.hookLookupUnavailable)throw Error('Inert hosting read unavailable');if(!hooks.has(token))throw new HookNotFoundError('Inert hook not found');return hooks.get(token);},resumeHook:async(hook,payload)=>{assert.equal(hooks.get(hook.token),hook);resumes.push({token:hook.token,payload});}},'workflow/internal/errors':{HookNotFoundError},
  './discovery-r12-public-utils':core('products/discovery-r12-public-utils'),'./discovery-r12-public-preparation':preparation,'./discovery-r12-public-contracts':core('products/discovery-r12-public-contracts'),'./discovery-r12-public-server-key':core('products/discovery-r12-public-server-key'),'../workflows/direct-research-runtime':workflow,'../accounts/etsy-steel-handoff-contracts':core('accounts/etsy-steel-handoff-contracts'),'../accounts/etsy-steel-handoff-owner-server':owner,
  get './discovery-r12-public-reviewer-quote'(){return core('products/discovery-r12-public-reviewer-quote');},
  './discovery-r12-adaptive-quote':{...quote,fetchAdaptiveResearchQuote:input=>quote.fetchAdaptiveResearchQuote({...input,fetch:async(address,init)=>{assert.equal(init.method,'GET');const f=Object.values(r12CatalogFixture()).find(x=>x.url===String(address));assert.ok(f);return Response.json(f.payload);}})},
 });
 class Redirect extends Error{constructor(url){super('Inert Next redirect');this.url=url;}}
 const ui={'@/lib/core-ui/data':{requireOwnerUiContext:async()=>context()},'next/navigation':{redirect:url=>{throw new Redirect(url);},notFound:()=>{throw Error('not_found');}},'next/cache':{revalidatePath:()=>{}}};
 // Current page imports use the real metadata module. Historical SQL has no
 // 21400 authority, so its actual read fails closed and the page says unavailable.
 const readback=readbackSource().load('src/accounts/etsy-steel-readback-owner-server.ts');
 const productActions=load('src/app/dashboard/products/etsy-research/actions.ts',{...ui,'@/products/discovery-r12-public-owner-server':product,'@/products/discovery-r12-direct-enrollment-server':enrollment,'@/accounts/etsy-steel-readback-owner-server':readback,'@/products/discovery-r12-public-contracts':core('products/discovery-r12-public-contracts')});
 const accountActions=load('src/app/dashboard/accounts/etsy-research/actions.ts',{...ui,'@/accounts/etsy-steel-handoff-owner-server':owner,'@/accounts/etsy-steel-handoff-server':account});
 // Display-only input seam: actions and authority always use the real product module.
 const uiState={nextAction:null};const pageProduct={...product,readDirectResearchCatalog:async(...args)=>{const c=await product.readDirectResearchCatalog(...args);return uiState.nextAction===null?c:{...c,researchState:{...c.researchState,nextAction:uiState.nextAction}};}};
 const actionMap=new Map(Object.entries({...productActions,...accountActions}).filter(([,x])=>typeof x==='function'));
 const fnNames=new Map([...actionMap].map(([n,fn])=>[fn,n]));
 const wrap=(fn)=>(type,props,key)=>{if(type==='form'&&typeof props?.action==='function'){assert.ok(fnNames.has(props.action));props={...props,method:'POST',action:'/__inert_owner_action/'+fnNames.get(props.action)};}return fn(type,props,key);};
 const renderDeps={...ui,'react/jsx-runtime':{...jsx,jsx:wrap(jsx.jsx),jsxs:wrap(jsx.jsxs)},'next/link':{__esModule:true,default:props=>React.createElement('a',{...props,prefetch:undefined},props.children)},'@/components/stage7/app-shell':{AppShell:p=>React.createElement('main',null,p.children),PageHeader:p=>React.createElement('header',null,React.createElement('h1',null,p.title),p.description,p.actions)},'@/components/console/console-retained-workspace':{ConsoleRetainedWorkspace:p=>React.createElement(React.Fragment,null,p.header,...p.panels.map(x=>React.createElement('div',{key:x.id},x.content)))} };
 const pages={
  '/dashboard/products/etsy-research':load('src/app/dashboard/products/etsy-research/page.tsx',{...renderDeps,'@/products/discovery-r12-public-owner-server':pageProduct,'@/products/discovery-r12-direct-enrollment-server':enrollment,'@/accounts/etsy-steel-readback-owner-server':readback,'@/products/discovery-r12-public-preparation':core('products/discovery-r12-public-preparation'),'@/products/discovery-r12-public-utils':core('products/discovery-r12-public-utils'),'./actions':productActions}).default,
  '/dashboard/accounts/etsy-research':load('src/app/dashboard/accounts/etsy-research/page.tsx',{...renderDeps,'@/accounts/etsy-steel-handoff-owner-server':owner,'@/accounts/etsy-steel-handoff-contracts':core('accounts/etsy-steel-handoff-contracts'),'./actions':accountActions,'../accounts.css':{}}).default,
  '/dashboard/accounts/etsy-research/sign-in':load('src/app/dashboard/accounts/etsy-research/sign-in/page.tsx',{...renderDeps,'@/accounts/etsy-steel-handoff-server':account,'@/accounts/etsy-steel-handoff-contracts':core('accounts/etsy-steel-handoff-contracts'),'../actions':accountActions}).default,
 };
 async function handle(request){const url=new URL(request.url);try{if(request.method==='GET'){assert.ok(pages[url.pathname]);const element=await pages[url.pathname]({searchParams:Promise.resolve(Object.fromEntries(url.searchParams))});return new Response(renderToStaticMarkup(element),{headers:{'Content-Type':'text/html'}});}assert.equal(request.method,'POST');const action=actionMap.get(url.pathname.split('/').at(-1));assert.ok(action);await action(await request.formData());throw Error('Action returned without redirect');}catch(error){if(error instanceof Redirect)return new Response(null,{status:303,headers:{Location:error.url}});throw error;}finally{await Promise.all(cleanup.splice(0));}}
 return{a,historicalReadbackCalls,historicalReadbackErrors,boundarySubstitutions,owner,account,product,enrollment,uiState,context,runtime,handle,sourceHashes,rpcCalls,errors,providerCalls,browsers,workflowStarts,resumes,hooks,faults,profileId,sessions,setUser:id=>{activeUser=id;},async invoke(group,name,args){const target={product,account,owner,enrollment,readback}[group];assert.ok(target&&typeof target[name]==='function'&&name!=='sourceHash');try{return await target[name](context(),...args);}finally{await Promise.all(cleanup.splice(0));}},get:async path=>handle(new Request('http://inert.local'+path)),async post(action,data){return handle(new Request('http://inert.local/__inert_owner_action/'+action,{method:'POST',body:new URLSearchParams(data)}));}};
}
export function ownerRenderedForm(html,button){
 const decode=s=>s.replaceAll('&amp;','&').replaceAll('&quot;','"').replaceAll('&#x27;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>');
 const forms=[...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].map(x=>x[0]).filter(x=>[...x.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].some(m=>decode(m[1].replace(/<[^>]+>/g,''))===button));assert.equal(forms.length,1,'One rendered form for '+button);
 const form=forms[0],action=decode(form.match(/<form[^>]*action="([^"]+)"/)[1]).split('/').at(-1),fields={};
 for(const m of form.matchAll(/<input\b[^>]*>/g)){const name=m[0].match(/name="([^"]+)"/),value=m[0].match(/value="([^"]*)"/);if(name&&value)fields[decode(name[1])]=decode(value[1]);}
 return{action,fields,html:form};
}
