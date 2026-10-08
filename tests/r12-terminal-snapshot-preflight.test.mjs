/** Optional consumer of the complete fresh base -> review snapshot chain. */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {writeFileSync} from 'node:fs';
import {fixtureData} from './next-fixture/data.mjs';
import {loadR12NextFixture,closeR12Fixture} from './next-fixture/r12-sql.mjs';
import {exerciseR12TerminalBoundaryPreflight} from './helpers/r12-terminal-boundary-preflight.mjs';

test('fresh Next snapshot consumer reaches terminal-source, interrupted receipts and Stop without inherited configuration',{skip:process.env.R12_TERMINAL_SNAPSHOT_PREFLIGHT!=='1',timeout:240000},async()=>{
 const directory=path.resolve(process.env.R12_TERMINAL_SNAPSHOT_DIRECTORY??''),host=process.env.R12_SQL_TEST_HOST;
 assert.ok(path.basename(directory).startsWith('r12-next-')&&host&&!process.env.R12_POSTGRES_URL,'Fresh isolated Next snapshot directory and PGlite host required');
 const state=fixtureData(),names=['VERCEL_ENV','R05_ADMISSION_SERVER_KEY','OPENROUTER_API_KEY'],prior=Object.fromEntries(names.map(name=>[name,process.env[name]]));
 try{
  for(const name of names)delete process.env[name];
  console.log('R12 terminal snapshot consumer: loading focused-successor-preparation');
  const started=performance.now(),loaded=await loadR12NextFixture(state,'focused-successor-preparation',directory,host),snapshotLoadMs=Math.round(performance.now()-started);
  assert.equal(typeof loaded.db.dumpDataDir,'function');assert.ok(loaded.closedFocused&&!loaded.closedUnsent&&!loaded.closedMarked);assert.deepEqual(loaded.calls,[]);
  console.log('R12 terminal snapshot consumer: predecessor restored and prepared',JSON.stringify({snapshotLoadMs,providerCalls:0}));
  await loaded.db.exec('begin');let report;
  try{report=await exerciseR12TerminalBoundaryPreflight(loaded.db,loaded.closedFocused);}finally{await loaded.db.exec('rollback');}
  assert.equal(report.engine,'pglite');assert.equal(report.passed,true);assert.ok(names.every(name=>process.env[name]===undefined));
  report={...report,snapshotLoadMs};console.log('R12 terminal snapshot consumer:',JSON.stringify(report));
  if(process.env.R12_TERMINAL_SNAPSHOT_REPORT){assert.match(process.env.R12_TERMINAL_SNAPSHOT_REPORT,/^\/tmp\/r12-[a-z0-9-]+\.json$/);writeFileSync(process.env.R12_TERMINAL_SNAPSHOT_REPORT,JSON.stringify(report,null,2)+'\n');}
 }finally{try{await closeR12Fixture(state);}finally{for(const[name,value]of Object.entries(prior)){if(value===undefined)delete process.env[name];else process.env[name]=value;}}}
});
