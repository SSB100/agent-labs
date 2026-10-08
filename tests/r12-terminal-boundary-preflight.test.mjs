/** One focused opt-in regression; no Next build or legacy outcome matrix. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {validateR12HttpDatabase} from './helpers/r12-postgrest-http.mjs';
import {exerciseR12TerminalBoundaryPreflight} from './helpers/r12-terminal-boundary-preflight.mjs';
test('Actual terminal-source boundary entry and owner/runtime controls work without inherited host configuration',{skip:process.env.R12_TERMINAL_BOUNDARY_PREFLIGHT!=='1',timeout:240000},async()=>{
 validateR12HttpDatabase(process.env.R12_POSTGRES_URL);assert.equal(process.env.R12_REQUIRE_POSTGRES,'1');process.env.R12_RPC_HTTP_ONLY='1';
 const {prepareR12OwnerWorkflows}=await import('./r12-discovery-scope-sql.test.mjs'),fixture=await prepareR12OwnerWorkflows();let report;
 try{await fixture.exerciseFocused(async({db,closedFocused})=>{report=await exerciseR12TerminalBoundaryPreflight(db,closedFocused);});assert.equal(report.passed,true);console.log('R12 focused terminal boundary preflight:',JSON.stringify(report));
  if(process.env.R12_TERMINAL_BOUNDARY_REPORT){assert.match(process.env.R12_TERMINAL_BOUNDARY_REPORT,/^\/tmp\/r12-[a-z0-9-]+\.json$/);writeFileSync(process.env.R12_TERMINAL_BOUNDARY_REPORT,JSON.stringify(report,null,2)+'\n');}
 }finally{await fixture.close();}
});
