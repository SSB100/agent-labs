/** CI-only focused Next/browser host. Do not run where listening sockets or
 * Chromium launch are denied. The default command requires a real browser;
 * --compile-only builds the isolated three-page fixture without launching one. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {cp,mkdir,mkdtemp,writeFile,symlink,rm} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import '../tests/next-fixture/block-network.mjs';
import {spawn} from 'node:child_process';
import {ownerBoundaryArguments} from '../tests/next-fixture/owner-boundary-arguments.mjs';
import {currentOwnerJourneyDatabase,currentOwnerJourneyAuthority,currentOwnerJourneyComposition,currentOwnerJourneyEnvironment,publishCurrentOwnerReviewedAuthority,executeCurrentOwnerCycle,currentOwnerJourneyDiagnostics} from '../tests/helpers/r12-steel-current-owner-journey-fixture.mjs';
import {runCurrentSteelOwnerBrowserJourney} from '../tests/next-fixture/r12-steel-current-owner-journey.mjs';
const root=process.cwd(),out=path.join(root,'test-results/r12-steel-current-owner-next'),fixture=await mkdtemp(path.join(tmpdir(),'agent-labs-current-owner-next-'));
const compileOnly=process.argv.includes('--compile-only');assert.ok(process.env.R12_SQL_TEST_HOST||compileOnly,'Isolated SQL tooling required');
await mkdir(out,{recursive:true});const children=[];let db,boundary,browser,page,report,diagnostics,composition;const boundaryFailures=[];
let restoreEnvironment;
const write=async(name,value)=>{const p=path.join(fixture,name);await mkdir(path.dirname(p),{recursive:true});await writeFile(p,value);};
const listen=server=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve(server.address().port));});
const finish=child=>new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('Next fixture failed; inspect '+out)));});
try{
 // Only the focused production pages/actions are routed. The rest of src is
 // copied so their unchanged pure contracts compile with their original imports.
 await cp(path.join(root,'src'),path.join(fixture,'src'),{recursive:true});await rm(path.join(fixture,'src/app'),{recursive:true});
 for(const rel of ['app/dashboard/products/etsy-research/page.tsx','app/dashboard/products/etsy-research/actions.ts','app/dashboard/accounts/etsy-research/page.tsx','app/dashboard/accounts/etsy-research/actions.ts','app/dashboard/accounts/etsy-research/sign-in/page.tsx','app/dashboard/accounts/accounts.css']){await mkdir(path.dirname(path.join(fixture,'src',rel)),{recursive:true});await cp(path.join(root,'src',rel),path.join(fixture,'src',rel));}
 await symlink(path.join(root,'node_modules'),path.join(fixture,'node_modules'));
 await cp(path.join(root,'package.json'),path.join(fixture,'package.json'));
 await write('tsconfig.json',JSON.stringify({compilerOptions:{target:'ES2022',lib:['dom','dom.iterable','esnext'],strict:true,noImplicitAny:false,noEmit:true,skipLibCheck:true,esModuleInterop:true,module:'esnext',moduleResolution:'bundler',jsx:'react-jsx',allowJs:true,resolveJsonModule:true,paths:{'@/*':['./src/*']}},include:['next-env.d.ts','src/app/**/*.tsx','src/app/**/*.ts','.next/types/**/*.ts'],exclude:['node_modules']},null,2));
 await write('next.config.mjs',`export default {poweredByHeader:false,experimental:{cpus:2},serverExternalPackages:['playwright-core']};\n`);
 await write('src/app/layout.tsx',`import type {ReactNode} from 'react';export default function Layout({children}:{children:ReactNode}){return <html><body>{children}</body></html>};`);
 await write('src/app/page.tsx',`export default function Page(){return <p>Inert focused owner fixture.</p>}`);
 await write('src/components/stage7/app-shell.tsx',`export function AppShell(p:any){return <main>{p.children}</main>}export function PageHeader(p:any){return <header><h1>{p.title}</h1><p>{p.description}</p>{p.actions}</header>}`);
 await write('src/components/console/console-retained-workspace.tsx',`export function ConsoleRetainedWorkspace(p:any){return <>{p.header}{p.panels.map((x:any)=><section key={x.id}>{x.content}</section>)}</>}`);
 await write('src/lib/core-ui/data.ts',`import {cookies} from 'next/headers';export type OwnerUiContext=any;export async function requireOwnerUiContext(){const c=await cookies();if(c.get('r12-session')?.value==='off')throw Error('Owner session required');return {userId:process.env.R12_INERT_OWNER,businesses:[],supabase:{}}}`);
 const groups={readback:['readSteelConfigReadback','runSteelConfigReadback','cancelSteelConfigReadback'],enrollment:['readDirectEnrollmentCatalog','prepareDirectEnrollment','confirmDirectEnrollment'],product:['readDirectResearchCatalog','prepareDirectResearchTest','confirmDirectResearchTest','stopDirectResearchTest','prepareDirectEtsyAccess','prepareDirectResearchCycle','confirmAndStartDirectResearch','resumeDirectResearch'],owner:['readEtsySteelOwnerSetup','approveEtsySteelOwnerSetup','stopEtsySteelOwnerSetup','readEtsySteelOwnerVerification','readEtsySteelOwnerRendererReview'],account:['startApprovedEtsySteelSetup','readPrivateEtsySteelOwnerHandoff','finishApprovedEtsySteelSetup','verifyApprovedEtsySteelSetup']};
 for(const [group,file] of [['readback','src/accounts/etsy-steel-readback-owner-server.ts'],['enrollment','src/products/discovery-r12-direct-enrollment-server.ts'],['product','src/products/discovery-r12-public-owner-server.ts'],['owner','src/accounts/etsy-steel-handoff-owner-server.ts'],['account','src/accounts/etsy-steel-handoff-server.ts']]){
  await write(file,`import 'server-only';const boundaryArguments=${ownerBoundaryArguments.toString()};async function invoke(operation:string,args:any[]){const response=await fetch(process.env.R12_DIRECT_BOUNDARY!+'/invoke',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({group:${JSON.stringify(group)},operation,args:boundaryArguments(args)}),cache:'no-store'});const result=await response.json();if(!response.ok)throw Error('Inert owner boundary unavailable');return result.data;}\n`+groups[group].map(n=>`export async function ${n}(...args:any[]){return invoke('${n}',args)}`).join('\n'));
 }
 const env=Object.fromEntries(['PATH','HOME','TMPDIR','SystemRoot'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));Object.assign(env,{NODE_ENV:'production',CI:'true',NEXT_TELEMETRY_DISABLED:'1',R12_DIRECT_BOUNDARY:'http://127.0.0.1:1',R12_INERT_OWNER:'00000000-0000-4000-8000-000000000001',R03_NETWORK_LOG:path.join(out,'blocked-network.jsonl'),NODE_OPTIONS:'--import='+pathToFileURL(path.join(root,'tests/next-fixture/block-network.mjs')).href});
 const start=(args,name)=>{const child=spawn(process.execPath,[path.join(root,'node_modules/next/dist/bin/next'),...args],{cwd:fixture,env,stdio:['ignore','pipe','pipe']});const log=createWriteStream(path.join(out,name));child.stdout.pipe(log);child.stderr.pipe(log);children.push(child);return child;};
 await finish(start(['build','--webpack'],'build.log'));
 report={version:'r12.steel-current-owner-next-qualification.1',compiled:true,realBrowser:false,actualNextActions:false,liveAccess:false,substitutions:['Minimal shell and inert authenticated UI context','Owner server function facade to actual source functions in isolated SQL host','Workflow hosting and provider/browser leaves inert'],sourceHashes:{}};
 if(!compileOnly){
  restoreEnvironment=currentOwnerJourneyEnvironment();db=await currentOwnerJourneyDatabase();
  const a=await currentOwnerJourneyAuthority(db);currentOwnerJourneyEnvironment();const j=currentOwnerJourneyComposition(db,a);composition=j;let queue=Promise.resolve();
  boundary=createServer((req,res)=>{queue=queue.then(async()=>{try{assert.equal(req.method,'POST');assert.equal(req.url,'/invoke');let body='';for await(const chunk of req){body+=chunk;assert.ok(body.length<=1048576);}const {group,operation,args}=JSON.parse(body);assert.ok(groups[group]?.includes(operation));assert.ok(Array.isArray(args));const data=await j.invoke(group,operation,args);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({data}));}catch(error){boundaryFailures.push({name:error?.name??'Error',message:String(error?.message??error).slice(0,300)});res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'inert_boundary_rejected'}));}},()=>{});});
  env.R12_DIRECT_BOUNDARY='http://127.0.0.1:'+await listen(boundary);env.R12_INERT_OWNER=a.f.ownerId;
  const probe=createServer();const port=await listen(probe);await new Promise(resolve=>probe.close(resolve));start(['start','-H','127.0.0.1','-p',String(port)],'server.log');const origin='http://127.0.0.1:'+port;
  for(let ready=false,n=0;!ready;n++){assert.ok(n<120,'Next fixture startup timeout');try{ready=(await fetch(origin)).ok;}catch{}if(!ready)await new Promise(r=>setTimeout(r,250));}
  const {chromium}=await import('playwright-core');browser=await chromium.launch({headless:true,...(process.env.GUIDED_UI_CHROMIUM_PATH?{executablePath:process.env.GUIDED_UI_CHROMIUM_PATH}:{})});page=await browser.newPage({viewport:{width:1280,height:900}});
  diagnostics=()=>currentOwnerJourneyDiagnostics(db,j);
  report={...report,...await runCurrentSteelOwnerBrowserJourney({page,origin,businessId:a.f.businessId,goalId:a.f.goalId,grantId:a.grantId,diagnostics,
   publishReviewedAuthority:()=>publishCurrentOwnerReviewedAuthority(db,a),
   executeCycle:envelopeId=>executeCurrentOwnerCycle(db,j,envelopeId),
   capture:async label=>{await page.screenshot({path:path.join(out,label+'.png'),fullPage:true});await writeFile(path.join(out,label+'.html'),await page.content());},
  }),sourceHashes:j.sourceHashes,operatorPublications:a.operatorPublications};
 }
 await writeFile(path.join(out,'qualification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){
 // Inert fixture artifacts only. Capture before teardown; never let evidence
 // collection replace the original failing assertion.
 const record={version:'r12.steel-current-owner-next-failure.1',name:error?.name??'Error',message:String(error?.message??error).slice(0,1000),url:page?.url()??null,boundaryFailures,rpcErrors:composition?.errors??[],sourceHashes:composition?.sourceHashes??{}};
 if(diagnostics)try{record.diagnostics=await diagnostics();}catch(e){record.diagnosticsError=String(e?.message??e).slice(0,300);}
 if(page){try{await writeFile(path.join(out,'failure.html'),await page.content());}catch{}try{await page.screenshot({path:path.join(out,'failure.png'),fullPage:true,timeout:5000});}catch{}}
 await writeFile(path.join(out,'failure.json'),JSON.stringify(record,null,2));throw error;
}finally{
 await browser?.close();await Promise.all(children.filter(x=>x.exitCode===null&&x.signalCode===null).map(child=>new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');setTimeout(()=>child.kill('SIGKILL'),10000).unref();})));
 if(boundary)await new Promise(resolve=>boundary.close(resolve));await db?.close();restoreEnvironment?.();await rm(fixture,{recursive:true,force:true});
}
