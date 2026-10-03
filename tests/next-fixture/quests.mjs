// Inert R04 transport only. Production loaders/actions remain unchanged; no database is connected.
export const questIntent='Target 10 units; budget USD 0; deadline: 2027-12-31T23:59:00Z; geography: New Zealand; scope: shirts; stop if costs rise.';
export function questFixture(businesses,id,time) {
  const rows=businesses.flatMap((business,b)=>Array.from({length:127},(_,n)=>({
    id:id(820000+b*1000+n),businessId:business.id,revision:2,
    title:n===0?'Exact original Quest outside the newest page':`Saved Quest ${n} with duplicate long Business context and a deliberately descriptive objective`,
    preference:'ready',createdAt:time,updatedAt:time,hash:'inert-quest-hash',
    content:{title:n===0?'Exact original Quest outside the newest page':`Saved Quest ${n} with duplicate long Business context and a deliberately descriptive objective`,originalIntent:n===1?questIntent.replace('budget USD 0','budget USD 1'):questIntent,objective:n===1?questIntent.replace('budget USD 0','budget USD 1'):questIntent,parsed:{target:{amount:'10',currency:null,metric:'units'},budget:{amount:n===1?'1':'0',currency:'USD'},deadline:{date:'2027-12-31',time:'23:59:00',timezone:'UTC'},geography:['NZ'],scope:'shirts',stopConstraints:['stop if costs rise']},ambiguities:[]},
    proposals:n===0?[{id:id(825000+b),goalId:id(820000+b*1000),goalRevision:2,businessRevision:1,hash:'inert-proposal-hash',createdAt:time,confirmation:null,revoked:false,effective:false,status:'proposed',envelope:{purposes:['Plan original shirts without external effects'],operations:['Research planning'],accounts:[],packs:[],dataSharing:['none'],limits:[{category:'research',currency:'USD',maximum:'0'}],startsAt:'2027-01-01T00:00:00Z',expiresAt:'2027-01-02T00:00:00Z',stopRules:['Stop at zero spending cap']}}]:[],
  })));
  return {rows,submissions:new Map()};
}
export function readQuestFixture(state,args,mode='normal') {
  const businessId=args.p_business_id;
  if(!state.businesses.some(b=>b.id===businessId)||mode==='unavailable')return {data:null,error:{message:'Inert exact Quest unavailable'}};
  const all=mode==='empty'?[]:state.quests.rows.filter(row=>row.businessId===businessId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
  const selected=args.p_goal_id?all.find(row=>row.id===args.p_goal_id):all[0]??null;
  if(args.p_goal_id&&!selected)return {data:null,error:{message:'Inert exact Quest unavailable'}};
  const limit=args.p_limit,offset=args.p_offset;
  if(!Number.isInteger(limit)||limit<1||limit>50||!Number.isInteger(offset)||offset<0)return {data:null,error:{message:'Inert invalid page'}};
  return {data:{executionAvailable:false,executionBlockedReason:'r05_admission_required',businessId,
    business:{revision:1,content:{brandContext:'Synthetic original shirts',operatingRules:'Review exact versions',allowedActivity:'Research planning',restrictions:'No spending or dispatch'},preference:'setup',currentGoalId:null},
    quests:all.slice(offset,offset+limit).map(({id,businessId,revision,title,preference,createdAt,updatedAt})=>({id,businessId,revision,title,preference,createdAt,updatedAt})),total:all.length,limit,offset,selection:args.p_goal_id?'explicit':selected?'last':'none',selected,
    proposalsComplete:true,references:{accounts:[],packs:[],accountsComplete:true,packsComplete:true}},error:null};
}
export function saveQuestFixture(state,args,effects,id,time,mode) {
  if(mode!=='success')return {data:null,error:{message:'Inert request outcome unavailable'}};
  if(!state.businesses.some(b=>b.id===args.p_business_id)||args.p_operation!=='quest.save'||args.p_payload?.goalId!==null||args.p_payload.expectedRevision!==0)return null;
  const key=`${args.p_business_id}:${args.p_submission_id}`,request=JSON.stringify(args.p_payload),previous=state.quests.submissions.get(key);
  if(previous)return previous.request===request?{data:{...previous.result,replayed:true},error:null}:{data:null,error:{message:'Inert idempotency conflict'}};
  const content=args.p_payload.content;
  if(!content?.title||!content.originalIntent)return {data:null,error:{message:'Inert invalid content'}};
  const questId=id(829000+state.quests.submissions.size),result={operation:'quest.save',id:questId,revision:1,replayed:false,executionAvailable:false,executionBlockedReason:'r05_admission_required'};
  state.quests.rows.push({id:questId,businessId:args.p_business_id,revision:1,title:content.title,preference:'draft',createdAt:time,updatedAt:time,hash:'inert-new-quest-hash',content,proposals:[]});
  state.quests.submissions.set(key,{request,result});effects.push({kind:'in-memory-quest',id:questId,business:args.p_business_id});
  return {data:result,error:null};
}
