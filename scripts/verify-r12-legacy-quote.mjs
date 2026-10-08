import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';

// Exact existing owner workflow, without replaying the unrelated successor matrix.
// Only the existing isolated PostgreSQL harness is accepted by the imported setup.
assert.equal(process.env.R12_REQUIRE_POSTGRES,'1');
assert.ok(process.env.R12_POSTGRES_URL);
process.env.R12_RPC_HTTP_ONLY='1';
const {prepareR12OwnerWorkflows}=await import('../tests/r12-discovery-scope-sql.test.mjs');
const started=performance.now();let fixture,error;
// Same finite 120-second setup + 120-second workflow allowance as the full suite.
const deadline=setTimeout(()=>{console.error('Isolated legacy quote diagnostic exceeded 240 seconds');process.exit(1);},240000);
try{fixture=await prepareR12OwnerWorkflows();await fixture.exerciseOwnerWorkflows();}
catch(failure){error=failure;}
finally{try{await fixture?.close();}catch(failure){error=error?new AggregateError([error,failure],'Diagnostic and cleanup failed'):failure;}finally{clearTimeout(deadline);}}
const report={version:'r12.legacy-quote-diagnostic.1',diagnosticPassed:!error,releaseQualified:false,elapsedMs:Math.round(performance.now()-started),...(error?{error:String(error.stack??error)}:{})};
await mkdir('test-results',{recursive:true});await writeFile('test-results/r12-legacy-quote.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
if(error)throw error;
