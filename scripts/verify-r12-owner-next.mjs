import assert from 'node:assert/strict';
import {cp,mkdir,mkdtemp,readFile,writeFile,symlink,rm} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {startFixtureBoundary} from '../tests/next-fixture/server.mjs';
import {runOwnerInitialJourney} from '../tests/next-fixture/r12-owner-initial-journey.mjs';
import {runOwnerInitialHttp} from '../tests/next-fixture/r12-owner-initial-http.mjs';
import {runEtsyOwnerHttp} from '../tests/next-fixture/r12-etsy-http.mjs';
import {R12_INERT_ROOT} from '../tests/next-fixture/r12-sql.mjs';

// Production pages/actions/runtime/SQL are unchanged. Only Supabase transport,
// quote/provider dependencies and realtime/auth plumbing use the existing inert
// loopback boundary. No production environment values are inherited.
assert.ok(process.env.R12_SQL_TEST_HOST,'Set R12_SQL_TEST_HOST to installed isolated PGlite tooling');
const root=process.cwd(),output=path.join(root,'test-results/r12-owner-next');await mkdir(output,{recursive:true});
const temporaryRoot=process.platform==='win32'?path.resolve(root,'work/next-fixtures'):path.resolve(tmpdir());await mkdir(temporaryRoot,{recursive:true});
const fixture=await mkdtemp(path.join(temporaryRoot,'agent-labs-owner-next-'));
assert.ok(path.dirname(fixture)===temporaryRoot&&path.basename(fixture).startsWith('agent-labs-owner-next-'));
const boundary=await startFixtureBoundary(),processes=[];
const env=Object.fromEntries(['PATH','HOME','TMPDIR','SystemRoot'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
Object.assign(env,{NODE_ENV:'production',CI:'true',NEXT_TELEMETRY_DISABLED:'1',NEXT_PUBLIC_SUPABASE_URL:boundary.origin,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'inert-fixture-only',R03_BOUNDARY:boundary.origin,R03_NETWORK_LOG:path.join(output,'blocked-network.jsonl'),NODE_OPTIONS:`--import=${pathToFileURL(path.join(root,'tests/next-fixture/block-network.mjs')).href}`});
function start(args,name,extra={}){const child=spawn(process.execPath,[path.join(root,'node_modules/next/dist/bin/next'),...args],{cwd:fixture,env:{...env,...extra},stdio:['ignore','pipe','pipe']});const stream=createWriteStream(path.join(output,name));child.stdout.pipe(stream);child.stderr.pipe(stream);processes.push(child);return child;}
const completion=child=>new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>code===0?resolve():reject(Error(`Next failed (${code??signal}); inspect ${output}`)));});
try {
  for(const name of ['src','public','next.config.ts','tsconfig.json','package.json','package-lock.json','next-env.d.ts'])try{await cp(path.join(root,name),path.join(fixture,name),{recursive:true});}catch(error){if(error.code!=='ENOENT')throw error;}
  await symlink(path.join(root,'node_modules'),path.join(fixture,'node_modules'),process.platform==='win32'?'junction':'dir');
  const config=await readFile(path.join(fixture,'next.config.ts'),'utf8'),anchor='const nextConfig: NextConfig = {';assert.equal(config.split(anchor).length,2);await writeFile(path.join(fixture,'next.config.ts'),config.replace(anchor,anchor+'\n  experimental: { cpus: 2 },'));
  await cp(path.join(root,'tests/next-fixture/transport.mjs'),path.join(fixture,'src/lib/supabase/inert-transport.mjs'));
  await writeFile(path.join(fixture,'src/lib/supabase/inert-transport.d.mts'),'export function makeClient(origin:string,session?:string,mode?:string): unknown;\n');
  const serverType=(await readFile(path.join(root,'src/lib/supabase/server.ts'),'utf8')).replace('export async function createClient()','async function productionClientType()');
  await writeFile(path.join(fixture,'src/lib/supabase/server.ts'),serverType+`\nimport { makeClient } from './inert-transport.mjs';\nexport async function createClient() { const c=await cookies(); return makeClient(process.env.R03_BOUNDARY!,c.get('r03-session')?.value??'on',c.get('r03-mode')?.value??'normal') as Awaited<ReturnType<typeof productionClientType>>; }\n`);
  const clientType=(await readFile(path.join(root,'src/lib/supabase/client.ts'),'utf8')).replace('export function createClient()','function productionClientType()');
  await writeFile(path.join(fixture,'src/lib/supabase/client.ts'),clientType+`\nexport function createClient() { const channel = { on(){return channel}, subscribe(){return channel} }; return { channel(){return channel}, removeChannel(){return Promise.resolve('ok')} } as unknown as ReturnType<typeof productionClientType>; }\n`);
  await writeFile(path.join(fixture,'src/lib/supabase/proxy.ts'),`import { NextResponse, type NextRequest } from 'next/server';\nexport function updateSupabaseSession(_request:NextRequest, requestHeaders:Headers) { return NextResponse.next({request:{headers:requestHeaders}}); }\n`);
  await cp(path.join(root,'tests/next-fixture/r12-dependencies.ts'),path.join(fixture,'src/products/discovery-r12-server-dependencies.ts'));
  await writeFile(path.join(output,'isolation.json'),JSON.stringify({copiedProductionSource:true,sql:'fresh PGlite with all actual migrations',provider:'synthetic phase responses and receipts',network:'loopback only',credentials:'inert test placeholders only',substitutions:['Supabase auth/query transport and realtime plumbing','discovery-r12-server-dependencies.ts: quote/provider transport only'],purpose:'Technical owner workflow qualification, no business evidence'},null,2));
  console.log('Building isolated production Next owner workflow.');await completion(start(['build','--webpack'],'build.log'));
  const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  start(['start','-p',String(port),'-H','127.0.0.1'],'server.log',{VERCEL_ENV:'production',R05_ADMISSION_SERVER_KEY:R12_INERT_ROOT,OPENROUTER_API_KEY:'inert-r12-provider-placeholder'});
  const origin=`http://localhost:${port}`;let ready=false;
  for(let i=0;i<120;i++){try{if((await fetch(origin+'/login',{redirect:'manual'})).status<500){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,250));}assert.ok(ready,'Next owner fixture did not start');
  if(process.argv.includes('--http-only')){await runOwnerInitialHttp({origin,boundary,output,fixture});await runEtsyOwnerHttp({origin,boundary,output,fixture});}
  else await runOwnerInitialJourney({origin,boundary,output});
} finally {
  const stopped=await Promise.allSettled(processes.map(child=>new Promise((resolve,reject)=>{if(child.exitCode!==null||child.signalCode!==null)return resolve();const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Next did not stop; source retained'));},10000);child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill('SIGTERM');})));
  await boundary.close();await writeFile(path.join(output,'boundary.json'),JSON.stringify({reads:boundary.log,effects:boundary.effects,denied:boundary.denied},null,2));
  const failed=stopped.find(result=>result.status==='rejected');if(failed)throw failed.reason;
  await rm(fixture,{recursive:true,force:true});
}
