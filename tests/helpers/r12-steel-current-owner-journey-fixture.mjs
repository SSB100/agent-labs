/** Current 21400 -> 21300 -> owner-enrolled research journey. No grant is seeded.
 * Private fixture publishers are operator-only steps outside the owner surface.
 * Actual source functions, SQL, owner forms, model/source driver and admissions
 * execute unchanged. Only provider IO, browser objects and hosting are inert. */
import assert from 'node:assert/strict';
import {readbackSource,readbackTarget,publishReadback,READBACK_MIGRATION} from './r12-steel-readback-sql-fixture.mjs';
import {steelConfigDatabase,INERT_STEEL_CONFIG,INERT_STEEL_DEPLOYMENT,inertSteelConfiguration} from './r12-steel-config-sql-fixture.mjs';
import {steelConfigResearchRuntimeComposition} from './r12-steel-config-source-fixture.mjs';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {loadActualOwnerModule,ownerRenderedForm} from './r12-direct-owner-journey-fixture.mjs';
import {enrollmentOriginFixture,inertEnrollmentExternalEvidence,ENROLLMENT_ROOT} from './r12-direct-enrollment-sql-fixture.mjs';
import {buildDirectEnrollmentReviewPackage} from './r12-direct-enrollment-review-package.mjs';
import {one} from './r12-owner-initial-sql-fixture.mjs';
import {r12CatalogFixture} from './r12-provider-fixture.mjs';
import {directSonnetCatalogFixture} from './r12-direct-sonnet-catalog-fixture.mjs';
import {landingFixture} from './etsy-insights-landing-fixture.mjs';
const require=createRequire(import.meta.url),React=require('react'),jsx=require('react/jsx-runtime'),{renderToStaticMarkup}=require('react-dom/server');
const core=name=>require(resolve(process.env.R12_ENROLLMENT_CORE_DIR??'.core-tests',name+'.js'));
const quote=core('products/discovery-r12-adaptive-quote'),reviewerQuote=core('products/discovery-r12-public-reviewer-quote');
const handoff=core('accounts/etsy-steel-handoff-rpc'),verification=core('accounts/etsy-steel-verification-runtime');
const {SteelBrowserAdapter}=core('browser/providers/steel');
export {ENROLLMENT_ROOT,ownerRenderedForm};
export async function currentOwnerJourneyDatabase(){
 const db=await steelConfigDatabase();
 try{
  await db.exec(readFileSync('supabase/migrations/'+READBACK_MIGRATION,'utf8'));
  // The existing deployment root is independently present before any target.
  await db.query("insert into private.r05_server_keys(key_hash,expires_at) values($1,clock_timestamp()+interval '1 day')",[createHash('sha256').update(ENROLLMENT_ROOT).digest('hex')]);
  return db;
 }catch(error){await db.close();throw error;}
}
export async function currentOwnerJourneyAuthority(db){
 return enrollmentOriginFixture(db,{onReady:async a=>{
  const configuration=inertSteelConfiguration(a.project);
  const externalEvidence=inertEnrollmentExternalEvidence();
  const target=readbackTarget({businessId:a.f.businessId,ownerId:a.f.ownerId,providerProjectId:a.project},{configuration:configuration.configuration,configurationHash:configuration.configurationHash,deploymentEvidenceHash:externalEvidence.release.deploymentReceiptHash,routeReviewHash:a.routeHash,tariffEvidenceHash:a.registry.browserRoute.content.priceEvidenceHash});
  await publishReadback(db,target);
  assert.equal((await one(db,'select count(*)::int n from private.r12_direct_browser_routes where route_hash=$1',[a.routeHash])).n,0);
  assert.equal((await one(db,'select count(*)::int n from private.r12_owner_bootstrap_grants where id=$1',[a.grantId])).n,0);
  return{...a,target,configuration,externalEvidence,operatorPublications:[]};
 }});
}
/** This trusted fixture operator has no owner RPC/HTTP route. It must use the
 * exact proof already persisted by the ordinary owner metadata action. */
export async function publishCurrentOwnerReviewedAuthority(db,a){
 assert.equal(a.operatorPublications.length,0,'One explicit operator publication step');
 const saved=await one(db,'select status,proof,proof_hash from private.r12_steel_readback_results where target_hash=$1',[a.target.targetHash]);
 assert.equal(saved?.status,'verified');const hash=core('products/discovery-v2-hash').discoveryV2Hash;
 assert.equal(saved.proof_hash,hash(saved.proof));
 assert.equal(saved.proof.configurationHash,a.target.configurationHash);
 assert.equal(saved.proof.returnedProjectId,a.project);
 a.registry.browserRoute.credential_binding_hash=saved.proof.credentialBindingHash;
 const externalEvidence=structuredClone(a.externalEvidence);externalEvidence.provider.projectReadbackHash=saved.proof_hash;
 const f=a.f,built=await buildDirectEnrollmentReviewPackage(db,{businessId:f.businessId,goalId:f.goalId,rootId:f.rootId,ownerId:f.ownerId,originProfileId:f.profileId,grantId:a.grantId,profileId:a.profileId,serverKeyHash:a.serverKeyHash,grantReview:a.grantReview,registry:a.registry,reviewedAt:new Date().toISOString(),validFrom:a.validFrom,expiresAt:a.expiresAt,externalEvidence});
 const published=(await one(db,'select private.r12_direct_publish_enrollment_review($1,$2) x',[built.package,built.reviewEvidence])).x;
 const body={version:'r12.steel-config-attestation.1',routeHash:a.routeHash,providerProjectId:a.project,providerAccountHash:a.registry.browserRoute.provider_account_hash,tariffHash:a.registry.browserRoute.tariff_hash,credentialBindingHash:saved.proof.credentialBindingHash,configuration:a.target.configuration,configurationHash:saved.proof.configurationHash,deploymentEvidenceHash:a.target.deploymentEvidenceHash,dashboardTariffEvidenceHash:a.target.tariffEvidenceHash,independentReadback:saved.proof,validFrom:new Date().toISOString(),validUntil:a.expiresAt};
 const attestation={...body,attestationHash:hash(body)};
 await one(db,'select private.r12_steel_publish_config_attestation($1) x',[attestation]);
 assert.equal((await one(db,'select count(*)::int n from private.r12_owner_bootstrap_grants where id=$1',[a.grantId])).n,0,'Publication cannot seed the new grant');
 assert.deepEqual((await one(db,'select content from private.r12_steel_config_attestations where attestation_hash=$1',[attestation.attestationHash])).content.independentReadback,saved.proof);
 Object.assign(a,{built,published,attestation,readbackProofHash:saved.proof_hash});
 a.operatorPublications.push({targetHash:a.target.targetHash,proofHash:saved.proof_hash,reviewedPackageHash:published.reviewedPackageHash,attestationHash:attestation.attestationHash});
 return a.operatorPublications[0];
}
export function currentOwnerJourneyEnvironment(){
 const values={VERCEL_ENV:INERT_STEEL_DEPLOYMENT.environment,VERCEL_DEPLOYMENT_ID:INERT_STEEL_DEPLOYMENT.deploymentId,VERCEL_GIT_COMMIT_SHA:INERT_STEEL_DEPLOYMENT.releaseCommitSha,R05_ADMISSION_SERVER_KEY:ENROLLMENT_ROOT,ACCOUNTS_VAULT_KEY:'a'.repeat(64),STEEL_API_KEY:INERT_STEEL_CONFIG.apiKey,STEEL_API_BASE_URL:INERT_STEEL_CONFIG.baseUrl,STEEL_REGION:''};
 const previous=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));Object.assign(process.env,values);
 return()=>{for(const[k,v]of Object.entries(previous))if(v===undefined)delete process.env[k];else process.env[k]=v;};
}
export function currentOwnerJourneyComposition(db,a){
 const metadataGets=[],rpcCalls=[],errors=[],cleanup=[],providerCalls=[],browsers=[],workflowStarts=[],resumes=[],sourceHashes={},boundarySubstitutions=[];
 const preparation={...core('products/discovery-r12-public-preparation'),validatePublicResearchOwnerTestReceipt(...args){try{return core('products/discovery-r12-public-preparation').validatePublicResearchOwnerTestReceipt(...args);}catch(error){errors.push({name:'receipt_validation',message:error.stack,pinsBytes:Buffer.byteLength(JSON.stringify(args[0]?.preview?.researchPins??null))});throw error;}}};
 const profileId=randomUUID(),sessions=new Map(),transports=[];let activeUser=a.f.ownerId,tail=Promise.resolve();
 const serial=work=>{const next=tail.then(work,work);tail=next.catch(()=>{});return next;};
 const allowed=new Set(['r12_owner_steel_config_readback','r12_steel_config_readback_server','r12_steel_create_config_admit','r12_owner_direct_enrollment_read','r12_owner_direct_enrollment_server','r12_owner_direct_read','r12_owner_direct_server','r12_etsy_steel_owner','r12_owner_etsy_steel_verification_read','r12_owner_etsy_steel_renderer_review','r12_etsy_steel_server','r12_etsy_steel_verification_server','r12_direct_browser_ledger','r12_direct_setup_quote_revalidate','r12_direct_owner_renderer_qualification','r12_direct_controller_server']);
 function client(role){return{rpc:async(name,args)=>serial(async()=>{
  assert.ok(allowed.has(name));const owner=activeUser;rpcCalls.push({role,name,operation:args.p_operation,owner});
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[role==='authenticated'?owner:'']);await db.exec('set role '+role);
  try{
   if(name==='r12_owner_etsy_steel_renderer_review'&&faults.rendererReadUnavailable)throw Error('Inert renderer review read unavailable');
   const names=Object.keys(args);assert.ok(names.every(x=>/^p_[a-z_]+$/.test(x)));
   const data=(await one(db,`select public.${name}(${names.map((x,i)=>x+' => $'+(i+1)).join(',')}) result`,Object.values(args))).result;
   if(args.p_operation==='transport')transports.push(args.p_payload.request);
   return{data,error:null};
  }catch(error){errors.push({role,name,operation:args.p_operation,message:error.message});return{data:null,error};}
  finally{await db.exec('reset role');}
 }),auth:{getClaims:async()=>({data:{claims:{sub:activeUser}},error:null})},from(table){assert.equal(table,'businesses');const filters={};const chain={select(){return chain;},eq(k,v){filters[k]=v;return chain;},async maybeSingle(){return serial(async()=>({data:await one(db,'select id,name,created_at,updated_at from public.businesses where id=$1 and owner_user_id=$2',[filters.id,filters.owner_user_id])??null,error:null}));}};return chain;}};}
 const authenticated=client('authenticated'),runtime=client('anon');
 const context=()=>({userId:activeUser,supabase:authenticated,businesses:activeUser===a.f.ownerId?[{id:a.f.businessId,name:'Inert owner Business'}]:[]});
 const config=INERT_STEEL_CONFIG;
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
 function browser(){let f;const options={shop:'SyntheticShop',beforeNavigate:url=>f.request(url)};f=landingFixture(options,true);const go=f.page.goto;f.page.goto=async(...args)=>{await go(...args);return{status:()=>200};};browsers.push(f);return f;}
 const shared={'server-only':{},'node:crypto':require('node:crypto'),'../core/request-deadline':core('core/request-deadline'),'../lib/supabase/runtime':{createRuntimeClient:()=>runtime},'../lib/core-ui/owner-business':loadActualOwnerModule('src/lib/core-ui/owner-business.ts',{}),'../products/discovery-r12-public-preparation':core('products/discovery-r12-public-preparation'),'../products/discovery-r12-public-server-key':core('products/discovery-r12-public-server-key'),'../products/discovery-v2-hash':core('products/discovery-v2-hash')};
 const load=(file,deps)=>{const result=loadActualOwnerModule(file,{...shared,...deps});sourceHashes[file]=result.sourceHash;return result;};
 const owner=load('src/accounts/etsy-steel-handoff-owner-server.ts',{'./etsy-steel-handoff-contracts':core('accounts/etsy-steel-handoff-contracts'),'./etsy-steel-handoff-owner':load('src/accounts/etsy-steel-handoff-owner.ts',{'./etsy-steel-handoff-contracts':core('accounts/etsy-steel-handoff-contracts')})});
 const account=load('src/accounts/etsy-steel-handoff-server.ts',{
  get '../browser/etsy-steel-create-binding'(){const actual=core('browser/etsy-steel-create-binding');return{...actual,getSteelCreateDeployment:()=>actual.getSteelCreateDeployment()};},
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
  './discovery-r12-public-reviewer-quote':{...reviewerQuote,fetchDirectSonnetInferenceQuote:input=>reviewerQuote.fetchDirectSonnetInferenceQuote({...input,fetch:async(address,init)=>{assert.equal(init.method,'GET');const f=Object.values(directSonnetCatalogFixture(Date.now())).find(x=>x.url===String(address));assert.ok(f);return Response.json(f.payload);}})},
  './discovery-r12-adaptive-quote':{...quote,fetchAdaptiveResearchQuote:input=>quote.fetchAdaptiveResearchQuote({...input,fetch:async(address,init)=>{assert.equal(init.method,'GET');const f=Object.values(r12CatalogFixture()).find(x=>x.url===String(address));assert.ok(f);return Response.json(f.payload);}})},
 });
 class Redirect extends Error{constructor(url){super('Inert Next redirect');this.url=url;}}
 const ui={'@/lib/core-ui/data':{requireOwnerUiContext:async()=>context()},'next/navigation':{redirect:url=>{throw new Redirect(url);},notFound:()=>{throw Error('not_found');}},'next/cache':{revalidatePath:()=>{}}};
 const currentSource=readbackSource();
 const readbackLeaf=currentSource.load('src/browser/etsy-steel-config-readback.ts');
 const readback=load('src/accounts/etsy-steel-readback-owner-server.ts',{
  './etsy-steel-readback-contracts':currentSource.load('src/accounts/etsy-steel-readback-contracts.ts'),
  '../browser/providers/steel':currentSource.load('src/browser/providers/steel.ts'),
  '../browser/etsy-steel-create-binding':currentSource.load('src/browser/etsy-steel-create-binding.ts'),
  '../browser/etsy-steel-config-readback':{...readbackLeaf,qualifySteelExistingSessionReadback:(expected,options)=>readbackLeaf.qualifySteelExistingSessionReadback(expected,{...options,fetcher:async(url,init)=>{
   assert.equal(url,'https://api.steel.dev/v1/sessions/'+a.target.knownSessionId);assert.equal(init.method,'GET');assert.equal(init.headers['steel-api-key'],INERT_STEEL_CONFIG.apiKey);assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');
   const claim=await one(db,'select id from private.r12_steel_readback_claims where target_hash=$1',[a.target.targetHash]);assert.ok(claim,'Real21400 claim must precede metadata IO');
   metadataGets.push({method:init.method,path:new URL(url).pathname});
   return Response.json({id:a.target.knownSessionId,projectId:a.project,status:'released',createdAt:a.target.expectedCreatedAt,debugUrl:'https://private.invalid/never-projected',cookies:[{value:'PRIVATE_METADATA_SENTINEL'}]});
  }})},
 });
 const productActions=load('src/app/dashboard/products/etsy-research/actions.ts',{...ui,'@/products/discovery-r12-public-owner-server':product,'@/products/discovery-r12-direct-enrollment-server':enrollment,'@/accounts/etsy-steel-readback-owner-server':readback,'@/products/discovery-r12-public-contracts':core('products/discovery-r12-public-contracts')});
 const accountActions=load('src/app/dashboard/accounts/etsy-research/actions.ts',{...ui,'@/accounts/etsy-steel-handoff-owner-server':owner,'@/accounts/etsy-steel-handoff-server':account});
 // The current journey renders only genuine saved controller state.
 const pageProduct=product;
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
 return{a,metadataGets,readback,boundarySubstitutions,owner,account,product,enrollment,context,runtime,handle,sourceHashes,rpcCalls,errors,providerCalls,browsers,workflowStarts,resumes,hooks,faults,profileId,sessions,setUser:id=>{activeUser=id;},async invoke(group,name,args){const target={product,account,owner,enrollment,readback}[group];assert.ok(target&&typeof target[name]==='function'&&name!=='sourceHash');try{return await target[name](context(),...args);}finally{await Promise.all(cleanup.splice(0));}},get:async path=>handle(new Request('http://inert.local'+path)),async post(action,data){return handle(new Request('http://inert.local/__inert_owner_action/'+action,{method:'POST',body:new URLSearchParams(data)}));}};
}

/** Inert hosting delivers the one owner-started workflow's exact saved input.
 * The current driver chooses and runs all four actual phases. No state, result,
 * model receipt, source receipt, configuration permit or grant is fabricated. */
export async function executeCurrentOwnerCycle(db,j,envelopeId){
 assert.equal(j.workflowStarts.length,1);assert.equal(j.cycleRuntime,undefined);
 const a=j.a,catalog=await j.product.readDirectResearchCatalog(j.context(),a.f.businessId,a.f.goalId,envelopeId);
 const receipt=catalog.current,prepared=catalog.research,p=prepared.preview,started=j.workflowStarts[0];
 assert.equal(prepared.confirmed,true);assert.equal(receipt.preview.grantId,a.grantId);
 const {deriveDirectServerKey}=core('products/discovery-r12-public-server-key');
 const key=purpose=>deriveDirectServerKey(a.bootstrapKey,{businessId:a.f.businessId,goalId:a.f.goalId,testEnvelopeId:receipt.testEnvelopeId,envelopeHash:receipt.testEnvelopeHash,routeHash:a.routeHash,purpose});
 const keys=Object.fromEntries(['controller','admission','source','evidence'].map(purpose=>[purpose,key(purpose)]));
 const rpc=async(operation,payload={},purpose=operation==='dispatch'?'admission':operation.startsWith('source_')?'source':'controller')=>{
  const result=await j.runtime.rpc('r12_direct_controller_server',{p_business_id:a.f.businessId,p_scope_id:prepared.scopeId,p_operation:operation,p_payload:payload,p_server_key:keys[purpose]});if(result.error)throw result.error;return result.data;
 };
 const f={authority:{f:{...a.f,grantId:a.grantId},prepared:receipt,routeHash:a.routeHash},approved:{profileId:j.profileId,keys},prepared,policy:p.policy,profile:p.profile,quote:p.quote,initial:p.scope.initialCommand,keys,rpc};
 const runtime=steelConfigResearchRuntimeComposition(db,f,{policyVersion:p.policy.version,
  configurationAdmit:async request=>{const r=await j.runtime.rpc('r12_steel_create_config_admit',{p_business_id:a.f.businessId,p_request:request,p_server_key:keys.source});if(r.error)throw r.error;return r.data;},
  rpcTransport:async(name,args)=>{const r=await j.runtime.rpc(name,args);if(r.error)throw r.error;return r.data;},
 });
 j.cycleRuntime=runtime;j.sourceHashes['src/products/discovery-r12-public-runtime.ts']=runtime.sourceHash;
 assert.deepEqual(runtime.input,started.input,'Hosting must deliver only the exact owner-confirmed saved scope');
 const steps=[];
 for(const expected of ['accepted','source_recorded','accepted','accepted']){
  const result=await runtime.step(started.runId,started.input);steps.push(result);
  assert.equal(result.reason,expected,JSON.stringify({steps,sqlErrors:runtime.sqlErrors,sourceResults:runtime.sourceResults,modelResults:runtime.modelResults}));
 }
 const final=(await rpc('read')).state;
 assert.equal(final.logicalCyclesStarted,1);assert.equal(final.sourceOperationsStarted,1);assert.equal(final.modelDispatchesUsed,3);assert.equal(final.questComplete,false);
 assert.equal(final.logicalCycles[0].status,'completed');assert.ok(final.logicalCycles[0].review);assert.equal(final.logicalCycles[0].review.outcome,'NME');
 assert.deepEqual(runtime.modelPosts.map(x=>x.phase),['plan','strategy','review']);assert.equal(runtime.modelGets.length,3);
 const reviewerWire=await one(db,'select binding from private.r12_direct_phase_wires where attempt_id=$1',[runtime.modelPosts.at(-1).attemptId]);
 const reviewerRequest=JSON.parse(reviewerWire.binding.wireBody),reviewer=p.quote.inference.reviewer;
 assert.equal(reviewerRequest.model,reviewer.modelId);assert.equal(reviewer.modelId,'anthropic/claude-sonnet-4.6');assert.equal(reviewer.canonicalModelId,'anthropic/claude-4.6-sonnet-20260217');assert.equal(reviewer.providerName,'Amazon Bedrock');assert.equal(reviewer.endpoint,'amazon-bedrock/us');
 assert.deepEqual(reviewerRequest.provider.only,['amazon-bedrock/us']);assert.equal(reviewerRequest.provider.allow_fallbacks,false);assert.equal(reviewerRequest.provider.data_collection,'deny');assert.equal(reviewerRequest.provider.zdr,true);
 assert.deepEqual(reviewer.acceptedResponseModelIds,[reviewer.modelId,reviewer.canonicalModelId]);assert.equal(reviewer.sourceHashes.alias,reviewer.sourceHashes.canonical);assert.equal(reviewer.sourceHashes.alias,reviewer.sourceHashes.zdr);
 const permits=(await db.query('select p.permit,p.attestation_hash,u.operation_id from private.r12_steel_create_config_permits p join private.r12_steel_create_config_uses u using(admission_hash) order by u.operation_id')).rows;
 assert.equal(permits.length,3);assert.equal(new Set(permits.map(p=>p.operation_id)).size,3);
 for(const permit of permits){assert.equal(permit.attestation_hash,a.attestation.attestationHash);assert.equal(permit.permit.configurationHash,a.target.configurationHash);assert.equal(permit.permit.credentialBindingHash,a.attestation.credentialBindingHash);}
 assert.equal(runtime.browserPosts.length,1);assert.equal(runtime.browsers[0].events.filter(x=>x==='submit').length,1);assert.equal(runtime.browsers[0].browser.isConnected(),false);
 assert.equal(runtime.sourceResults[0].run.receipt.status,'completed');assert.equal(runtime.sourceResults[0].accounting,'qualified_bounded_pending');
 const browserExposure=await one(db,'select sum(held)::text held,sum(pending_maximum)::text pending,sum(known_actual)::text actual,bool_or(unknown) unknown from private.r12_direct_browser_exposure($1)',[a.f.businessId]);
 assert.deepEqual(browserExposure,{held:'3000',pending:'3000',actual:'0',unknown:false});
 const report=await currentOwnerJourneyDiagnostics(db,j,envelopeId);
 assert.equal(report.configurationPermits,3);assert.equal(report.configurationUses,3);assert.equal(report.providerCreates,3);assert.equal(report.metadataGets,1);
 assert.equal(report.exposure.knownActualMicrounits,'3');assert.equal(report.exposure.boundedPendingMicrounits,'3000');assert.equal(report.exposure.allBillingFinal,false);
 assert.equal(report.savedProofReused,true);assert.equal(report.ownerHasPublisherPrivilege,false);
 j.cycleReport={...report,steps:steps.map(x=>x.reason),reviewerModel:p.quote.inference.reviewer.modelId,reviewerEndpoint:p.quote.inference.reviewer.endpoint,logicalCycles:final.logicalCyclesStarted,questComplete:final.questComplete};
 return j.cycleReport;
}
export async function currentOwnerJourneyDiagnostics(db,j,envelopeId){
 const a=j.a,setup=await one(db,'select operation_id from private.r12_etsy_steel_setups where business_id=$1 order by sequence desc limit 1',[a.f.businessId]);
 const catalog=await j.product.readDirectResearchCatalog(j.context(),a.f.businessId,a.f.goalId,envelopeId);
 const view=setup?await j.owner.readEtsySteelOwnerSetup(j.context(),a.f.businessId,setup.operation_id):null,verified=setup?await j.owner.readEtsySteelOwnerVerification(j.context(),a.f.businessId,setup.operation_id):null;
 const readback=await j.readback.readSteelConfigReadback(j.context(),a.f.businessId);
 const counts=await one(db,`select
 (select count(*)::int from private.r12_owner_bootstrap_grants where id=$1) new_grants,
 (select count(*)::int from private.r12_steel_create_config_permits) permits,
 (select count(*)::int from private.r12_steel_create_config_uses) uses,
 (select count(*)::int from private.r12_steel_readback_claims where target_hash=$2) claims,
 exists(select 1 from private.r12_steel_config_attestations a join private.r12_steel_readback_results r on r.target_hash=$2 where a.route_hash=$3 and a.content->'independentReadback'=r.proof) proof_reused,
 has_function_privilege('authenticated','private.r12_direct_publish_enrollment_review(jsonb,jsonb)','execute') or has_function_privilege('authenticated','private.r12_steel_publish_config_attestation(jsonb)','execute') or has_function_privilege('authenticated','private.r12_steel_publish_readback_target(jsonb)','execute') publisher`,[a.grantId,a.target.targetHash,a.routeHash]);
 return{newGrants:counts.new_grants,readbackStatus:readback.status,metadataGets:j.metadataGets.length,metadataClaims:counts.claims,configurationPermits:counts.permits,configurationUses:counts.uses,providerCreates:j.providerCalls.filter(x=>x.path==='/v1/sessions').length+(j.cycleRuntime?.browserPosts.length??0),modelRequests:j.cycleRuntime?.modelPosts.length??0,querySubmits:j.browsers.filter(x=>x.events.includes('submit')).length+(j.cycleRuntime?.browsers.filter(x=>x.events.includes('submit')).length??0),accountVerified:verified?.status==='verified',cleanupPending:view?.cleanupPending??false,stopped:catalog.current?.stopped===true,exposure:catalog.testExposure??null,savedProofReused:counts.proof_reused,ownerHasPublisherPrivilege:counts.publisher,boundarySubstitutions:j.boundarySubstitutions};
}
