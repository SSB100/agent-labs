import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import terminal from '../.core-tests/creative/terminal-review.js';
const require = createRequire(import.meta.url), ts = require('typescript');
function load(file, dependencies = {}) {
 const source = ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const m={exports:{}};
 runInNewContext(`(function(require,module,exports){${source}\n})`,{URL,URLSearchParams,Date,FormData})(name=>{assert.ok(name in dependencies,`Unexpected dependency ${name}`);return dependencies[name];},m,m.exports);
 return m.exports;
}
const id=n=>`94000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1),business=id(2),runId=id(3),creativeId=id(4),approvalId=id(5),noticeId=id(6),definitionId=id(7);
const at='2026-10-02T08:00:00.123456+00:00';
const run={id:runId,business_id:business,workflow_definition_id:definitionId,status:'needs_owner',completed_at:at,input:{creativeRunId:creativeId,approvalId},state:{productionReady:false,publicationAllowed:false}};
const notice={id:noticeId,business_id:business,workflow_run_id:runId,intervention_type:'creative_review',status:'open',resolution:{},resolved_at:null,updated_at:at,action_intent_id:null};
const fixture=()=>({intervention:structuredClone(notice),run:structuredClone(run),definition:{id:definitionId,workflow_key:'etsy.creative-pipeline',version:'1.0.0'},creativeRun:{id:creativeId,business_id:business,workflow_run_id:runId,approval_id:approvalId},expectedNoticeId:noticeId,complete:true,stages:[{workflow_run_id:runId,status:'failed',completed_at:at}],workers:[],tasks:[],actionIntents:[]});
const form=()=>{const f=new FormData();f.set('interventionId',noticeId);f.set('expectedUpdatedAt',at);f.set('returnTo',`/dashboard?view=decisions&business=${business}&decision=${noticeId}&page=2&status=all`);return f;};
const resolution={version:terminal.TERMINAL_CREATIVE_REVIEW_VERSION,decision:'acknowledge',actorUserId:owner,businessId:business,workflowRunId:runId,creativeRunId:creativeId,interventionId:noticeId,expectedUpdatedAt:at,acknowledgedAt:at,executionResumed:false,newSpendAuthorized:false,costsReconciled:false};
test('terminal input preserves exact PostgreSQL microseconds and rejects malformed identity/token',()=>{
 assert.deepEqual(terminal.parseTerminalReviewRequest(form()),{interventionId:noticeId,expectedUpdatedAt:at});
 for(const [key,value] of [['interventionId','bad'],['expectedUpdatedAt','2026-10-02'],['expectedUpdatedAt',at+' '],['expectedUpdatedAt','2026-10-02T08:00:00.1234567Z']]) {const f=form();f.set(key,value);assert.equal(terminal.parseTerminalReviewRequest(f),null);}
});
test('eligibility is closed unless saved identity, complete terminal state and false execution flags match',()=>{
 assert.equal(terminal.canAcknowledgeTerminalCreativeReview(fixture()),true);
 const mutations=[f=>f.complete=false,f=>f.expectedNoticeId=id(99),f=>f.intervention.resolution={old:true},f=>f.intervention.status='resolved',f=>f.intervention.action_intent_id=id(99),f=>f.intervention.business_id=id(99),f=>f.run.input.creativeRunId=id(99),f=>f.run.input.approvalId=id(99),f=>f.run.completed_at=null,f=>f.run.status='running',f=>f.run.state.productionReady=true,f=>delete f.run.state.publicationAllowed,f=>f.definition.version='2.0.0',f=>f.definition.workflow_key='synthetic.core',f=>f.creativeRun.business_id=id(99),f=>f.stages=[],f=>f.stages[0].status='waiting',f=>f.stages[0].completed_at=null,f=>f.workers=[{workflow_run_id:runId,status:'running'}],f=>f.tasks=[{workflow_run_id:runId,status:'ready'}],f=>f.actionIntents=[{workflow_run_id:runId,status:'approved'}]];
 for(const mutate of mutations){const f=fixture();mutate(f);assert.equal(terminal.canAcknowledgeTerminalCreativeReview(f),false,String(mutate));}
});
test('generic resolved, forged identities, excess keys and microsecond timestamp mismatch never read Reviewed',()=>{
 const args=()=>({intervention:{...notice,status:'resolved',resolved_at:at,resolution:structuredClone(resolution)},run,creativeRunId:creativeId,ownerUserId:owner});
 assert.equal(terminal.isTerminalCreativeReviewAcknowledgement(args()),true);
 const variants=[r=>r.version='other',r=>r.decision='approve',r=>r.actorUserId=id(99),r=>r.businessId=id(99),r=>r.workflowRunId=id(99),r=>r.creativeRunId=id(99),r=>r.interventionId=id(99),r=>r.executionResumed=true,r=>r.newSpendAuthorized=true,r=>r.costsReconciled=true,r=>r.acknowledgedAt='2026-10-02T08:00:00.123455Z',r=>r.extra=true];
 for(const mutate of variants){const f=args();mutate(f.intervention.resolution);assert.equal(terminal.isTerminalCreativeReviewAcknowledgement(f),false);}
 const generic=args();generic.intervention.resolution={decision:'acknowledge'};assert.equal(terminal.isTerminalCreativeReviewAcknowledgement(generic),false);
 const timezone=args();timezone.intervention.resolution.acknowledgedAt='2026-10-02T10:00:00.123456+02:00';assert.equal(terminal.isTerminalCreativeReviewAcknowledgement(timezone),true);
});
function actionHarness(options={}) {
 const calls=[],revalidated=[];
 const supabase={auth:{getClaims:async()=>options.session===false?{error:{},data:null}:{error:null,data:{claims:{sub:owner}}}},rpc:async(name,args)=>{calls.push({name,args});if(options.throws)throw Error('secret backend text');return options.response??{error:null,data:{outcome:'acknowledged',interventionId:noticeId,businessId:business,workflowRunId:runId}};}};
 const action=load('src/app/dashboard/terminal-review-actions.ts',{'next/cache':{revalidatePath:p=>revalidated.push(p)},'next/navigation':{redirect:p=>{throw new Error(`REDIRECT:${p}`);}},'@/lib/supabase/server':{createClient:async()=>supabase},'@/lib/core-ui/console-decisions-query':load('src/lib/core-ui/console-decisions-query.ts'),'@/creative/terminal-review':terminal}).acknowledgeTerminalCreativeReview;
 return {action,calls,revalidated};
}
test('owner-session action sends exact token to one RPC and returns to exact root Decisions scope',async()=>{
 const h=actionHarness();await assert.rejects(h.action(form()),new RegExp(`REDIRECT:/dashboard\\?view=decisions&business=${business}&decision=${noticeId}&page=2&status=all&message=terminal-review-acknowledged`));
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].name,'acknowledge_terminal_creative_review');assert.equal(JSON.stringify(h.calls[0].args),JSON.stringify({p_intervention_id:noticeId,p_expected_updated_at:at}));
 assert.ok(h.revalidated.includes('/dashboard'));assert.ok(h.revalidated.includes(`/dashboard/workflows/${runId}`));
});
test('invalid inputs and missing owner session perform no RPC',async()=>{
 const invalid=actionHarness(),f=form();f.set('expectedUpdatedAt','bad');await assert.rejects(invalid.action(f),/terminal-review-invalid/);assert.equal(invalid.calls.length,0);
 const unauth=actionHarness({session:false});await assert.rejects(unauth.action(form()),/REDIRECT:\/login\?error=session-required/);assert.equal(unauth.calls.length,0);
});
test('fixed safe error codes cover denial, stale, ineligible, failure and thrown transport without leaking details',async()=>{
 for(const [error,code] of [[{message:'terminal_review_conflict'},'conflict'],[{message:'terminal_review_not_eligible'},'ineligible'],[{code:'42501',message:'sensitive raw value'},'unavailable'],[{message:'sensitive backend value'},'failed']]){const h=actionHarness({response:{error,data:null}});await assert.rejects(h.action(form()),new RegExp(`&error=terminal-review-${code}$`));assert.equal(h.revalidated.length,0);}
 await assert.rejects(actionHarness({throws:true}).action(form()),/&error=terminal-review-failed$/);
});
test('safe replay result remains acknowledgement and malicious return routes cannot escape the Decisions surface',async()=>{
 for(const returnTo of ['https://evil.invalid/','//evil.invalid','/dashboard/workflows/'+runId,'/dashboard?view=decisions&business=invalid','/dashboard?view=decisions#bad']){
  const h=actionHarness({response:{error:null,data:{outcome:'already_acknowledged',interventionId:noticeId,businessId:business,workflowRunId:runId}}}),f=form();f.set('returnTo',returnTo);
  await assert.rejects(h.action(f),new RegExp(`^Error: REDIRECT:/dashboard\\?view=decisions&business=${business}&decision=${noticeId}&message=terminal-review-already-acknowledged$`));
 }
 const malformed=actionHarness({response:{error:null,data:{outcome:'acknowledged',interventionId:noticeId,businessId:'invalid',workflowRunId:runId}}});await assert.rejects(malformed.action(form()),/terminal-review-failed$/);
});
