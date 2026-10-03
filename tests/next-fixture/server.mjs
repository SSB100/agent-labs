import {workspaceSeed,workspaceView,workspaceRead} from './workspace.mjs';
import { createServer } from 'node:http';
import { fixtureData, id, time } from './data.mjs';
import { readQuestFixture, saveQuestFixture } from './quests.mjs';
import { admissionFixture, saveAdmissionFixture } from './admission.mjs';
import { readHistoryFixture } from './history.mjs';
import { filterFixtureOr } from './query-predicates.mjs';
export async function startFixtureBoundary() {
  let state = fixtureData(), control = { delayId: null, delayMs: 0, failTable: null, actionMode: 'success' };
  const log = [], effects = [], denied = [];
  const valueAt = (row,path) => path.replace(/->>?/g,'.').split('.').reduce((v,k) => v?.[k],row);
  const server = createServer(async(req,res) => {
    try {
    let body='';for await(const chunk of req)body+=chunk;
    const input=body?JSON.parse(body):{};
    const send = data => { res.setHeader('content-type','application/json');res.end(JSON.stringify(data)); };
    if(req.url==='/control'){if(input.workspace===true&&!state.workspace)state.workspace=workspaceSeed(state,id,time);if(typeof input.history==='boolean'&&input.history!==state.history.enabled)state=fixtureData({history:input.history});control={...control,...input};return send({ok:true});}
    if(req.url==='/snapshot')return send({log,effects,denied,control});
    if(req.url==='/reset'){state=fixtureData();log.length=effects.length=denied.length=0;control={delayId:null,delayMs:0,failTable:null,actionMode:'success'};return send({ok:true});}
    if(req.url==='/claims')return send(input.session==='off'?{data:null,error:null}:{data:{claims:{sub:state.owner,email:'inert-owner@example.invalid'}},error:null});
    if(input.session==='off')return send({data:null,error:{code:'42501',message:'inert owner absent'}});
    if(req.url==='/read'){
      const call={...input};log.push(call);
      if(input.table===control.failTable||input.mode==='unavailable')return send({data:null,count:null,error:{message:'Inert unavailable read'}});
      let rows=input.mode==='empty'&&!['businesses','profiles','workflow_definitions','worker_definitions'].includes(input.table)?[]:structuredClone(input.table.startsWith('r08_')?workspaceView(state,input.table):state.db[input.table]??[]),columns='*',settings={},limit=null,range=null,single=false;
      const operations=input.operations??[];
      if(control.delayId && !operations.some(([op,key])=>op==='select'&&key==='business_id') && operations.some(([op,key,val])=>key==='id'&&((op==='eq'&&val===control.delayId)||(op==='in'&&val.includes(control.delayId)))))await new Promise(r=>setTimeout(r,control.delayMs));
      // RLS analogue: rows from a third Business are never exposed, including exact lookups.
      rows=rows.filter(r=>!r.business_id||state.businesses.some(b=>b.id===r.business_id));
      const orders=[];
      for(const [op,key,val] of operations){
        if(op==='select'){columns=key;settings=val??{};}
        else if(op==='eq')rows=rows.filter(r=>valueAt(r,key)===val);
        else if(op==='in')rows=rows.filter(r=>val.includes(valueAt(r,key)));
        else if(op==='is')rows=rows.filter(r=>(valueAt(r,key)??null)===val);
        else if(op==='not')rows=rows.filter(r=>key==='completed_at'?r.completed_at!=null:val==='is'?valueAt(r,key)!=null:valueAt(r,key)!==operations.find(x=>x[0]===op)?.[3]);
        else if(op==='or')rows=filterFixtureOr(rows,input.table,key,operations);
        else if(op==='ilike'){const needle=val.slice(1,-1).replace(/\\([\\%_])/g,'$1').toLowerCase();rows=rows.filter(r=>String(key==='definition.name'?state.db.workflow_definitions.find(d=>d.id===r.workflow_definition_id)?.name:valueAt(r,key)).toLowerCase().includes(needle));}
        else if(op==='order')orders.push([key,val?.ascending]);
        else if(op==='limit')limit=key;
        else if(op==='range')range=[key,val];
        else if(op==='maybeSingle'||op==='single')single=true;
        else {denied.push({kind:'query',op});return send({data:null,count:null,error:{message:'Denied query operation'}});}
      }
      rows.sort((a,b)=>{for(const [key,asc]of orders){const n=String(valueAt(a,key)??'').localeCompare(String(valueAt(b,key)??''));if(n)return asc?n:-n;}return 0;});
      const count=rows.length;if(range)rows=rows.slice(range[0],range[1]+1);if(limit!=null)rows=rows.slice(0,limit);
      const fields=columns.split(/,(?![^()]*\))/).map(field=>field.trim());
      if(columns!=='*')rows=rows.map(row=>Object.fromEntries(fields.map(field=>{if(field.startsWith('definition:'))return ['definition',{name:state.db.workflow_definitions.find(d=>d.id===row.workflow_definition_id)?.name}];const split=field.indexOf(':');const key=split>=0?field.slice(0,split):field,path=split>=0?field.slice(split+1):field;return [key,valueAt(row,path)??null];})));
      call.returned=rows.length;call.count=count;
      return send({data:settings.head?null:single?rows[0]??null:rows,count:settings.count==='exact'?count:null,error:single&&rows.length>1?{message:'Ambiguous fixture selection'}:null});
    }
    if(req.url==='/rpc'){
      const {name,args}=input;const business=args.p_business_id;
      if(['r07_quest_read','r08_owner_read'].includes(name)){log.push({rpc:name,business,goal:args.p_goal_id,dataset:args.p_dataset,query:args.p_query});return send(workspaceRead(state,name,args,id,control.failDataset&&control.failDataset===args.p_dataset?'unavailable':input.mode));}
      if(name==='r06_read'){
        const call={rpc:name,business,dataset:args.p_dataset,query:args.p_query};log.push(call);
        const response=readHistoryFixture(state,args,control.failDataset===args.p_dataset?'unavailable':input.mode);
        if(control.shortDataset===args.p_dataset&&response.data?.items?.length)response.data.items.pop();
        call.returned=response.data?.items?.length;call.total=response.data?.total;call.ids=response.data?.items?.map(r=>r.id??r.candidate?.id);call.selection=response.data?.selection?.status;call.selectedId=response.data?.selection?.item?.id??response.data?.selection?.item?.candidate?.id;
        return send(response);
      }
      if(name==='r05_admission_read')return send(admissionFixture(state,args,id,input.mode));
      if(name==='r05_policy_owner')return send(saveAdmissionFixture(state,args,id,effects,control.actionMode));
      if(name==='r04_quest_read'){
        log.push({rpc:name,business,goal:args.p_goal_id,limit:args.p_limit,offset:args.p_offset});
        if(control.delayId===args.p_goal_id)await new Promise(resolve=>setTimeout(resolve,control.delayMs));
        return send(readQuestFixture(state,args,input.mode));
      }
      if(name==='r04_quest_transition'){
        const response=saveQuestFixture(state,args,effects,id,time,control.actionMode);
        if(response)return send(response);
      }
      if(name==='create_product_candidate'&&state.businesses.some(b=>b.id===business)){
        if(control.actionMode==='uncertain')return send({data:null,error:null});
        if(control.actionMode==='conflict')return send({data:null,error:{message:'inert private error must never appear'}});
        const c=args.p_candidate;
        const existing=state.db.product_candidates.find(r=>r.business_id===business&&r.concept===c.concept&&r.audience===c.audience&&r.hypothesis===c.hypothesis);
        if(existing)return send({data:{candidateId:existing.id,cached:true},error:null});
        const candidate={id:id(900000+state.db.product_candidates.length),business_id:business,concept:c.concept,audience:c.audience,hypothesis:c.hypothesis,original_design:c.originalDesign,rights_status:c.rightsStatus,source_domains:c.sourceDomains,created_at:time,updated_at:time};
        state.db.product_candidates.push(candidate);effects.push({kind:'in-memory-candidate',id:candidate.id,business});
        return send({data:{candidateId:candidate.id,cached:false},error:null});
      }
      if(args.p_operation==='workspace'&&state.businesses.some(b=>b.id===business)){
        log.push({rpc:name,business});
        if(name==='account_owner_transition')return send({data:{profile:null,accounts:[],runs:[],healthEvents:[]},error:null});
        if(name==='printful_product_owner_transition')return send({data:{sources:[],runs:[{id:id(740000),title:'Saved uncertain product configuration',status:'needs_owner',reason:'product_creation_uncertain',dispatchSent:true,receiptRecorded:false,stopRequested:false}]},error:null});
        if(name==='etsy_owner_transition')return send({data:{connection:null,runs:[{id:id(750000),title:'Saved failed draft with unknown outcome',status:'needs_owner',reason:'uncertain_image_identity',listingId:null,approvedAt:time,stopped:false}]},error:null});
        if(name==='listing_owner_transition')return send({data:{authorityConfigured:false,qualified:false,runs:[],qualificationRuns:[]},error:null});
        if(name==='etsy_publication_owner_transition')return send({data:{drafts:[],runs:[{id:id(760000),title:'Saved uncertain listing activation',status:'needs_owner',providerState:'unknown',reason:'unknown_activation',activationSent:true,listingId:null}]},error:null});
      }
      if(name==='acknowledge_terminal_creative_review'){
        const notice=state.db.owner_interventions.find(n=>n.id===args.p_intervention_id);
        if(!notice)return send({data:null,error:{code:'42501',message:'inert unavailable'}});
        if(control.actionMode==='uncertain')return send({data:null,error:null});
        if(control.actionMode==='conflict')return send({data:null,error:{message:'terminal_review_conflict'}});
        const outcome=notice.status==='resolved'?'already_acknowledged':'acknowledged';
        if(outcome==='acknowledged'){
          if(notice.updated_at!==args.p_expected_updated_at)return send({data:null,error:{message:'terminal_review_conflict'}});
          const creative=state.db.creative_runs.find(r=>r.workflow_run_id===notice.workflow_run_id);
          notice.status='resolved';notice.resolved_at=time;notice.updated_at=time;notice.resolution={version:'terminal-creative-review-acknowledgement-v1',decision:'acknowledge',actorUserId:state.owner,businessId:notice.business_id,workflowRunId:notice.workflow_run_id,creativeRunId:creative.id,interventionId:notice.id,acknowledgedAt:time,expectedUpdatedAt:args.p_expected_updated_at,executionResumed:false,newSpendAuthorized:false,costsReconciled:false};
          effects.push({kind:'in-memory-acknowledgment',id:notice.id});
        }
        return send({data:{outcome,interventionId:notice.id,businessId:notice.business_id,workflowRunId:notice.workflow_run_id},error:null});
      }
      denied.push({kind:'rpc',name,operation:args.p_operation});return send({data:null,error:{message:'R03 fixture denied external/persistent operation',code:'42501'}});
    }
    denied.push({kind:'endpoint',url:req.url});send({error:'Denied'});
    } catch(error) { denied.push({kind:'boundary-error',url:req.url,error:String(error)});res.statusCode=500;res.end(JSON.stringify({data:null,error:{message:'Inert boundary rejected request'}})); }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  return {origin,state:()=>state,log,effects,denied,close:()=>new Promise(resolve=>server.close(resolve))};
}
