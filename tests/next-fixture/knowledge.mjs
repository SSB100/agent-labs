import {createHash} from 'node:crypto';
import {id,time} from './data.mjs';

// Independent inert R09 transport, never a production SQL or provider substitute.
export const knowledgeId=(kind,business=0,n=0)=>id(({proposal:9600000,version:9610000,review:9620000,release:9630000,application:9640000,usage:9650000,plan:9660000,artifact:9670000,installation:9680000}[kind]??9690000)+business*1000+n);
export const knowledgeHash=value=>createHash('sha256').update(String(value)).digest('hex');
export const knowledgePackKey='knowledge.fixture.source-review';
const success=data=>({data:structuredClone(data),error:null});
const rejected=()=>({data:null,error:{code:'42501',message:'Private inert Knowledge diagnostic must never render'}});
const validId=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const exactKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));

export function readKnowledgeFixture(state,args,mode='normal'){
 const businessId=args.p_business_id,dataset=args.p_dataset,q=args.p_query??{};
 if(!state.businesses.some(b=>b.id===businessId)||mode==='unavailable')return rejected();
 if(!['proposals','releases','applications','usage'].includes(dataset))throw Error('Unreviewed Knowledge dataset');
 if(!exactKeys(q,['limit','offset','query','selectedId'])||!Number.isInteger(q.limit)||q.limit<1||q.limit>25||!Number.isInteger(q.offset)||q.offset<0||q.offset>10000||typeof(q.query??'')!=='string'||(q.query??'').length>120||q.selectedId!==undefined&&!validId(q.selectedId))throw Error('Unreviewed Knowledge query');
 const rows=mode==='empty'?[]:(state.knowledge?.[dataset]??[]).filter(row=>dataset==='releases'||row.businessId===businessId);
 const all=rows.map(row=>{
  const item=structuredClone(row);
  if(dataset==='applications')item.releaseStatus=item.releaseId?state.knowledge.releases.find(r=>r.id===item.releaseId)?.status??null:null;
  if(dataset==='releases'||dataset==='applications'){
   const current=(state.knowledge?.applications??[]).find(a=>a.businessId===businessId&&a.packKey===row.packKey&&a.isCurrent);
   item.application=current?{id:current.id,releaseId:current.releaseId}:null;
  }
  return item;
 });
 const searchable=row=>dataset==='proposals'?`${row.title} ${row.scope}`:dataset==='releases'?`${row.packKey} ${row.version}`:dataset==='applications'?`${row.packKey} ${row.reason}`:`${row.goalId} ${row.planVersion}`;
 const filtered=all.filter(row=>searchable(row).toLowerCase().includes((q.query??'').toLowerCase())).sort((a,b)=>String(b.createdAt??b.promotedAt??time).localeCompare(String(a.createdAt??a.promotedAt??time))||b.id.localeCompare(a.id));
 const item=q.selectedId?all.find(row=>row.id===q.selectedId)??null:null;
 const summary=row=>{if(dataset==='usage')return {id:row.id,businessId:row.businessId,planVersion:row.planVersion,knowledgeCount:row.knowledge.length,createdAt:row.createdAt};const keys={proposals:['id','businessId','title','version','status','createdAt'],releases:['id','packKey','title','version','status','reviewedAt'],applications:['id','businessId','packKey','version','operation','status','releaseStatus','isCurrent','createdAt']}[dataset];return Object.fromEntries(keys.map(key=>[key,row[key]]));};
 return success({businessId,dataset,items:filtered.slice(q.offset,q.offset+q.limit).map(summary),total:filtered.length,limit:q.limit,offset:q.offset,selection:{status:q.selectedId?item?'selected':'missing':'none',item},readOnly:true});
}

export function saveKnowledgeFixture(state,args,effects,mode='success'){
 const businessId=args.p_business_id,operation=args.p_operation,p=args.p_payload;
 if(!state.knowledge||!state.businesses.some(b=>b.id===businessId)||!validId(args.p_submission_id)||!['propose','apply','rollback','remove'].includes(operation))return rejected();
 if(mode==='uncertain')return {data:null,error:null};
 if(mode!=='success')return rejected();
 const key=`${businessId}:${args.p_submission_id}`,encoded=JSON.stringify([operation,p]),existing=state.knowledge.submissions.get(key);
 if(existing)return existing.encoded===encoded?success({...existing.result,replayed:true}):rejected();
 let result;
 if(operation==='propose'){
  if(!exactKeys(p,['proposalId','expectedVersion','title','lesson','scope','limitations','artifactIds'])||!Array.isArray(p.artifactIds)||!p.artifactIds.length||p.artifactIds.some(artifactId=>!state.db.artifacts.some(a=>a.id===artifactId&&a.business_id===businessId))||typeof p.title!=='string'||p.title.length<3||typeof p.lesson!=='string'||p.lesson.length<20||typeof p.scope!=='string'||p.scope.length<3||!Array.isArray(p.limitations)||!p.limitations.length)return rejected();
  const previous=p.proposalId?state.knowledge.proposals.filter(r=>r.proposalId===p.proposalId&&r.businessId===businessId).sort((a,b)=>b.version-a.version)[0]:null;
  if(p.proposalId?(previous?.version!==p.expectedVersion):p.expectedVersion!==0)return rejected();
  const n=state.knowledge.proposals.length,proposalId=p.proposalId??knowledgeId('proposal',9,n),version=(previous?.version??0)+1;
  const row={id:knowledgeId('version',9,n),businessId,proposalId,version,title:p.title,lesson:p.lesson,scope:p.scope,limitations:[...p.limitations],artifactIds:[...p.artifactIds],status:'proposed',createdAt:time,reviewId:null,reviewReason:null,evidenceHash:knowledgeHash(JSON.stringify(p))};
  state.knowledge.proposals.push(row);result={businessId,id:row.id,proposalId,version,status:'proposed'};
 }else{
  if(!exactKeys(p,[operation==='apply'?'releaseId':operation==='rollback'?'applicationId':'packKey','expectedApplicationId','reason'])||typeof p.reason!=='string'||p.reason.length<10)return rejected();
  const target=operation==='rollback'?state.knowledge.applications.find(a=>a.id===p.applicationId&&a.businessId===businessId):null;
  const release=operation==='remove'?null:state.knowledge.releases.find(r=>r.id===(operation==='rollback'?target?.releaseId:p.releaseId));
  const packKey=release?.packKey??p.packKey,current=state.knowledge.applications.find(a=>a.businessId===businessId&&a.packKey===packKey&&a.isCurrent);
  if((current?.id??null)!==p.expectedApplicationId||operation==='remove'&&!current||operation==='rollback'&&!target||operation!=='remove'&&(!release||release.status!=='current'))return rejected();
  const row={id:knowledgeId('application',9,state.knowledge.applications.length),businessId,packKey,releaseId:release?.id??null,version:release?.version??null,installationId:release?knowledgeId('installation',9,state.knowledge.applications.length):null,operation,previousApplicationId:current?.id??null,reason:p.reason,isCurrent:true,releaseStatus:release?.status??null,status:operation==='remove'?'removed':'applied',createdAt:time,application:null};
  if(current){current.isCurrent=false;current.status='superseded';}
  state.knowledge.applications.push(row);result=row;
 }
 state.knowledge.submissions.set(key,{encoded,result:structuredClone(result)});
 effects.push({kind:'in-memory-knowledge',business:businessId,operation,id:result.id});
 return success(result);
}

export function knowledgeSeed(state){
 const proposals=[],applications=[],usage=[],releases=[];
 for(let n=0;n<127;n++){
  const sameModule=n<4,version=sameModule?`${n+1}.0.0`:'1.0.0',packKey=sameModule?knowledgePackKey:`knowledge.fixture.reference-${n}`;
  releases.push({id:knowledgeId('release',0,n),packKey,version,title:n===1?'Reviewed source comparison guidance':`Reviewed reference guidance ${n}`,status:n===2?'expired':n===3?'withdrawn':'current',content:{guidance:'Compare independent attributable public sources and retain disagreement before a bounded conclusion.',scope:'Synthetic public source comparison; information only',limitations:['This is a dated snapshot, not continuously updated policy.','No account access, rules, budgets, authorization or qualification transfers.'],conflicts:['A conflicting source narrowed the supported scope to public reference material.'],generalizability:'Independent synthetic cases retained the same bounded result after private identifiers were removed.'},sources:[{url:'https://example.invalid/public-source',title:'Synthetic public source snapshot',verifiedAt:'2026-10-01T00:00:00Z',expiresAt:n===2?'2026-10-02T00:00:00Z':'2099-01-01T00:00:00Z',contentHash:knowledgeHash('public-source-'+n),stance:'supports'},{url:'https://example.invalid/public-counterexample',title:'Synthetic conflicting public source',verifiedAt:'2026-10-01T00:00:00Z',expiresAt:'2099-01-01T00:00:00Z',contentHash:knowledgeHash('public-counterexample-'+n),stance:'contradicts'}],reviewerIdentity:'fixture-platform-reviewer',reviewerFingerprint:knowledgeHash('fixture-platform-reviewer'),manifestHash:knowledgeHash('manifest-'+n),contentHash:knowledgeHash('guidance-'+n),reviewedAt:'2026-10-02T00:00:00Z',expiresAt:n===2?'2026-10-02T00:00:00Z':'2099-01-01T00:00:00Z',supersedesReleaseId:n>0&&n<4?knowledgeId('release',0,n-1):null,supersessionReason:n===3?'Withdrawn after contradictory source invalidated the supported scope.':n>0&&n<4?'Independent review narrowed source comparison limitations.':null,application:null});
 }
 for(let b=0;b<3;b++){
  const businessId=b<2?state.businesses[b].id:id(999999);
  for(let n=0;n<127;n++){
   const artifactId=knowledgeId('artifact',b,n);
   if(!state.db.artifacts.some(row=>row.id===artifactId))state.db.artifacts.push({id:artifactId,business_id:businessId,workflow_run_id:b===0?id(1001):null,artifact_type:'knowledge.fixture.private',name:`Private synthetic evidence ${b}:${n}`,media_type:'application/json',storage_path:null,checksum:knowledgeHash(`artifact-${b}-${n}`),metadata:{},content:{marker:b===2?'FOREIGN_OWNER_EVIDENCE_MUST_NOT_LEAK':`PRIVATE_BUSINESS_EVIDENCE_${b}_${n}`},created_at:time,updated_at:time});
   proposals.push({id:knowledgeId('version',b,n),businessId,proposalId:knowledgeId('proposal',b,n),version:1,title:n===0?'Rejected redaction preserves this private evidence':`Provisional private lesson ${b}:${n}`,lesson:n===0?'Redaction removed the necessary proof. This private local result is not qualified reusable guidance.':`A provisional private synthetic observation ${b}:${n}; independent evidence is still needed.`,scope:'Only the source Business synthetic experiment',limitations:['Local success does not establish generalizability.'],artifactIds:[artifactId],evidenceHash:knowledgeHash(`evidence-${b}-${n}`),status:n===0?'rejected':n===1?'needs_evidence':'proposed',reviewId:n<2?knowledgeId('review',b,n):null,reviewReason:n===0?'Rejected redaction: removing private tenant context removes necessary proof; keep private and unqualified.':n===1?'Contradictory sources require independent evidence before promotion.':null,createdAt:time});
   const release=releases[n],packKey=release.packKey;
   applications.push({id:knowledgeId('application',b,n),businessId,packKey,releaseId:release.id,version:release.version,installationId:knowledgeId('installation',b,n),operation:'apply',previousApplicationId:null,reason:n===0?'Historical pins remain exact while future Business selections can change.':`Exact private Business ${b} selection ${n}`,isCurrent:n===0||n>=4,status:n===0||n>=4?'applied':n===1?'superseded':release.status,createdAt:time,application:null});
   const original=releases[n===1?1:0];
   usage.push({id:knowledgeId('usage',b,n),businessId,goalId:id(820000+b*1000),planId:knowledgeId('usage',b,n),planVersion:n+1,runs:b===0&&n===0?[{workflowRunId:id(1001),taskContractId:null}]:[],knowledge:[{applicationId:knowledgeId('application',b,n===1?1:0),applicationReason:'Historical pins remain exact while future Business selections can change.',releaseId:original.id,installationId:knowledgeId('installation',b,n===1?1:0),packKey:original.packKey,packVersion:original.version,knowledgeKey:'fixture.source-comparison',knowledgeVersion:original.version,manifestHash:original.manifestHash,contentHash:original.contentHash,verifiedAt:original.sources[0].verifiedAt,expiresAt:original.expiresAt,content:structuredClone(original.content),sources:structuredClone(original.sources),reviewerIdentity:original.reviewerIdentity,reviewerFingerprint:original.reviewerFingerprint,currentStatus:original.status}],createdAt:time});
  }
 }
 return {proposals,releases,applications,usage,submissions:new Map()};
}
