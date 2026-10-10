import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {r04SqlBootstrap} from './helpers/r04-sql-bootstrap.mjs';
import {sessionBootstrap} from './helpers/r10-sql-fixture.mjs';
const host=process.env.R12_SQL_TEST_HOST??process.env.R11_SQL_TEST_HOST;
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const identity=quote=>digest({quote:quote.normalize('NFC').replace(/[\t\n\v\f\r ]+/g,' ').trim(),version:'r12.evidence-text.1'});

test('private stagnation predicates enforce bounded diagnosis without creating phases or authority',{skip:!host,timeout:120000},async()=>{
  const require=createRequire(path.resolve(host,'package.json')),{PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
  const db=new PGlite({extensions:{pgcrypto}});
  try{
    await db.exec(r04SqlBootstrap+sessionBootstrap);
    for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
    // Temporary integration seam; CI uses the incorporated migration directly.
    if(process.env.R12_ADAPTIVE_STAGNATION_FRAGMENT)await db.exec(readFileSync(process.env.R12_ADAPTIVE_STAGNATION_FRAGMENT,'utf8'));
    for(const quote of [' A\tprecise\nquote ','Cafe\u0301\u00a0','\ufeffA\vquoted span\r\n'])
      assert.equal((await db.query('select private.r12_adaptive_quote_identity($1) h',[quote])).rows[0].h,identity(quote));
    const state={consecutiveNonprogress:2,reasoningReviewUsed:false,episodeTargets:[]};
    const body={ordinal:2,kind:'followup',question:'Does this candidate appeal to the scoped audience?',hypothesis:'Different testable hypothesis',counterevidenceQuestion:'Does the separately reviewed source contradict this observation?',expectedInformationGain:'Test whether the newly dated source resolves the named uncertainty.'};
    const recommendation=(b,gap,reason='A newly available dated publication can answer the unresolved question.')=>({kind:b.kind,publicQuestion:b.question,hypothesis:b.hypothesis,counterevidenceQuestion:b.counterevidenceQuestion,expectedInformationGain:b.expectedInformationGain,gap,reason});
    const decide=async(s,b,gap,diagnostic=false,reason)=>(await db.query('select private.r12_adaptive_stagnation_decision($1,$2,$3,$4) d',[s,b,recommendation(b,gap,reason),diagnostic])).rows[0].d;
    assert.equal((await decide(state,body,'evidence')).allowed,true);
    const target=(await db.query('select private.r12_adaptive_investigation_key($1,$2) k',[body,recommendation(body,'evidence')])).rows[0].k;
    const repeated={...state,episodeTargets:[target]};
    assert.equal((await decide(repeated,body,'evidence')).allowed,false,'Identical reviewed target cannot be retried without diagnosis');
    assert.equal((await decide(repeated,body,'evidence',false,'The next dated release from the already reviewed source provides a distinct retrieval condition.')).allowed,true,'Same factual question is allowed with a separately reviewed new retrieval condition');
    assert.equal((await decide(state,body,'reasoning')).allowed,false,'Evidence followup must diagnose an evidence gap');
    assert.equal((await decide(state,{...body,kind:'pivot'},'hypothesis')).allowed,true);
    assert.equal((await decide(state,{...body,kind:'reasoning_review'},'reasoning')).allowed,true);
    assert.equal((await decide({...state,reasoningReviewUsed:true},{...body,kind:'reasoning_review'},'reasoning',true)).allowed,false,'Omitted recommendation cannot bypass one reasoning review');
    assert.equal((await decide(state,{...body,kind:'repair'},'evidence')).allowed,true,'Exact paid format repair remains separately eligible');
    assert.equal((await decide({...repeated,consecutiveNonprogress:1},body,'evidence')).allowed,true);

    // Pure JSON semantic fixtures only: no fabricated completed attempts,
    // closures, receipt rows, grants or transport are created by these checks.
    const quote='A precise attributable observation contradicts the original candidate assumption.',ih=identity(quote),before='1'.repeat(64),action='2'.repeat(64);
    const baseline={questionId:'gap-observation',findingHash:before,statement:'Does the observation support the original candidate assumption?',evidenceIdentityHashes:[]};
    const raw={kind:'refuted',questionId:baseline.questionId,priorFindingHash:before,finding:'The cited observation contradicts this specific candidate assumption.',evidenceRefs:['E1'],opposingInterpretation:'A wider audience could differ; the observation refutes only this scoped assumption.'};
    const progress={kind:raw.kind,questionId:raw.questionId,beforeFindingHash:before,afterFindingHash:digest({finding:raw.finding,evidenceIdentityHashes:[ih]}),supportingRefs:['E1'],reasoningOnly:false};
    const input={reviewContext:{priorFindings:[baseline],evidenceIdentityHashes:{E1:ih},allowReasoningProgress:false},evidence:[{key:'E1',quote}]};
    const dep={origin:{actionHash:action},response:{result:{review:{progress,rawResponse:{progress:raw}}}},binding:{request:{messages:[{}, {content:JSON.stringify(input)}]}}};
    const archive={selector:{origin:{actionHash:action}},persisted:{artifactId:'pack-one',evidencePack:{evidence:[{quote}]}}};
    const snapshot={priorFindings:[baseline],intentPins:{activeEvidenceArtifactIds:['pack-one']},archive:[archive]};
    const counts=async(d,s,kind='followup')=>(await db.query('select private.r12_adaptive_review_progress($1,$2,$3) v',[d,s,kind])).rows[0].v;
    assert.equal(await counts(dep,snapshot),true,'Attributable negative learning can progress');
    assert.equal(await counts(dep,snapshot,'repair'),false,'Repair cannot reset stagnation');
    assert.equal(await counts(dep,{...snapshot,archive:[...snapshot.archive,{...archive,selector:{origin:{actionHash:'3'.repeat(64)}}}]}),false,'Same quote in another action is not novel');
    const moved=structuredClone(dep);moved.response.result.review.progress.afterFindingHash='4'.repeat(64);
    assert.equal(await counts(moved,snapshot),false,'A new hash alone is not progress');
    const unknown=structuredClone(dep);unknown.response.result.review.progress.supportingRefs=['E9'];unknown.response.result.review.rawResponse.progress.evidenceRefs=['E9'];
    assert.equal(await counts(unknown,snapshot),false,'Unknown source references fail closed');
    assert.equal((await db.query('select count(*)::integer n from private.r12_adaptive_actions')).rows[0].n,0);
  }finally{await db.close();}
});
