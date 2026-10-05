// Pure R06 read transport. These synthetic records never enter a database/provider.
// Ordering/filter/selection mirror r06_read; this does not qualify SQL/RLS itself.
const stamp = '2026-10-02T04:10:20.123456+00:00';
const future = '2099-12-31T23:59:59Z';
const datasets = ['account_runs','account_health','etsy_runs','publication_runs','publication_drafts','printful_runs','printful_sources','listing_runs','listing_qualifications','etsy_packages','listing_sources'];
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const historyId = (dataset,b=0,n=0) => uuid(1000000+b*100000+datasets.indexOf(dataset)*1000+n);
export const interventionId = (dataset,b=0) => uuid(1930000+b*100+(dataset==='publication_runs'?0:1));
export const candidateId = (b=0,n=0) => uuid(1500000+b*10000+n);
export const decisionId = (b=0,n=0) => uuid(1600000+b*10000+n);
export const experimentId = (b=0,n=0) => uuid(1700000+b*10000+n);
const newest = (a,b) => String(b.createdAt??b.created_at).localeCompare(String(a.createdAt??a.created_at)) || b.id.localeCompare(a.id);
const hash = 'a'.repeat(64);
const uuidPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const statuses=new Set('all candidate open pending_approval approved preparation_started owner_handoff expired verified queued running completed passed failed cancelled needs_owner blocked unknown prepared stopped invalidated ready rejected needs_evidence profile_saved request_prepared request_approved request_expired connection_verified connection_revoked password_saved password_deleted TEST REJECT NEEDS_MORE_EVIDENCE unassessed reserved researching'.split(' '));
const wrap = (item,businessId,n,label,status,goalId=null) => ({id:item.id,businessId,createdAt:stamp,label,status,goalId,item});

export function historyFixture(db,businesses,enabled=false) {
  const rows = Object.fromEntries(datasets.map(name=>[name,[]]));
  if (!enabled) {
    for (const [dataset,item] of [
      ['etsy_runs',{id:uuid(750000),title:'Saved failed draft with unknown outcome',status:'needs_owner',reason:'uncertain_image_identity',listingId:null,approvedAt:stamp,stopped:false}],
      ['printful_runs',{id:uuid(740000),name:'Saved uncertain product configuration',status:'needs_owner',reason:'product_creation_uncertain',dispatchSent:true,receiptRecorded:false,stopRequested:false,syncProductId:null,syncVariantId:null}],
      ['publication_runs',{id:uuid(760000),title:'Saved uncertain listing activation',status:'needs_owner',providerState:'unknown',reason:'unknown_activation',activationSent:true,listingId:null}],
    ]) for(const business of businesses) rows[dataset].push(wrap(item,business.id,0,item.title??item.name,item.status));
    return {rows,enabled};
  }
  for (const [b,business] of businesses.slice(0,2).entries()) {
    for(let n=0;n<127;n++) {
      const add=(dataset,item,label=item.title??item.name??dataset,status=item.status??'candidate')=>rows[dataset].push(wrap(item,business.id,n,label,status,dataset.startsWith('account_')?null:uuid(820000+b*1000+n%2)));
      const provider=n%2?'etsy':'printful';
      add('account_runs',{id:historyId('account_runs',b,n),businessId:business.id,connectionId:uuid(1800000+b),provider,mode:'connect',status:n<61?'pending_approval':'completed',revision:1,disclosureHash:hash,createdAt:stamp,approvalExpiresAt:future,receipt:null,disclosure:{provider,mode:'connect',profileRevision:uuid(1800100+b),profileFields:[],disclosedData:{},destination:`https://www.${provider}.com`,termsUrl:`https://www.${provider}.com`,privacyUrl:`https://www.${provider}.com`,purpose:`Saved exact ${provider} request ${n} for Business ${b+1}`,scopes:['catalog.read'],cost:{amountMinor:0,currency:null,subscription:false},termsAcknowledgementRequired:false,secureOwnerSteps:['access_grant'],browserProcessing:null}},provider,n<61?'pending_approval':'completed');
      add('account_health',{id:historyId('account_health',b,n),provider,runId:historyId('account_runs',b,n),eventType:'request_prepared',summary:`Saved health ${n}`,occurredAt:stamp},provider,'request_prepared');
      add('etsy_runs',{id:historyId('etsy_runs',b,n),title:`R06 Business ${b+1} draft ${n}`,status:n%2?'failed':'needs_owner',reason:'uncertain_image_identity',listingId:null,approvedAt:stamp,stopped:false});
      add('publication_runs',{id:historyId('publication_runs',b,n),title:`R06 Business ${b+1} publication ${n}`,status:'needs_owner',providerState:'unknown',reason:'unknown_activation',activationSent:true,listingId:null,stopRequested:false});
      add('publication_drafts',{id:historyId('publication_drafts',b,n),title:`R06 Business ${b+1} verified draft ${n}`,packageArtifactId:uuid(1810000+b*1000+n),packageHash:hash,listingId:100+n,shopId:200+b,quantity:1,priceMinor:2500,currency:'USD',verifiedAt:stamp},`R06 Business ${b+1} verified draft ${n}`,'verified');
      add('printful_runs',{id:historyId('printful_runs',b,n),name:`R06 Business ${b+1} configuration ${n}`,status:'needs_owner',reason:'product_creation_uncertain',stopRequested:false,dispatchSent:true,receiptRecorded:false,syncProductId:null,syncVariantId:null});
      add('printful_sources',{id:historyId('printful_sources',b,n),name:`R06 Business ${b+1} product source ${n}`,sourceHash:hash,storeId:300+b,catalogProductId:71,catalogVariantId:4011,placement:'front',designWidthIn:10,designHeightIn:12,retailPrice:'25.00',currency:'USD',assetSha256:hash,expiresAt:future});
      add('listing_runs',{id:historyId('listing_runs',b,n),workflowRunId:uuid(1900000+b*1000+n),sourceArtifactId:uuid(1910000+b*1000+n),outputArtifactId:null,status:'failed',phase:'specialist',reason:'saved_uncertain_charge',maximumMicrousd:500000,createdAt:stamp,expiresAt:stamp,costs:[{role:'specialist',reservedMicrousd:250000,reportedMicrousd:null,settled:true}],proposal:null,review:null},'Listing preparation','failed');
      add('listing_qualifications',{id:historyId('listing_qualifications',b,n),workflowRunId:uuid(1920000+b*1000+n),status:'failed',reason:'saved_unknown_charge',maximumMicrousd:500000,createdAt:stamp,expiresAt:stamp,costs:[{caseKey:'saved_uncertain_charge',reservedMicrousd:250000,reportedMicrousd:null,settled:true}]},'Listing qualification','failed');
      for(const dataset of ['etsy_packages','listing_sources'])add(dataset,{id:historyId(dataset,b,n),name:`R06 Business ${b+1} ${dataset} ${n}`,createdAt:stamp});
    }
  }
  // Exact intervention joins keep Business, intent, operation and capability bound.
  for(const [b,business] of businesses.slice(0,2).entries())for(const dataset of ['publication_runs','printful_runs']){
    const intent=uuid(1940000+b*100+(dataset==='publication_runs'?0:1));
    const publication=dataset==='publication_runs';
    const run=rows[dataset].find(r=>r.businessId===business.id&&r.id===historyId(dataset,b));run.actionIntentId=intent;
    db.action_intents.push({id:intent,business_id:business.id,action_type:publication?'etsy.publication.activate':'printful.product.configure',capability:publication?'marketplace.etsy.publish':'product.printful.configure'});
    db.owner_interventions.push({id:interventionId(dataset,b),business_id:business.id,action_intent_id:intent,workflow_run_id:null,intervention_type:publication?'etsy.publication.reconcile':'printful.product.reconcile',status:'open',title:'Saved exact historical provider uncertainty',description:'Synthetic read-only historical acceptance',options:{},resolution:{},requested_at:stamp,resolved_at:null,created_at:stamp,updated_at:stamp});
  }
  // Latest-per-candidate evidence is older than unrelated candidate/experiment rows,
  // with equal timestamps resolved by exact UUID. Candidate 0 has >125 decisions.
  db.product_candidates=[];db.product_decisions=[];
  for(const [b,business] of businesses.slice(0,2).entries())for(let n=0;n<127;n++) {
    db.product_candidates.push({id:candidateId(b,n),business_id:business.id,fingerprint:`r06-${b}-${n}`,concept:`R06 Business ${b+1} candidate ${n}`,audience:'Synthetic adult hikers',hypothesis:'Saved original synthetic research hypothesis',product_type:'original_pod_tshirt',original_design:true,rights_status:'unclear',source_domains:['example.invalid'],created_at:stamp});
    db.product_experiments.push({id:experimentId(b,n),business_id:business.id,candidate_id:candidateId(b,n),workflow_run_id:uuid(1001),parent_discovery_id:null,discovery_version:'r06-inert-history',fingerprint:`r06-experiment-${b}-${n}`,hypothesis:`R06 candidate ${n} experiment`,variables:{},audience:'Synthetic adult hikers',creative:null,price:null,channel:'research_only',status:n%2?'failed':'completed',measurement_plan:{version:'r06-inert-history'},evidence_pack:null,source_artifact_id:null,basis_artifact_id:null,failure:n%2?'Preserved failure':null,started_at:stamp,completed_at:stamp,created_at:stamp});
    db.product_decisions.push({id:decisionId(b,n+200),business_id:business.id,candidate_id:candidateId(b,n),experiment_id:experimentId(b,n),assessment:{version:'r06-inert-history',outcome:n===0?'REJECT':'TEST',reason:n===0?'Exact newest rejection survives off-page selection':'Saved proposal, no execution authority'},created_at:stamp});
    if(n===0)for(let old=0;old<127;old++)db.product_decisions.push({id:decisionId(b,old),business_id:business.id,candidate_id:candidateId(b,0),experiment_id:experimentId(b,0),assessment:{version:'r06-inert-history',outcome:'TEST',reason:'Superseded historical proposal'},created_at:stamp});
  }
  return {rows,enabled};
}

export function readHistoryFixture(state,args,mode='normal') {
  const {p_business_id:businessId,p_dataset:dataset,p_query:q={}}=args;
  const fail=message=>({data:null,error:{message}});
  const owned=new Set(state.businesses.map(b=>b.id));
  if(businessId!==null&&!owned.has(businessId))return fail('Inert owner scope rejected');
  if(mode==='unavailable')return fail('Inert historical read unavailable');
  if(!q||Array.isArray(q)||typeof q!=='object'||Buffer.byteLength(JSON.stringify(q))>2048||Object.keys(q).some(k=>!['limit','offset','query','status','selectedId','interventionId','goalId','candidateId','workflowRunId'].includes(k)))throw Error('Unreviewed R06 query');
  if(['account_state','etsy_state','listing_state'].includes(dataset)) {
    if(!businessId||Object.keys(q).length)throw Error('Invalid state read');
    if(dataset==='etsy_state')return {data:{connection:mode==='r11-connected'?{id:'11000000-0000-4000-8000-000000000003',shopName:'Saved exact shop with a long original name retained across Business navigation',status:'connected',currency:'NZD'}:null},error:null};
    if(dataset==='listing_state')return {data:{qualified:false,activeQualification:false},error:null};
    const current=mode==='empty'?[]:state.history.rows.account_runs.filter(r=>r.businessId===businessId).sort(newest);
    return {data:{observedAt:stamp,profile:null,accounts:[],currentRuns:['etsy','printful'].flatMap(provider=>current.find(r=>r.item.provider===provider)?.item??[])},error:null};
  }
  const {limit=25,offset=0,query='',status='all',selectedId}=q;
  if(!Number.isSafeInteger(limit)||limit<1||limit>25||!Number.isSafeInteger(offset)||offset<0||offset>249999||typeof query!=='string'||query.length>120)throw Error('Invalid R06 bounds');
  if(!statuses.has(status))throw Error('Invalid R06 status');
  for(const key of ['selectedId','interventionId','goalId','candidateId','workflowRunId'])if(q[key]!==undefined&&(typeof q[key]!=='string'||(q[key]!==''&&!uuidPattern.test(q[key]))))throw Error('Invalid R06 exact identity');
  if((q.candidateId||q.workflowRunId)&&!['product_candidates','production_candidates','product_experiments','product_decisions'].includes(dataset))throw Error('Invalid R06 related filter');
  let rows;
  if(['product_candidates','production_candidates'].includes(dataset)) {
    rows=state.db.product_candidates.map(candidate=>{
      const decisions=(state.db.product_decisions??[]).filter(d=>d.candidate_id===candidate.id&&d.business_id===candidate.business_id).sort(newest).slice(0,2);
      const related=state.db.product_experiments.filter(e=>e.candidate_id===candidate.id&&e.business_id===candidate.business_id).sort(newest).slice(0,2);
      const ids=new Set([...related.map(e=>e.id),...decisions.map(d=>d.experiment_id)]);
      const experiments=state.db.product_experiments.filter(e=>e.business_id===candidate.business_id&&(ids.has(e.id)||decisions.some(d=>state.db.product_experiments.find(e0=>e0.id===d.experiment_id)?.parent_discovery_id===e.id)));
      const goalId=state.db.workflow_runs.find(w=>w.id===related[0]?.workflow_run_id&&w.business_id===candidate.business_id)?.goal_id??null;
      return {id:candidate.id,businessId:candidate.business_id,createdAt:candidate.created_at,label:candidate.concept,status:decisions[0]?.assessment?.outcome??'unassessed',goalId,item:{id:candidate.id,candidate,decisions,experiments}};
    }).filter(r=>(dataset!=='production_candidates'||r.status==='TEST')&&(!q.candidateId||r.id===q.candidateId)&&(!q.workflowRunId||state.db.product_experiments.some(e=>e.candidate_id===r.id&&e.business_id===r.businessId&&e.workflow_run_id===q.workflowRunId)));
  }else if(['product_experiments','product_decisions'].includes(dataset)) {
    rows=(state.db[dataset]??[]).filter(r=>(!q.candidateId||r.candidate_id===q.candidateId)&&(!q.workflowRunId||(dataset==='product_experiments'?r.workflow_run_id:state.db.product_experiments.find(e=>e.id===r.experiment_id)?.workflow_run_id)===q.workflowRunId)).map(item=>{
      const experiment=dataset==='product_experiments'?item:state.db.product_experiments.find(e=>e.id===item.experiment_id&&e.business_id===item.business_id);
      const workflow=state.db.workflow_runs.find(w=>w.id===experiment?.workflow_run_id&&w.business_id===item.business_id);
      return {id:item.id,businessId:item.business_id,createdAt:item.created_at,label:dataset==='product_experiments'?item.hypothesis:state.db.product_candidates.find(c=>c.id===item.candidate_id)?.concept??'',status:dataset==='product_experiments'?item.status:item.assessment?.outcome,goalId:workflow?.goal_id??null,item};
    });
  }else if(dataset==='account_unresolved')rows=state.history.rows.account_runs.filter(r=>['pending_approval','approved','preparation_started','owner_handoff'].includes(r.status)&&(!r.item.approvalExpiresAt||r.item.approvalExpiresAt>stamp));
  else if(Object.hasOwn(state.history.rows,dataset))rows=state.history.rows[dataset];
  else throw Error('Unreviewed R06 dataset');
  if(!businessId&&!['account_unresolved','product_candidates','production_candidates','product_experiments','product_decisions'].includes(dataset))return fail('Inert Business required');
  if(q.goalId&&(!businessId||dataset.startsWith('account_')||!state.quests.rows.some(g=>g.id===q.goalId&&g.businessId===businessId)))return fail('Inert Quest scope rejected');
  const ownerTotal=dataset==='account_unresolved'?(mode==='empty'?0:rows.filter(r=>owned.has(r.businessId)).length):null;
  rows=mode==='empty'?[]:rows.filter(r=>owned.has(r.businessId)&&(!businessId||r.businessId===businessId)&&(!q.goalId||r.goalId===q.goalId)).sort(newest);
  let exactId=selectedId;
  if(q.interventionId){
    const request=state.db.owner_interventions.find(i=>i.id===q.interventionId&&i.business_id===businessId);
    const expected=dataset==='publication_runs'?'etsy.publication.reconcile':dataset==='printful_runs'?'printful.product.reconcile':null;
    const intent=state.db.action_intents.find(i=>i.id===request?.action_intent_id&&i.business_id===businessId);
    const operation=dataset==='publication_runs'?'etsy.publication.activate':'printful.product.configure';
    const target=request?.intervention_type===expected&&intent?.action_type===operation&&(dataset!=='publication_runs'||intent.capability==='marketplace.etsy.publish')?rows.find(r=>r.actionIntentId===intent.id)?.id:null;
    if(!target||(exactId&&target!==exactId))return fail('Inert exact intervention unavailable');
    exactId=target;
  }
  const selected=exactId?rows.find(r=>r.id===exactId)?.item??null:null;
  const filtered=rows.filter(r=>(!query||String(r.label).toLowerCase().includes(query.toLowerCase()))&&(status==='all'||r.status===status));
  const items=filtered.slice(offset,offset+limit).map(r=>r.item);
  return {data:{ownerTotal,items,total:filtered.length,limit,offset,hasNext:offset+items.length<filtered.length,observedAt:stamp,selection:{status:!exactId?'none':selected?'found':'missing',item:selected}},error:null};
}
