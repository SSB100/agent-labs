import {loadR12NextFixture,controlR12,closeR12Fixture,r12OwnerRpc,r12RuntimeRpc,r12Quote,r12Provider} from './r12-sql.mjs';
import {seedResearchFixture,installResearchContinuationFixture,researchCatalogFixture,researchGenerationFixture,researchProviderFixture,researchOwnerFixture,researchRuntimeFixture} from './r11-research.mjs';
import sharp from 'sharp';
import {seedViewerFixture,readViewerFixture,viewerAuthorityFixture,R10_FIXTURE_SVG} from './r10.mjs';
import {knowledgeSeed,readKnowledgeFixture,saveKnowledgeFixture} from './knowledge.mjs';
import {workspaceSeed,workspaceView,workspaceRead} from './workspace.mjs';
import { createServer } from 'node:http';
import { fixtureData, id, time } from './data.mjs';
import { readQuestFixture, saveQuestFixture } from './quests.mjs';
import { admissionFixture, saveAdmissionFixture } from './admission.mjs';
import { readHistoryFixture } from './history.mjs';
import { filterFixtureOr } from './query-predicates.mjs';
export async function startFixtureBoundary() {
  const viewerJpeg=await sharp(Buffer.from(R10_FIXTURE_SVG)).jpeg({quality:65}).toBuffer();
  let state = fixtureData(), control = { delayId: null, delayMs: 0, failTable: null, actionMode: 'success' };
  const log = [], effects = [], denied = [], heldKnowledgeActions = [], heldResearchLoads = [];
  const releaseKnowledgeActions=()=>{control.holdKnowledgeActions=false;for(const release of heldKnowledgeActions.splice(0))release();};
  const releaseResearchLoads=()=>{control.r11HoldLoads=false;for(const release of heldResearchLoads.splice(0))release();};
  const valueAt = (row,path) => path.replace(/->>?/g,'.').split('.').reduce((v,k) => v?.[k],row);
  const server = createServer(async(req,res) => {
    try {
    let body='';for await(const chunk of req)body+=chunk;
    const input=body?JSON.parse(body):{};
    const send = data => { res.setHeader('content-type','application/json');res.end(JSON.stringify(data)); };
    if(req.url==='/control'){if(input.r12Scenario)await loadR12NextFixture(state,input.r12Scenario,input.r12Directory,process.env.R12_SQL_TEST_HOST);if(input.r12Due||input.r12Pause)await controlR12(state,input);if(input.r11Research===true&&!state.r11Research)state.r11Research=seedResearchFixture(state,input);if(input.resetResearch===true)state.r11Research=seedResearchFixture(state,input);if(input.r11InstallContinuation===true)installResearchContinuationFixture(state,input);if(input.knowledge===true&&!state.knowledge)state.knowledge=knowledgeSeed(state);if(input.resetKnowledge===true)state.knowledge=knowledgeSeed(state);if(input.workspace===true&&!state.workspace)state.workspace=workspaceSeed(state,id,time);if(typeof input.history==='boolean'&&input.history!==state.history.enabled)state=fixtureData({history:input.history});if(input.viewer===true&&!state.viewer)state.viewer=seedViewerFixture(state);if(input.resetViewer===true)state.viewer=seedViewerFixture(state);if(input.viewerExpiresInMs&&state.viewer)state.viewer.expiresAt=new Date(Date.now()+input.viewerExpiresInMs).toISOString();control={...control,...input};if(input.holdKnowledgeActions===false)releaseKnowledgeActions();if(input.r11HoldLoads===false)releaseResearchLoads();return send({ok:true});}
    if(req.url==='/snapshot')return send({log,effects,denied,control});
    if(req.url==='/reset'){if(state.r12)await closeR12Fixture(state);state=fixtureData();log.length=effects.length=denied.length=0;control={delayId:null,delayMs:0,failTable:null,actionMode:'success'};return send({ok:true});}
    if(req.url==='/claims')return send(input.session==='off'?{data:null,error:null}:{data:{claims:{sub:state.owner,session_id:id(910003),email:'inert-owner@example.invalid'}},error:null});
    if(req.url==='/user')return send(input.session==='off'?{data:{user:null},error:null}:{data:{user:{id:state.owner,email:'inert-owner@example.invalid'}},error:null});
    if(req.url==='/r10/authority'){if(input.scope?.ownerId!==state.owner||input.scope?.authSessionId!==id(910003))return send({error:'Inert identity rejected'});try{return send({data:viewerAuthorityFixture(state,input,effects,control)});}catch{return send({error:'Inert authority rejected'});}}
    if(req.url==='/r10/capture'){log.push({kind:'inert-viewer-frame'});res.setHeader('content-type','image/jpeg');return res.end(control.viewerCorruptFrame?Buffer.from([255,216,255,217]):viewerJpeg);}
    if(req.url==='/r12/quote'){log.push({kind:'inert-r12-catalog'});return send(r12Quote(state));}
    if(req.url==='/r12/provider'){log.push({kind:'inert-r12-provider-transport',method:input.method,phase:input.phase});return send(r12Provider(state,input,control,effects));}
    if(state.r12&&['/rest/v1/rpc/r07_controller','/rest/v1/rpc/r12_discovery_server'].includes(req.url)){
      const name=req.url.split('/').at(-1);log.push({kind:'inert-r12-runtime',rpc:name,operation:input.p_operation});const result=await r12RuntimeRpc(state,name,input);
      if(result.error){res.statusCode=400;return send({code:'42501',message:result.error.message});}return send(result.data);
    }
    if(req.url==='/r11/catalog')return send(researchCatalogFixture(input.url,log,control));
    if(req.url==='/r11/clock'){
      if(req.method!=='POST'||!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)throw Error('Inert clock boundary rejected');
      return send({now:Number.isSafeInteger(control.r11Now)?control.r11Now:Date.now()});
    }
    if(req.url==='/r11/generation'){if(req.method!=='POST')throw Error('Inert generation boundary method rejected');return send(researchGenerationFixture(state,input,log,control));}
    if(req.url==='/r11/provider')return send(researchProviderFixture(state,input,effects,control));
    if(['/rest/v1/rpc/r11_research_server_v2','/rest/v1/rpc/r05_admission_server'].includes(req.url)){
      const name=req.url.split('/').at(-1);log.push({kind:'inert-r11-runtime',rpc:name,business:input.p_business_id,operation:input.p_operation});
      const result=researchRuntimeFixture(state,name,input,effects,control);
      if(result.error){res.statusCode=400;return send({code:'42501',message:result.error.message});}
      if(name==='r11_research_server_v2'&&input.p_operation==='load'&&control.r11HoldLoads)await new Promise(resolve=>heldResearchLoads.push(resolve));
      return send(result.data);
    }
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
      if(state.r12){const r12=await r12OwnerRpc(state,name,args,input.mode);if(r12){log.push({kind:'inert-r12-owner',rpc:name,operation:args.p_operation});return send(r12);}}
      if(['r11_research_workspace_v2','r11_research_bootstrap','r11_research_stop_v2','r11_research_continue'].includes(name)){log.push({rpc:name,business});return send(researchOwnerFixture(state,name,args,effects,control,input.mode));}
      if(name==='r11_connection_read'||name==='r11_etsy_read_workspace'){
        if(!state.businesses.some(b=>b.id===business))return send({data:null,error:{message:'Inert owner mismatch'}});
        if(input.mode==='unavailable')return send({data:null,error:{message:'Inert qualification unavailable'}});
        state.r11Connections??=new Map();
        if(!state.r11Connections.has(business))state.r11Connections.set(business,[{id:id(business===id(1)?110001:110002),provider:'etsy',externalAccountId:'200',label:'Saved own shop with a deliberately long readable display name',revision:id(110003),status:'token_expired',custody:'encrypted_oauth',verifiedAt:'2026-10-04T23:00:00Z',expiresAt:'2026-11-01T00:00:00Z',permittedOperations:['shop.read','listing.read'],providerExpiryVerified:false,credentialAlias:null,credentialFingerprint:'a'.repeat(64)}]);
        const connections=input.mode==='empty'?[]:state.r11Connections.get(business);
        const grants=input.mode==='empty'?[]:[{id:id(110010),provider:'etsy',expectedAccount:'Inert exact shop',applicationId:'inert-app',expiresAt:'2027-01-01T00:00:00Z',purposeHash:'a'.repeat(64),approvedCredentialFingerprint:'b'.repeat(64),state:'available',credentialAlias:null,providerScopeMode:'exact',providerScopes:['shops_r','listings_r']}];
        state.r11ReadWindows??=new Map();
        if(control.r11Reads&&!state.r11ReadWindows.has(business))state.r11ReadWindows.set(business,{id:id(business===id(1)?111001:111002),connectionId:id(business===id(1)?110001:110002),bindingRevision:id(110003),expiresAt:'2027-01-01T00:00:00Z',mode:'lazy',credentialFingerprint:'a'.repeat(64),maxReads:2,maxRefreshes:1,readsDispatched:1,refreshesDispatched:1,minRefreshSeconds:3000,state:'available'});
        const readWindows=control.r11Reads&&input.mode!=='empty'?[state.r11ReadWindows.get(business)]:[];
        const readAttempts=readWindows.length?[{id:id(111010),windowId:readWindows[0].id,connectionId:readWindows[0].connectionId,bindingRevision:id(110003),status:control.r11ReadState==='candidate'?'failed':'succeeded',createdAt:'2026-10-04T23:10:00Z',completedAt:'2026-10-04T23:10:01Z',refreshed:true,proof:control.r11ReadState==='candidate'?null:{totalDrafts:2,listingCount:1,verifiedAt:'2026-10-04T23:10:01Z'}}]:[];
        const projectedConnections=control.r11Reads&&control.r11ReadState==='candidate'?connections.map(c=>({...c,status:'refresh_unverified'})):connections;
        log.push({rpc:name,business});return send({data:{businessId:business,grantTotal:grants.length,attemptTotal:0,grants,connections:projectedConnections,attempts:[],readWindowTotal:readWindows.length,readAttemptTotal:readAttempts.length,readWindows,readAttempts},error:null});
      }
      if(name==='r11_etsy_read_owner'&&args.p_operation==='revoke_window'){
        const window=state.r11ReadWindows?.get(business);if(!state.businesses.some(b=>b.id===business)||!window||window.id!==args.p_payload.windowId)return send({data:null,error:{message:'Inert exact read window unavailable'}});
        if(window.state!=='revoked'){window.state='revoked';effects.push({kind:'in-memory-r11-read-window-revoke',business,windowId:window.id});}return send({data:{revoked:true},error:null});
      }
      if(name==='r11_connection_owner'&&args.p_operation==='disconnect'){
        const connection=state.r11Connections?.get(business)?.find(c=>c.id===args.p_payload.connectionId&&c.revision===args.p_payload.revision);
        if(!connection)return send({data:null,error:{message:'Inert exact connection mismatch'}});
        connection.status='revoked';effects.push({kind:'in-memory-r11-disconnect',business,connectionId:connection.id});return send({data:{disconnected:true,providerRevoked:false},error:null});
      }
      if(['r10_viewer_owner','r10_viewer_catalog'].includes(name)){log.push({rpc:name,args});return send(readViewerFixture(state,name,args,effects,control));}
      if(name==='r09_knowledge_read'){
        const call={rpc:name,business,dataset:args.p_dataset,query:args.p_query};log.push(call);
        if(control.delayId===args.p_query?.selectedId)await new Promise(resolve=>setTimeout(resolve,control.delayMs));
        const response=readKnowledgeFixture(state,args,control.failDataset===args.p_dataset?'unavailable':input.mode);
        if(control.shortDataset===args.p_dataset&&response.data?.items?.length)response.data.items.pop();
        call.returned=response.data?.items?.length;call.total=response.data?.total;call.ids=response.data?.items?.map(row=>row.id);call.selection=response.data?.selection?.status;call.selectedId=response.data?.selection?.item?.id;
        return send(response);
      }
      if(name==='r09_knowledge_owner'&&['propose','apply','rollback','remove'].includes(args.p_operation)){
        const call={rpc:name,business,operation:args.p_operation,submission:args.p_submission_id};log.push(call);
        if(control.holdKnowledgeActions){call.held=true;await new Promise(resolve=>heldKnowledgeActions.push(resolve));}
        if(control.actionDelayMs)await new Promise(resolve=>setTimeout(resolve,control.actionDelayMs));
        return send(saveKnowledgeFixture(state,args,effects,control.actionMode));
      }
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
  return {origin,state:()=>state,log,effects,denied,releaseKnowledgeActions,heldResearchLoads:()=>heldResearchLoads.length,releaseResearchLoads,close:async()=>{releaseKnowledgeActions();releaseResearchLoads();if(state.r12)await closeR12Fixture(state);return new Promise(resolve=>server.close(resolve));}};
}
