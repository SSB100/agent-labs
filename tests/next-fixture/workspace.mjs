/** Independent inert projection transport. Real RLS/SQL is qualified separately. */
export function workspaceSeed(state,id,time){
 const links=new Map(), records={products:[],listings:[],decisions:[]};
 for(const [b,business]of state.businesses.slice(0,2).entries()){
  const goal=id(820000+b*1000),other=id(820001+b*1000),run=state.db.workflow_runs.find(w=>w.business_id===business.id&&w.id===id(1001))??state.db.workflow_runs.find(w=>w.business_id===business.id);
  for(const w of state.db.workflow_runs.filter(w=>w.business_id===business.id))w.goal_id=goal;
  const last=state.db.workflow_runs.filter(w=>w.business_id===business.id).at(-1);if(last)last.goal_id=other;
  const legacy=state.db.product_experiments.find(e=>e.business_id===business.id);if(legacy){const w=state.db.workflow_runs.find(w=>w.id===legacy.workflow_run_id);if(w){w.goal_id=null;links.set(w.id,[goal]);}}
  for(let n=0;n<127;n++){
   const packageId=id(880000+b*1000+n),listingId=id(885000+b*1000+n);
   const product={id:packageId,businessId:business.id,goalId:goal,workflowRunId:run.id,kind:'product_package',title:`Saved package ${n} with exact original image lineage`,at:time,schemaVersion:'1.0',readiness:'unqualified',productIdentity:`inert:${b}:${n}`,listingCount:1,listings:[{id:listingId,listingId:9000+n,status:'verified'}],blockers:['Provider-neutral Product identity not qualified','Exact selling-variant linkage not qualified','Account-specific fees not qualified','Supported fulfilment not qualified']};
   records.products.push(product);records.listings.push({id:listingId,businessId:business.id,goalId:goal,workflowRunId:run.id,kind:'listing',title:`Saved draft ${n}`,at:time,packageArtifactId:packageId,packageHash:'a'.repeat(64),productIdentity:product.productIdentity,connectionId:id(889000+b),connectionRevision:id(889100+b),shopId:1234+b,listingId:9000+n,status:'verified',draftReadback:'Recorded verified draft; historical receipt, not fresh provider readback',feeReady:'unqualified',fulfilmentReady:'unqualified',publicSellingReady:false,supplier:null});
   state.db.artifacts.push({id:packageId,business_id:business.id,workflow_run_id:run.id,task_contract_id:null,artifact_type:'product.package.v1',name:product.title,media_type:'application/json',storage_path:null,created_at:time,updated_at:time,checksum:'a'.repeat(64),metadata:{},content:{version:'1.0',businessId:business.id,goalId:goal,workflowRunId:run.id,productIdentity:product.productIdentity,qualified:false}});
   records.decisions.push({id:`admission:${b*1000+n+1}`,kind:'admission_decision',businessId:business.id,goalId:goal,workflowRunId:run.id,recordId:String(b*1000+n+1),title:n===0?'Blocked original dispatch':'Reserved bounded exposure',status:n===0?'blocked':'reserved',reason:n===0?'Fresh provider eligibility required':'Within reviewed model allowance',actor:'admission controller',at:time});
  }
 }
 for(const i of state.db.owner_interventions){const w=state.db.workflow_runs.find(w=>w.id===i.workflow_run_id&&w.business_id===i.business_id);records.decisions.push({id:`notice:${i.id}`,kind:'owner_notice',businessId:i.business_id,goalId:w?.goal_id??null,workflowRunId:i.workflow_run_id,recordId:i.id,title:i.title,status:i.status,reason:i.description,actor:'owner request',at:i.requested_at,resolution:i.resolution});}
 for(const i of state.db.installed_packs)i.created_at??=time;
 return {links,records};
}
export function workspaceView(state,table){
 const base=table.replace(/^r08_/,'');
 const goal=(business,run)=>{const w=state.db.workflow_runs.find(w=>w.id===run&&w.business_id===business);if(!w)return null;const ids=[...new Set([w.goal_id,...(state.workspace?.links.get(run)??[])].filter(Boolean))];return ids.length===1?ids[0]:null;};
 return (state.db[base]??[]).map(row=>{let run=row.workflow_run_id;if(base==='workflow_runs')run=row.id;if(base==='creative_assets')run=state.db.creative_runs.find(r=>r.id===row.creative_run_id&&r.business_id===row.business_id)?.workflow_run_id;return {...row,quest_id:goal(row.business_id,run)};});
}
export function workspaceRead(state,name,args,id,mode){
 if(mode==='unavailable'||!state.businesses.some(b=>b.id===args.p_business_id)||args.p_goal_id&&!state.quests.rows.some(q=>q.id===args.p_goal_id&&q.businessId===args.p_business_id))return {data:null,error:{message:'Exact scoped read unavailable'}};
 if(name==='r07_quest_read'){
  const first=state.quests.rows.find(q=>q.id===args.p_goal_id),has=state.workspace&&[id(820000),id(821000)].includes(args.p_goal_id);
  const selected=has?{businessId:args.p_business_id,goalId:args.p_goal_id,planId:id(887001),version:1,planHash:'a'.repeat(64),head:{planId:id(887001),state:'needs_owner',reason:'New account scope requires confirmation',dispatches:2},plan:{steps:[{key:'research',objective:'Find attributable source evidence'},{key:'challenge',objective:'Independently challenge the conclusion'}]},attempts:[{id:id(1001),stepKey:'research',attempt:1,status:'completed',reason:'accepted output'},{id:id(1000),stepKey:'challenge',attempt:1,status:'rejected',reason:'insufficient evidence'}],reused:[],targetAchievement:'unverified'}:null;
  return {data:{selected,plans:selected?[{id:selected.planId,version:1}]:[],events:[],eventTotal:0,limit:args.p_limit,offset:args.p_offset},error:first?null:{message:'Quest unavailable'}};
 }
 if(name==='r08_owner_read'){
  const q=args.p_query??{},dataset=args.p_dataset;
  if(!['products','listings','decisions'].includes(dataset))return {data:null,error:{message:'Dataset unavailable'}};
  const all=mode==='empty'?[]:(state.workspace?.records[dataset]??[]).filter(r=>r.businessId===args.p_business_id&&(!args.p_goal_id||r.goalId===args.p_goal_id));
  const filtered=all.filter(r=>(r.title+' '+(r.reason??'')).toLowerCase().includes((q.query??'').toLowerCase())).sort((a,b)=>b.at.localeCompare(a.at)||b.id.localeCompare(a.id));
  const selected=q.selectedId?all.find(r=>r.id===q.selectedId)??null:null;
  const clean=row=>{const result={...row};delete result.goalId;return result;};
  return {data:{businessId:args.p_business_id,goalId:args.p_goal_id,dataset,items:filtered.slice(q.offset,q.offset+q.limit).map(clean),total:filtered.length,limit:q.limit,offset:q.offset,selection:{status:q.selectedId?selected?'found':'missing':'none',item:selected?clean(selected):null}},error:null};
 }
 return null;
}
