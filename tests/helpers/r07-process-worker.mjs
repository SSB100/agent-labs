import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {driveQuestOnce} from '../../.core-tests/core/quest-controller.js';
import {R07_KEY,R05_KEY,R07_LEASE} from './r07-sql-fixture.mjs';
const require=createRequire(path.resolve(process.env.R07_SQL_TEST_HOST,'package.json'));
const {PGlite}=require('@electric-sql/pglite'),{pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
const [dir,scopeFile,mode,ticks]=process.argv.slice(2);
const scope=JSON.parse(readFileSync(scopeFile,'utf8'));
const db=new PGlite(dir,{extensions:{pgcrypto}});
const digest=x=>createHash('sha256').update(x).digest('hex');
const call=async(op,payload={},epoch=1)=>{
 const p=structuredClone(payload);
 if(['schedule','reserve'].includes(op))p.runtimeCapability='inert-runtime-capability-'.repeat(3);
 return (await db.query('select public.r07_controller($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9) result',[scope.businessId,scope.goalId,op,JSON.stringify(p),randomUUID(),R07_KEY,R07_LEASE,epoch,R05_KEY])).rows[0].result;
};
const store={read:()=>call('read'),command:call};
const registry=Object.fromEntries(scope.plan.steps.map(step=>[step.adapter,{
 mode:'simulation',qualificationHash:step.qualificationHash,workflowDefinitionId:step.workflowDefinitionId,workerDefinitionId:step.workerDefinitionId,
 async prepare(context){
  const body=JSON.stringify({model:'inert/model',max_tokens:100,stream:false,messages:[{role:'user',content:`${context.step.objective} ${context.attempt.inputHash}`} ]});
  return {wire:{url:'https://openrouter.ai/api/v1/chat/completions',method:'POST',body},descriptor:{workflowRunId:context.attempt.id,operationKey:'research.model',requestHash:digest(body),idempotencyKey:`r07:${context.attempt.id}`,providerModelId:'inert/model',wireRequestHash:digest(body),wireRequestBytes:Buffer.byteLength(body),maximumOutputTokens:100,accounting:{kind:'r05'},sourceDomains:[],dataClasses:['business_context','public_evidence'],accountId:null,accountRevision:null,currency:'USD',liabilityMicrounits:'60'}};
 },
 async dispatch(wire,context){
  if(mode==='crash-before-effect'){await db.close();process.exit(70);}
  const response={outcome:'accepted',result:context.step.kind==='challenge'?{verdict:'pass'}:{evidence:'Inert persisted provider response'},checkedArtifacts:context.attempt.dependencyPins,settlement:{actualMicrounits:'40',providerRequestId:`process:${context.attempt.id}`,receiptHash:digest(context.attempt.id)}};
  // This isolated table is the fake provider's durable ledger, independent of controller state.
  await db.query('insert into public.r07_inert_effects(id,response) values($1,$2::jsonb)',[context.attempt.id,JSON.stringify(response)]);
  if(mode==='crash-after-effect'){await db.close();process.exit(71);}
  if(mode==='unknown-cost')return {...response,settlement:{...response.settlement,actualMicrounits:null,receiptHash:digest(`${context.attempt.id}:unknown`)}};
  return response;
 },
 async reconcile(context){const saved=(await db.query('select response from public.r07_inert_effects where id=$1',[context.attempt.id])).rows[0];return saved?{status:'found',response:saved.response}:{status:'unknown'};}
}]));
const results=[];
try{
 for(let i=0;i<Number(ticks);i++){
  const result=await driveQuestOnce(store,{adapters:registry,reconcile:mode==='reconcile'});results.push(result);
  if(result.status!=='progress')break;
 }
 process.stdout.write(JSON.stringify({results,snapshot:await store.read(),effects:(await db.query('select count(*)::int n from public.r07_inert_effects')).rows[0].n}));
}finally{await db.close();}
