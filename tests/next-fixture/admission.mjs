// Isolated, in-memory owner controls. Never seeds authority or calls a provider.
export function admissionFixture(state,args,id,mode='normal') {
 if(mode==='unavailable'||!state.businesses.some(b=>b.id===args.p_business_id))return{data:null,error:{message:'Inert exact controls unavailable'}};
 state.admission??={policies:[],pause:new Map(),submissions:new Map()};
 const a=state.admission,b=args.p_business_id;
 if(args.p_policy_id&&!a.policies.some(p=>p.business===b&&p.id===args.p_policy_id))return{data:null,error:{message:'Exact policy unavailable'}};
 const operation={operationKey:'research.model',installationId:id(940001),workflowDefinitionId:id(940002),purpose:'inert_test_only',provider:'openrouter',category:'model',accountId:null,accountRevision:null,sourceDomains:[],dataClasses:['business_context','public_evidence'],maximumPerOperationMicrounits:'1000',providerModelId:'inert/no-provider',maximumOutputTokens:1500,maximumRequestBytes:10000,validUntil:'2027-01-02T00:00:00Z'};
 return{data:{authorityRootId:b,financialMode:'bounded_model_cost_only',serverAuthorityConfigured:false,unavailableReason:mode==='empty'?'No qualified operation is installed.':null,eligibleOperations:mode==='empty'?[]:[operation],capVersions:[],pauseStates:[...a.pause.values()].filter(p=>p.business===b).map(({business,...p})=>p),pauseStatesComplete:true,policies:a.policies.filter(p=>p.business===b&&(!args.p_policy_id||p.id===args.p_policy_id)).slice(args.p_offset,args.p_offset+args.p_limit),exposure:[{currency:'USD',category:'model',heldMicrounits:'0',hasUnknown:false}],decisions:[],limit:args.p_limit,offset:args.p_offset,businessPaused:a.pause.get(`${b}:business:${b}`)?.paused??false},error:null};
}
export function saveAdmissionFixture(state,args,id,effects,mode){
 if(mode!=='success')return{data:null,error:{message:'Inert private stale policy diagnostic'}};
 if(!state.businesses.some(b=>b.id===args.p_business_id))return{data:null,error:{message:'Exact owner unavailable'}};
 admissionFixture(state,{...args,p_limit:20,p_offset:0},id);
 const a=state.admission,key=`${args.p_business_id}:${args.p_submission_id}`,encoded=JSON.stringify([args.p_operation,args.p_payload]);
 if(a.submissions.has(key))return a.submissions.get(key)===encoded?{data:{replayed:true},error:null}:{data:null,error:{message:'Identity conflict'}};
 const p=args.p_payload,b=args.p_business_id;
 if(args.p_operation==='propose'){
  const quest=state.quests.rows.find(q=>q.businessId===b&&q.id===p.goalId&&q.revision===p.goalRevision);
  if(!quest)return{data:null,error:{message:'Exact Quest unavailable'}};
  a.policies.unshift({business:b,id:id(950000+a.policies.length),hash:'a'.repeat(64),policy:structuredClone(p),confirmed:false,revoked:false});
 }else if(['confirm','revoke'].includes(args.p_operation)){
  const policy=a.policies.find(x=>x.business===b&&x.id===p.policyId&&x.hash===p.policyHash);
  if(!policy||policy.revoked)return{data:null,error:{message:'Exact policy unavailable'}};
  policy[args.p_operation==='confirm'?'confirmed':'revoked']=true;
 }else if(['pause','resume'].includes(args.p_operation)&&((p.kind==='business'&&p.id===b)||(p.kind==='quest'&&state.quests.rows.some(q=>q.businessId===b&&q.id===p.id))))a.pause.set(`${b}:${p.kind}:${p.id}`,{business:b,...p,paused:args.p_operation==='pause'});
 else return{data:null,error:{message:'Unreviewed fixture operation'}};
 a.submissions.set(key,encoded);effects.push({kind:'in-memory-admission',operation:args.p_operation,business:b});return{data:{saved:true},error:null};
}
