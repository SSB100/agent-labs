import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { businessId, secondBusinessId, exactContent, exactContentHash, exactRecordId, exactWorkHref, fixtureTables, fixtureTablesWithUnverifiedProviderCharge, id, noAssetRunId, noAssetWorkflowId, oldAssetId, oldCreativeRunId, oldImageArtifactId, oldWorkflowId, rootLibraryFixture, selectedDesignRoute, selectedRecordRoute, selectedRunRoute } from './helpers/console-library-root.mjs';
const plain = value => JSON.parse(JSON.stringify(value));
const exact = (read, value) => read.filters.some(([op, key, id]) => op === 'eq' && key === 'id' && id === value);
const table = (fixture, name) => fixture.reads.filter(read => read.table === name);
const wide = ['content','metadata','checksum','inspection','snapshot','quote','catalog_snapshot','input','state','output','review','receipt','estimate'];

for (const kind of ['designs','records']) test(`actual Library ${kind} root uses 25+sentinel metadata-only pages for two Businesses and old exact selections`, async () => {
  const f = rootLibraryFixture(), first = await f.render(`/dashboard?view=library&type=${kind}`);
  assert.equal(first.data.page.total, kind === 'designs' ? 254 : 255); assert.equal(first.data.page.items.length,25); assert.equal(first.data.page.complete,true);
  assert.equal(new Set(first.data.page.items.map(row => row.business_id)).size,2);
  const ids = first.data.page.items.map(row => row.id), next = await f.render(`/dashboard?view=library&type=${kind}&page=2`);
  assert.equal(next.data.page.items.length,25); assert.ok(next.data.page.items.every(row => !ids.includes(row.id)));
  assert.deepEqual(f.reads.filter(read=>read.range).map(read=>read.range),[[0,25],[25,50]]);
  for(const read of f.reads){assert.ok(!read.columns.split(',').some(key=>wide.includes(key)),`${read.table}: ${read.columns}`);assert.ok(read.range||read.limit<=27);}
  for(const read of f.reads.filter(read=>read.range)){assert.equal(read.returned,26);assert.deepEqual(read.orders.map(row=>row[0]),[kind==='designs'?'generated_at':'created_at','id']);}
  assert.deepEqual(f.loaderCalls.map(call=>call.name),[kind==='designs'?'loadConsoleLibraryPage':'loadConsoleLibraryRecordsPage',kind==='designs'?'loadConsoleLibraryPage':'loadConsoleLibraryRecordsPage']);
  assert.equal(f.ancillaryCalls.length,0); assert.deepEqual(f.denied,[]);
  if(kind==='designs'){assert.deepEqual(f.signs.map(batch=>batch.length),[25,25]);assert.deepEqual(f.signs.map(batch=>[...batch].sort()),[first.data.page.items,next.data.page.items].map(rows=>rows.map(row=>row.storage_path).sort()));assert.ok(f.signs.flat().every(path=>path.endsWith('.png')));}else assert.equal(f.signs.length,0);
});

test('actual selected design independently loads old immutable image, exact workflow/approval/costs, and exact Work artifact href',async()=>{
  const f=rootLibraryFixture(), page=await f.render(`${selectedDesignRoute}&q=unmatched&page=3&sort=oldest`), item=page.data.selection.item;
  assert.equal(page.data.page.items.length,0); assert.equal(page.data.selection.status,'found'); assert.equal(item.id,oldAssetId); assert.equal(item.runDetail.selection.item.id,oldCreativeRunId);assert.equal(item.runDetail.workflow.item.id,oldWorkflowId);
  assert.equal(item.runDetail.approval.status,'found');assert.equal(item.runDetail.costs.status,'ready');assert.equal(item.runDetail.costs.records[0].reported_microusd,1200);
  assert.equal(item.provenance.verification,'byte_identity');assert.equal(item.artifact.item.id,oldImageArtifactId);assert.equal(item.artifact.item.version,null);
  assert.deepEqual(plain(item.workIdentity),{businessId,workflowRunId:oldWorkflowId,artifactId:oldImageArtifactId});
  assert.ok(page.markup.includes(`href="${exactWorkHref.replaceAll('&','&amp;')}"`));assert.ok(!page.markup.includes(`artifact=${oldAssetId}`));
  assert.equal(f.signs.length,1);assert.equal(f.signs[0].length,1);assert.equal(f.signs[0][0],item.storage_path);
  const payload=table(f,'artifacts').filter(read=>read.columns.split(',').includes('content'));assert.equal(payload.length,1);assert.ok(exact(payload[0],oldImageArtifactId));assert.equal(payload[0].limit,2);
  assert.match(page.markup,/Saved candidate approval/);assert.match(page.markup,/Visual review unavailable/);assert.match(page.markup,/Print-file validation unavailable/);assert.match(page.markup,/Market ProductTEST/);assert.match(page.markup,/not established here/);
  assert.equal(f.ancillaryCalls.length,0);assert.deepEqual(f.denied,[]);
});

test('actual Records root reads and renders exact content/checksum without fabricating artifact revision or downloadable files',async()=>{
  const f=rootLibraryFixture(), page=await f.render(`${selectedRecordRoute}&mediaType=image%2Fpng&artifactType=creative.image&page=4&q=unmatched`), record=page.data.selection.item;
  assert.equal(page.data.page.items.length,0);assert.equal(page.data.selection.status,'found');assert.equal(record.id,exactRecordId);assert.deepEqual(plain(record.content),exactContent);assert.equal(record.checksum,exactContentHash);assert.equal(record.version,null);
  assert.equal(createHash('sha256').update(JSON.stringify(record.content,null,2)).digest('hex'),exactContentHash);
  assert.match(page.markup,/Artifact revision<\/dt><dd>Not recorded/);assert.match(page.markup,/does not establish a downloadable file/);assert.match(page.markup,/A JSON schema version is not an artifact revision/);assert.doesNotMatch(page.markup,/<script>must stay escaped/);assert.ok(page.markup.includes(exactContentHash));
  const reads=table(f,'artifacts');assert.equal(reads.length,2);assert.equal(reads.filter(read=>read.columns.includes('content')).length,1);assert.equal(reads.find(read=>read.columns.includes('content')).limit,2);
  assert.equal(f.reads.some(read=>read.table.startsWith('creative_')),false);assert.equal(f.signs.length,0);assert.equal(f.ancillaryCalls.length,0);assert.deepEqual(f.denied,[]);
});

test('exact paid no-asset history retains known and unknown charges, expired approval, failed workflow and no invented image',async()=>{
  const f=rootLibraryFixture(), page=await f.render(`${selectedRunRoute}&q=unmatched`), detail=page.data.runDetail;
  assert.equal(detail.selection.item.id,noAssetRunId);assert.equal(detail.workflow.item.id,noAssetWorkflowId);assert.equal(detail.workflow.item.status,'failed');assert.equal(detail.assets.total,0);assert.equal(detail.assets.status,'ready');assert.equal(detail.outputs.total,0);assert.equal(detail.costs.status,'ready');assert.equal(detail.costs.records.length,2);
  assert.equal(page.data.selection.status,'none');assert.match(page.markup,/No saved asset is recorded for this exact run/);assert.match(page.markup,/charge\(s\) remain unknown/);assert.match(page.markup,/US\$0\.001200/);assert.match(page.markup,/expired/i);assert.equal(f.signs.length,0);assert.doesNotMatch(page.markup,/data-library-design|Open full image/);
  assert.ok(page.markup.includes(`view=work&amp;business=${businessId}&amp;selected=${noAssetWorkflowId}`));assert.equal(f.ancillaryCalls.length,0);assert.deepEqual(f.denied,[]);
});

test('actual Library root excludes a saved estimate without provider request identity from known charges while preserving raw evidence',async()=>{
  const tables=fixtureTablesWithUnverifiedProviderCharge(),saved=plain(tables),f=rootLibraryFixture({tables});
  const page=await f.render(`${selectedRunRoute}&q=unmatched`),detail=page.data.runDetail,costs=detail.costs;
  assert.equal(detail.selection.item.id,noAssetRunId);assert.equal(costs.status,'ready');assert.equal(costs.records.length,3);
  assert.deepEqual(plain(costs.records.map(row=>({call_key:row.call_key,reserved_microusd:row.reserved_microusd,reported_microusd:row.reported_microusd,provider_request_id:row.provider_request_id}))),[
    {call_key:'brief:1',reserved_microusd:30051,reported_microusd:1979,provider_request_id:'synthetic-cost-truth-brief-1'},
    {call_key:'generate:1',reserved_microusd:210000,reported_microusd:210000,provider_request_id:null},
    {call_key:'screen:1',reserved_microusd:99501,reported_microusd:8301,provider_request_id:'synthetic-cost-truth-screen-1'},
  ]);
  const generated=costs.settlements.find(row=>row.call_key==='generate:1');
  assert.equal(generated.reported_microusd,210000);assert.equal(generated.provider_request_id,null);
  assert.deepEqual(plain(generated.receipt),{synthetic:true,reportedCostUsd:0.21,estimatedMicrousd:210000});
  const copy=page.markup.replace(/<[^>]*>/g,'');
  assert.match(copy,/US\$0\.010280 provider-reported charges/);
  assert.match(copy,/1 charge\(s\) remain unknown · US\$0\.210000 reserved/);
  assert.match(copy,/Conservative budget committed: US\$0\.339552/);
  assert.match(copy,/Unverified saved amount: US\$0\.210000/);
  assert.doesNotMatch(copy,/US\$0\.220280 provider-reported|Reported provider charge · US\$0\.210000/);
  assert.deepEqual(plain(tables),saved);assert.equal(f.ancillaryCalls.length,0);assert.deepEqual(f.denied,[]);
});

for(const kind of ['designs','records'])test(`actual Library ${kind} literal search uses only the promised persisted field`,async()=>{
  const f=rootLibraryFixture(),query='100%_\\',page=await f.render(`/dashboard?view=library&type=${kind}&q=${encodeURIComponent(query)}`);
  assert.equal(page.data.page.total,2);assert.deepEqual(f.reads.find(read=>read.range).filters.find(row=>row[0]==='ilike'),['ilike',kind==='designs'?'prompt':'name','%100\\%\\_\\\\%']);
  const hidden=await f.render(`/dashboard?view=library&type=${kind}&q=sourceOnly`);assert.equal(hidden.data.page.total,0);
});

test('actual Records root applies MIME/type in the database without changing exact selection',async()=>{
  const f=rootLibraryFixture(),page=await f.render(`${selectedRecordRoute}&mediaType=image%2Fpng&artifactType=creative.image&page=2`),read=f.reads.find(read=>read.range);
  assert.equal(page.data.page.total,127);assert.equal(page.data.selection.item.id,exactRecordId);assert.equal(page.data.query.page,2);
  for(const pair of [['media_type','image/png'],['artifact_type','creative.image']])assert.ok(read.filters.some(([op,key,value])=>op==='eq'&&key===pair[0]&&value===pair[1]));
});

test('aggregate selection verifies command/sidebar Business without narrowing aggregate collection or global Decisions',async()=>{
  const f=rootLibraryFixture(),aggregate=await f.render('/dashboard?view=library&type=designs');
  assert.equal(aggregate.tree.props.commandBar.props.businessId,undefined);assert.equal(aggregate.tree.props.navigationBusinessId,undefined);assert.equal(aggregate.tree.props.aggregateContext,true);assert.match(aggregate.markup,/Choose Business/);
  const page=await f.render(`/dashboard?view=library&type=designs&selected=${id(11000)}&page=2`);
  assert.equal(page.props.searchParams.has('business'),false);assert.equal(page.data.page.total,254);assert.equal(page.tree.props.navigationBusinessId,secondBusinessId);assert.equal(page.tree.props.commandBar.props.businessId,secondBusinessId);assert.equal(page.tree.props.aggregateContext,true);
  assert.match(page.markup,/All owned Businesses/);assert.ok(page.markup.includes(`view=connections&amp;business=${secondBusinessId}`));assert.match(page.markup,/href="\/dashboard\?view=decisions"/);
  const sheet=await f.render(`/dashboard?view=library&type=designs&selected=${id(11000)}&page=2&sheet=research`);
  assert.deepEqual(plain(sheet.sheet.props.children.props.businesses),plain([f.context.businesses[1]]));assert.deepEqual(f.ancillaryCalls.map(call=>call.businesses),[[secondBusinessId],[secondBusinessId]]);
  const back=new URL(sheet.sheet.props.returnTo,'https://test.invalid').searchParams;assert.equal(back.get('business'),null);assert.equal(back.get('selected'),id(11000));assert.equal(back.get('page'),'2');assert.equal(back.get('sheet'),null);
  const closed=await f.render('/dashboard?view=library&type=designs&page=2');assert.equal(closed.tree.props.commandBar.props.businessId,undefined);assert.equal(closed.tree.props.navigationBusinessId,undefined);assert.deepEqual(f.denied,[]);
});

test('legacy artifact spelling canonicalizes without losing Business, filters, old selection or close scope',async()=>{
  const f=rootLibraryFixture(),page=await f.render(`/dashboard?view=library&type=records&business=${businessId}&artifact=${exactRecordId}&q=Literal&sort=oldest&page=3&mediaType=application%2Fjson&artifactType=research.sources`),params=page.props.searchParams;
  assert.equal(params.has('artifact'),false);assert.equal(params.get('selected'),exactRecordId);assert.equal(params.get('business'),businessId);assert.equal(params.get('page'),'3');assert.equal(params.get('mediaType'),'application/json');
  const href=page.markup.match(/href="([^"]+)">Close detail<\/a>/)?.[1];assert.ok(href);const close=new URL(href.replaceAll('&amp;','&'),'https://test.invalid').searchParams;assert.equal(close.has('selected'),false);assert.equal(close.get('business'),businessId);assert.equal(close.get('page'),'3');assert.equal(close.get('q'),'Literal');
});

for(const mode of ['null-count','capped','read-error','foreign-row','duplicate-row','corrupt-row'])test(`actual Library root ${mode} never calls unavailable evidence empty or complete`,async()=>{
  const readOptions={transport(_table,result,read){if(!read.range)return result;if(mode==='null-count')return {...result,count:null};if(mode==='capped')return {...result,data:result.data.slice(0,7)};if(mode==='read-error')return {data:null,count:null,error:{message:'PRIVATE_DATABASE_ERROR'}};if(mode==='foreign-row')return {...result,data:result.data.map((row,index)=>index?row:{...row,business_id:id(999)})};if(mode==='duplicate-row')return {...result,data:[result.data[0],...result.data.slice(0,-1)]};return {...result,data:result.data.map((row,index)=>index?row:{...row,generated_at:'not-a-date',created_at:'not-a-date'})};}};
  for(const kind of ['designs','records']){const f=rootLibraryFixture({readOptions}),page=await f.render(`/dashboard?view=library&type=${kind}`);assert.equal(page.data.page.complete,false);assert.equal(page.data.page.total,null);assert.match(page.markup,/unavailable|could not be verified/i);assert.doesNotMatch(page.markup,/PRIVATE_DATABASE_ERROR|<h2>No matching/);assert.equal(f.ancillaryCalls.length,0);assert.deepEqual(f.denied,[]);}
});

for(const mode of ['missing','foreign','unavailable'])test(`actual old Library selection ${mode} keeps its scope and never substitutes a recent record`,async()=>{
  for(const kind of ['designs','records']){const selected=kind==='designs'?oldAssetId:exactRecordId,readOptions=mode==='unavailable'?{transport(_table,result,read){return exact(read,selected)?{data:null,count:null,error:true}:result;}}:{};
    const f=rootLibraryFixture({readOptions}),page=await f.render(`/dashboard?view=library&type=${kind}&business=${mode==='foreign'?secondBusinessId:businessId}&selected=${mode==='missing'?id(999999):selected}`);assert.equal(page.data.selection.status,mode==='unavailable'?'unavailable':'missing');assert.equal(page.data.selection.item,null);assert.match(page.markup,/not available in the selected Business scope|could not be verified/);assert.deepEqual(f.denied,[]);
  }
});

test('preview unavailable and corrupt provenance never become substituted images, fabricated downloads or visual PASS',async()=>{
  for(const mode of ['sign-missing','sign-expired','provenance','costs']){const tables=fixtureTables();if(mode==='provenance')tables.creative_phase_outputs.find(row=>row.creative_run_id===oldCreativeRunId).output.provenance.normalizedSha256='b'.repeat(64);
    const readOptions=mode==='sign-missing'?{signResult:()=>({data:[],error:null})}:mode==='sign-expired'?{signResult:()=>({data:null,error:true})}:mode==='costs'?{counts:{creative_cost_settlements:null}}:{};
    const f=rootLibraryFixture({tables,readOptions}),page=await f.render(`${selectedDesignRoute}&q=unmatched`);assert.equal(page.data.selection.status,'found');assert.match(page.markup,/unavailable|unknown/i);assert.doesNotMatch(page.markup,/Visual review PASS|<button[^>]*>[^<]*(?:Generate|Publish|Retry)/);
    if(mode==='costs'){assert.equal(page.data.selection.item.runDetail.costs.status,'unavailable');assert.match(page.markup,/Do not assume zero spend/);}else{assert.equal(page.data.selection.item.previewStatus,'unavailable');assert.match(page.markup,/Private preview unavailable/);assert.doesNotMatch(page.markup,/Open full image/);}
    assert.equal(f.ancillaryCalls.length,0);assert.deepEqual(f.denied,[]);
  }
});

for(const suffix of ['type=unexpected','type=records&type=designs','page=0','page=2&page=3','pageSize=500','q=*','selected=nope','selected='+oldAssetId+'&creativeRun='+oldCreativeRunId,'type=records&creativeRun='+oldCreativeRunId,'run='+oldWorkflowId,'decision='+id(99),'connectionRun='+id(99),'sheet=anything','sheet=research&sheet=research'])test(`actual Library root rejects malformed/conflicting ${suffix} before data reads`,async()=>{
  const f=rootLibraryFixture();await assert.rejects(f.render('/dashboard?view=library&'+suffix),error=>error.code==='FIXTURE_NOT_FOUND');assert.equal(f.reads.length,0);assert.equal(f.signs.length,0);assert.equal(f.ancillaryCalls.length,0);
});

test('unavailable owner Business metadata is honestly unavailable without Library reads or quote loading',async()=>{
  const f=rootLibraryFixture({businessesUnavailable:true}),page=await f.render(selectedRecordRoute);assert.equal(page.data.page.total,null);assert.equal(page.data.selection.status,'unavailable');assert.equal(f.reads.length,0);assert.equal(f.signs.length,0);assert.equal(f.ancillaryCalls.length,0);assert.match(page.markup,/Business records are unavailable/);assert.match(page.markup,/disabled="">Unavailable/);assert.doesNotMatch(page.markup,/Create workspace/);assert.deepEqual(f.denied,[]);
});
