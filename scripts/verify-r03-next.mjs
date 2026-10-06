import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { startFixtureBoundary } from '../tests/next-fixture/server.mjs';
import { runNextJourneys } from '../tests/next-fixture/journeys.mjs';
import { runResearchQualificationJourneys } from '../tests/next-fixture/r11-runner.mjs';
import {runR12Journeys} from '../tests/next-fixture/r12-journeys.mjs';
import {runR12BootstrapJourney} from '../tests/next-fixture/r12-bootstrap-journey.mjs';
import {R12_INERT_ROOT} from '../tests/next-fixture/r12-sql.mjs';
import { R11_INERT_SERVER_KEY } from '../tests/next-fixture/r11-research.mjs';

const root = process.cwd(), output = path.join(root, 'test-results/r03-next');
await mkdir(output, { recursive: true });
// Windows sandbox tools cannot traverse arbitrary ancestors of the OS temp tree.
// Keep the disposable copy under this workspace there; CI retains its isolated OS temp root.
const temporaryRoot = process.platform==='win32'?path.resolve(root,'work/next-fixtures'):path.resolve(tmpdir());
await mkdir(temporaryRoot,{recursive:true});
const fixture = await mkdtemp(path.join(temporaryRoot, 'agent-labs-r03-'));
const fixtureRelative = path.relative(temporaryRoot, path.resolve(fixture));
assert.ok(fixtureRelative && !fixtureRelative.startsWith('..') && !path.isAbsolute(fixtureRelative) && path.basename(fixture).startsWith('agent-labs-r03-'), 'Disposable fixture must remain inside its designated temporary directory');
const boundary = await startFixtureBoundary();
const log = name => createWriteStream(path.join(output, name));
const env = Object.fromEntries(['PATH','HOME','TMPDIR','SystemRoot'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
Object.assign(env, { NODE_ENV: 'production', CI: 'true', NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_SUPABASE_URL: boundary.origin,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'inert-fixture-only', R03_BOUNDARY: boundary.origin,
  R03_NETWORK_LOG: path.join(output, 'blocked-network.jsonl'), NODE_OPTIONS: `--import=${pathToFileURL(path.join(root, 'tests/next-fixture/block-network.mjs')).href}` });
const processes = [];
function start(args, name, overrides = {}) {
  const child = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), ...args], { cwd: fixture, env: {...env,...overrides}, stdio: ['ignore','pipe','pipe'] });
  const stream = log(name); child.stdout.pipe(stream); child.stderr.pipe(stream); processes.push(child);
  return child;
}
const completion = child => new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => code === 0 ? resolve() : reject(Error(`Next command failed (${code ?? signal ?? 'unknown'}); see preserved logs`))); });
try {
  for (const name of ['src','public','next.config.ts','tsconfig.json','package.json','package-lock.json','next-env.d.ts']) {
    try { await cp(path.join(root,name),path.join(fixture,name),{recursive:true}); } catch (error) { if(error.code !== 'ENOENT') throw error; }
  }
  await symlink(path.join(root,'node_modules'),path.join(fixture,'node_modules'),process.platform==='win32'?'junction':'dir');
  // Four reviewed transport substitutions. Actual pages, readers, ownership guards,
  // actions, redirects, Link/router, RSC, Suspense and revalidation remain unchanged.
  await cp(path.join(root,'tests/next-fixture/transport.mjs'),path.join(fixture,'src/lib/supabase/inert-transport.mjs'));
  await writeFile(path.join(fixture,'src/lib/supabase/inert-transport.d.mts'), 'export function makeClient(origin:string,session?:string,mode?:string): unknown;\n');
  const serverType = (await readFile(path.join(root,'src/lib/supabase/server.ts'),'utf8')).replace('export async function createClient()', 'async function productionClientType()');
  await writeFile(path.join(fixture,'src/lib/supabase/server.ts'), serverType + `\nimport { makeClient } from './inert-transport.mjs';\nexport async function createClient() { const c=await cookies(); return makeClient(process.env.R03_BOUNDARY!,c.get('r03-session')?.value??'on',c.get('r03-mode')?.value??'normal') as Awaited<ReturnType<typeof productionClientType>>; }\n`);
  const clientType = (await readFile(path.join(root,'src/lib/supabase/client.ts'),'utf8')).replace('export function createClient()', 'function productionClientType()');
  await writeFile(path.join(fixture,'src/lib/supabase/client.ts'), clientType + `\nexport function createClient() { const channel = { on(){return channel}, subscribe(){return channel} }; return { channel(){return channel}, removeChannel(){return Promise.resolve('ok')} } as unknown as ReturnType<typeof productionClientType>; }\n`);
  await writeFile(path.join(fixture,'src/lib/supabase/proxy.ts'), `import { NextResponse, type NextRequest } from 'next/server';\nexport function updateSupabaseSession(_request:NextRequest, requestHeaders:Headers) { return NextResponse.next({request:{headers:requestHeaders}}); }\n`);
  await cp(path.join(root,'tests/next-fixture/r10-dependencies.ts'),path.join(fixture,'src/browser/watch-dependencies.ts'));
  await cp(path.join(root,'tests/next-fixture/r11-dependencies.ts'),path.join(fixture,'src/research/qualification-server-dependencies.ts'));
  await cp(path.join(root,'tests/next-fixture/r12-dependencies.ts'),path.join(fixture,'src/products/discovery-r12-server-dependencies.ts'));
  await writeFile(path.join(output,'isolation.json'),JSON.stringify({copiedSource:true,substitutions:['supabase/server.ts','supabase/client.ts','supabase/proxy.ts','inert-transport.mjs','browser/watch-dependencies.ts (inert R10 authority/capture only)','research/qualification-server-dependencies.ts (inert R11 public catalogs/provider only)','products/discovery-r12-server-dependencies.ts (inert R12 public quotes/provider only; actual isolated SQL)'],credentials:'none; inert loopback identifiers plus explicit test-only R11 authority/provider placeholders; no inherited secrets',network:'loopback only; denied effects logged',fixture:'two owned Businesses; realistic saved failures and costs'},null,2));
  console.log('Building disposable production Next application with blocked external effects.');
  await completion(start(['build','--webpack'],'build.log'));
  const probe = createServer(); await new Promise(resolve => probe.listen(0,'127.0.0.1',resolve)); const port=probe.address().port; await new Promise(resolve=>probe.close(resolve));
  start(['start','-p',String(port),'-H','127.0.0.1'],'server.log');
  // Next normalizes loopback NextRequest URLs to localhost; use the same origin
  // for the inert browser so production exact-Origin protections are unchanged.
  const origin=`http://localhost:${port}`;
  let ready=false;
  for(let attempt=0;attempt<120;attempt++){try{const response=await fetch(origin+'/login',{redirect:'manual'});if(response.status<500){ready=true;break;}}catch{} await new Promise(resolve=>setTimeout(resolve,250));}
  assert.ok(ready,'Production Next fixture did not start');
  await runNextJourneys({origin,boundary,output,httpOnly:process.argv.includes('--http-only')||process.argv.includes('--research-only')||process.argv.includes('--r12-only'),questsOnly:process.argv.includes('--quests-only'),controlsOnly:process.argv.includes('--controls-only'),historyOnly:process.argv.includes('--history-only'),workspaceOnly:process.argv.includes('--workspace-only'),knowledgeOnly:process.argv.includes('--knowledge-only'),browserWatchOnly:process.argv.includes('--browser-watch-only')});
  if(!process.argv.includes('--r12-only')&&(process.argv.includes('--research-only')||!process.argv.some(flag=>['--quests-only','--controls-only','--history-only','--workspace-only','--knowledge-only','--browser-watch-only'].includes(flag)))){
    const researchProbe=createServer();await new Promise(resolve=>researchProbe.listen(0,'127.0.0.1',resolve));const researchPort=researchProbe.address().port;await new Promise(resolve=>researchProbe.close(resolve));
    start(['start','-p',String(researchPort),'-H','127.0.0.1'],'r11-research-server.log',{VERCEL_ENV:'production',R05_ADMISSION_SERVER_KEY:R11_INERT_SERVER_KEY,OPENROUTER_API_KEY:'inert-r11-provider-placeholder'});
    const researchOrigin=`http://localhost:${researchPort}`;let researchReady=false;
    for(let attempt=0;attempt<120;attempt++){try{const response=await fetch(researchOrigin+'/login',{redirect:'manual'});if(response.status<500){researchReady=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,250));}
    assert.ok(researchReady,'R11 isolated production Next fixture did not start');
    await runResearchQualificationJourneys({origin:researchOrigin,noKeyOrigin:origin,boundary,output,httpOnly:process.argv.includes('--http-only')});
  }
  if(process.argv.includes('--r12-only')||!process.argv.some(flag=>['--quests-only','--controls-only','--history-only','--workspace-only','--knowledge-only','--browser-watch-only','--research-only'].includes(flag))){
    if(!process.env.R12_SQL_TEST_HOST)throw Error('R12 isolated SQL fixture host is required');
    const directory=await mkdtemp(path.join(temporaryRoot,'r12-next-'));
    try{
    const capture=spawn(process.execPath,['--test','tests/r12-discovery-scope-sql.test.mjs'],{cwd:root,env:{...process.env,R12_NEXT_FIXTURE_OUTPUT:directory,R12_POSTGRES_URL:'',R12_REQUIRE_POSTGRES:'0'},stdio:['ignore','pipe','pipe']});
    processes.push(capture);
    const stream=log('r12-sql-capture.log');capture.stdout.pipe(stream);capture.stderr.pipe(stream);await completion(capture);
    const bootstrapCapture=spawn(process.execPath,['tests/helpers/r12-bootstrap-rehearsal.mjs'],{cwd:root,env:{...process.env,R12_BOOTSTRAP_NEXT_OUTPUT:directory},stdio:['ignore','pipe','pipe']});processes.push(bootstrapCapture);
    const bootstrapStream=log('r12-bootstrap-capture.log');bootstrapCapture.stdout.pipe(bootstrapStream);bootstrapCapture.stderr.pipe(bootstrapStream);await completion(bootstrapCapture);
    const r12Probe=createServer();await new Promise(resolve=>r12Probe.listen(0,'127.0.0.1',resolve));const r12Port=r12Probe.address().port;await new Promise(resolve=>r12Probe.close(resolve));
    start(['start','-p',String(r12Port),'-H','127.0.0.1'],'r12-server.log',{VERCEL_ENV:'production',R05_ADMISSION_SERVER_KEY:R12_INERT_ROOT,OPENROUTER_API_KEY:'inert-r12-provider-placeholder'});
    const r12Origin=`http://localhost:${r12Port}`;let r12Ready=false;for(let attempt=0;attempt<120;attempt++){try{const response=await fetch(r12Origin+'/login',{redirect:'manual'});if(response.status<500){r12Ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,250));}assert.ok(r12Ready,'R12 Next fixture did not start');
    await runR12BootstrapJourney({origin:r12Origin,noKeyOrigin:origin,boundary,output,directory,httpOnly:process.argv.includes('--http-only')});
    await runR12Journeys({origin:r12Origin,noKeyOrigin:origin,boundary,output,directory,httpOnly:process.argv.includes('--http-only')});
    }finally{await rm(directory,{recursive:true,force:true});}
  }

} finally {
  const stopped=await Promise.allSettled(processes.map(child=>new Promise((resolve,reject)=>{
    if(child.exitCode!==null||child.signalCode!==null)return resolve();
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Next child did not exit; disposable source retained for safe cleanup'));},10000);
    child.once('exit',()=>{clearTimeout(timer);resolve();});
    if(child.exitCode!==null||child.signalCode!==null){clearTimeout(timer);resolve();return;}
    child.kill('SIGTERM');
  })));
  await boundary.close();
  await writeFile(path.join(output,'boundary.json'),JSON.stringify({reads:boundary.log,effects:boundary.effects,denied:boundary.denied},null,2));
  const failedStop=stopped.find(result=>result.status==='rejected');
  if(failedStop)throw failedStop.reason;
  await rm(fixture,{recursive:true,force:true});
}
