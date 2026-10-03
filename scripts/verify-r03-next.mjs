import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { startFixtureBoundary } from '../tests/next-fixture/server.mjs';
import { runNextJourneys } from '../tests/next-fixture/journeys.mjs';

const root = process.cwd(), output = path.join(root, 'test-results/r03-next');
await mkdir(output, { recursive: true });
const fixture = await mkdtemp(path.join(tmpdir(), 'agent-labs-r03-'));
const boundary = await startFixtureBoundary();
const log = name => createWriteStream(path.join(output, name));
const env = Object.fromEntries(['PATH','HOME','TMPDIR','SystemRoot'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
Object.assign(env, { NODE_ENV: 'production', CI: 'true', NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_SUPABASE_URL: boundary.origin,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'inert-fixture-only', R03_BOUNDARY: boundary.origin,
  R03_NETWORK_LOG: path.join(output, 'blocked-network.jsonl'), NODE_OPTIONS: `--import=${path.join(root, 'tests/next-fixture/block-network.mjs')}` });
const processes = [];
function start(args, name) {
  const child = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), ...args], { cwd: fixture, env, stdio: ['ignore','pipe','pipe'] });
  const stream = log(name); child.stdout.pipe(stream); child.stderr.pipe(stream); processes.push(child);
  return child;
}
const completion = child => new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(Error(`Next command failed (${code}); see preserved logs`))); });
try {
  for (const name of ['src','public','next.config.ts','tsconfig.json','package.json','package-lock.json','next-env.d.ts']) {
    try { await cp(path.join(root,name),path.join(fixture,name),{recursive:true}); } catch (error) { if(error.code !== 'ENOENT') throw error; }
  }
  await symlink(path.join(root,'node_modules'),path.join(fixture,'node_modules'),'dir');
  // Four reviewed transport substitutions. Actual pages, readers, ownership guards,
  // actions, redirects, Link/router, RSC, Suspense and revalidation remain unchanged.
  await cp(path.join(root,'tests/next-fixture/transport.mjs'),path.join(fixture,'src/lib/supabase/inert-transport.mjs'));
  await writeFile(path.join(fixture,'src/lib/supabase/inert-transport.d.mts'), 'export function makeClient(origin:string,session?:string,mode?:string): unknown;\n');
  const serverType = (await readFile(path.join(root,'src/lib/supabase/server.ts'),'utf8')).replace('export async function createClient()', 'async function productionClientType()');
  await writeFile(path.join(fixture,'src/lib/supabase/server.ts'), serverType + `\nimport { makeClient } from './inert-transport.mjs';\nexport async function createClient() { const c=await cookies(); return makeClient(process.env.R03_BOUNDARY!,c.get('r03-session')?.value??'on',c.get('r03-mode')?.value??'normal') as Awaited<ReturnType<typeof productionClientType>>; }\n`);
  const clientType = (await readFile(path.join(root,'src/lib/supabase/client.ts'),'utf8')).replace('export function createClient()', 'function productionClientType()');
  await writeFile(path.join(fixture,'src/lib/supabase/client.ts'), clientType + `\nexport function createClient() { const channel = { on(){return channel}, subscribe(){return channel} }; return { channel(){return channel}, removeChannel(){return Promise.resolve('ok')} } as unknown as ReturnType<typeof productionClientType>; }\n`);
  await writeFile(path.join(fixture,'src/lib/supabase/proxy.ts'), `import { NextResponse, type NextRequest } from 'next/server';\nexport function updateSupabaseSession(_request:NextRequest, requestHeaders:Headers) { return NextResponse.next({request:{headers:requestHeaders}}); }\n`);
  await writeFile(path.join(output,'isolation.json'),JSON.stringify({copiedSource:true,substitutions:['supabase/server.ts','supabase/client.ts','supabase/proxy.ts','inert-transport.mjs'],credentials:'none; inert loopback identifiers only',network:'loopback only; denied effects logged',fixture:'two owned Businesses; realistic saved failures and costs'},null,2));
  console.log('Building disposable production Next application with blocked external effects.');
  await completion(start(['build','--webpack'],'build.log'));
  const probe = createServer(); await new Promise(resolve => probe.listen(0,'127.0.0.1',resolve)); const port=probe.address().port; await new Promise(resolve=>probe.close(resolve));
  start(['start','-p',String(port),'-H','127.0.0.1'],'server.log');
  const origin=`http://127.0.0.1:${port}`;
  let ready=false;
  for(let attempt=0;attempt<120;attempt++){try{const response=await fetch(origin+'/login',{redirect:'manual'});if(response.status<500){ready=true;break;}}catch{} await new Promise(resolve=>setTimeout(resolve,250));}
  assert.ok(ready,'Production Next fixture did not start');
  await runNextJourneys({origin,boundary,output,httpOnly:process.argv.includes('--http-only')});
} finally {
  for(const child of processes)if(child.exitCode===null)child.kill('SIGTERM');
  await boundary.close();
  await writeFile(path.join(output,'boundary.json'),JSON.stringify({reads:boundary.log,effects:boundary.effects,denied:boundary.denied},null,2));
  await rm(fixture,{recursive:true,force:true});
}
