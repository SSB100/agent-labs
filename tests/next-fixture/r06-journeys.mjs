import assert from 'node:assert/strict';
import path from 'node:path';
import { id } from './data.mjs';
import { historyId, candidateId, interventionId } from './history.mjs';

/** The real production Next pages, loaders, Link/RSC and native history run unchanged. */
export async function runHistoryJourneys({page,context,origin,boundary,output,check,requests,actions}) {
  const business=id(1), second=id(2), effects=boundary.effects.length, actionCount=actions.length;
  const control=values=>fetch(boundary.origin+'/control',{method:'POST',body:JSON.stringify(values)});
  await control({history:true});
  const started=boundary.log.length;
  const rpc=(dataset,offset=0,b=business)=>boundary.log.filter(c=>c.rpc==='r06_read'&&c.dataset===dataset&&c.business===b&&c.query.offset===offset).at(-1);
  const pager=label=>page.getByRole('navigation',{name:`${label} pages`,exact:true});
  const goto=route=>page.goto(origin+route);
  const route=(url,params={})=>{const target=new URL(url,origin);for(const [key,value]of Object.entries({business,...params}))target.searchParams.set(key,value);return target.pathname+target.search;};
  const clickNext=async(label,key,pageNumber=2)=>{await pager(label).getByRole('link',{name:`Next ${label}`,exact:true}).click();await page.waitForURL(url=>url.searchParams.get(`${key}Page`)===String(pageNumber));await pager(label).getByText(new RegExp(`page ${pageNumber}$`)).waitFor();};
  const total=async(label,number)=>{await pager(label).waitFor();assert.match(await pager(label).innerText(),new RegExp(`${number} total`));};
  try {
    await check('R06 owned directory count and page stay independent of exact off-page Business',async()=>{
      await goto(route('/dashboard/settings',{panel:'businesses'}));
      await total('Businesses',127);
      const directory=boundary.log.filter(c=>c.table==='businesses'&&c.operations?.some(([op])=>op==='range')).at(-1);
      assert.equal(directory.count,127);assert.equal(directory.returned,25);
      assert.ok(boundary.log.some(c=>c.table==='businesses'&&c.operations?.some(([op,key,value])=>op==='eq'&&key==='id'&&value===business)),'Exact selected Business needs separate owner-verified read');
      const pageIds=boundary.state().businesses.slice().sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id)).slice(0,25).map(b=>b.id);
      assert.ok(!pageIds.includes(business),'Selected populated Business is outside the directory page');
      const before=requests.length;
      await clickNext('Businesses','business');
      assert.equal(new URL(page.url()).searchParams.get('business'),business);await total('Businesses',127);
      await page.goBack();await page.waitForURL(url=>!url.searchParams.has('businessPage'));await total('Businesses',127);
      await page.goForward();await page.waitForURL(url=>url.searchParams.get('businessPage')==='2');await page.reload();await total('Businesses',127);
      assert.ok(requests.length>before,'Directory uses actual Next RSC');
      await goto(route('/dashboard',{view:'connections',businessPage:'6'}));await total('Account requests',127);
      assert.equal(await page.getByLabel(`Selected request ${historyId('account_runs',0,126)}`,{exact:true}).count(),1,'Current provider request is separate from the directory page');
      const missing=await goto(route('/dashboard/printful',{business:id(999999)}));assert.equal(missing.status(),404);
    });
    await check('R06 account old exact selection, current provider state and real history remain independent',async()=>{
      const exact=historyId('account_runs');
      await goto(route('/dashboard',{view:'connections',connectionRun:exact,provider:'printful'}));await total('Account requests',127);
      await page.getByLabel(`Selected request ${exact}`,{exact:true}).waitFor();
      const first=rpc('account_runs');assert.equal(first.returned,25);assert.equal(first.selection,'found');assert.equal(first.selectedId,exact);assert.ok(!first.ids.includes(exact));
      const registry=await page.locator('.connectionRows').innerText();
      await clickNext('Account requests','account');await page.getByLabel(`Selected request ${exact}`,{exact:true}).waitFor();
      assert.equal(await page.locator('.connectionRows').innerText(),registry,'History navigation cannot change current registry/provider state');
      const next=rpc('account_runs',25);assert.equal(next.returned,25);assert.equal(new Set([...first.ids,...next.ids]).size,50,'Equal timestamp pages use stable unique ID tie-break');
      await page.goBack();await page.waitForURL(url=>!url.searchParams.has('accountPage'));await page.getByLabel(`Selected request ${exact}`,{exact:true}).waitFor();
      await page.goForward();await page.waitForURL(url=>url.searchParams.get('accountPage')==='2');await page.reload();await page.getByLabel(`Selected request ${exact}`,{exact:true}).waitFor();
      await goto(route('/dashboard',{view:'connections',accountPage:'6'}));await page.getByLabel(`Selected request ${historyId('account_runs',0,126)}`,{exact:true}).waitFor();
      assert.equal(rpc('account_runs',125).returned,2);
      await goto(route('/dashboard',{view:'connections',connectionRun:historyId('account_runs',1),provider:'printful'}));
      await page.getByText('The selected request is unavailable in the loaded history. No other request has been selected. Refresh the saved records before continuing.',{exact:true}).waitFor();
      assert.equal(rpc('account_runs').selection,'missing');
    });
    await check('R06 unresolved account queue counts before paging and retains old open requests',async()=>{
      await goto(route('/dashboard',{view:'decisions'}));
      await page.getByText(/Saved connection requests/).click();await total('Open account requests',61);
      assert.equal(rpc('account_unresolved').total,61);
      await clickNext('Open account requests','accountOpen');await clickNext('Open account requests','accountOpen',3);
      const old=page.locator(`a[href*="connectionRun=${historyId('account_runs')}"]`).first();await old.waitFor();await old.click();
      await page.waitForURL(url=>url.searchParams.get('connectionRun')===historyId('account_runs'));
      await page.getByLabel(`Selected request ${historyId('account_runs')}`,{exact:true}).waitFor();
      await goto('/dashboard?view=decisions');await page.getByText(/Saved connection requests/).click();await total('Open account requests',122);
      assert.equal(rpc('account_unresolved',0,null).total,122,'Owner-wide unresolved queue includes Businesses outside directory page');
    });
    const pagers=[
      ['/dashboard/etsy','drafts','etsy_runs','etsy','Draft runs','R06 Business 1 draft 0'],
      ['/dashboard/etsy','drafts','etsy_packages','etsyPackage','Package candidates',null],
      ['/dashboard/etsy','listing','listing_runs','listing','Listing runs',null],
      ['/dashboard/etsy','listing','listing_qualifications','listingQualification','Qualification runs',null],
      ['/dashboard/etsy','publication','publication_runs','publication','Publication runs','R06 Business 1 publication 0'],
      ['/dashboard/etsy','publication','publication_drafts','publicationDraft','Verified draft candidates','R06 Business 1 verified draft 0'],
      ['/dashboard/printful','configuration','printful_runs','printful','Configuration runs','R06 Business 1 configuration 0'],
      ['/dashboard/printful','configuration','printful_sources','printfulSource','Product sources','R06 Business 1 product source 0'],
    ];
    for(const [pathname,panel,dataset,key,label,selectedTitle]of pagers)await check(`R06 ${dataset} bounded stable pages and exact selection through actual Next`,async()=>{
      const exact=historyId(dataset);
      await goto(route(pathname,{panel,[`${key}Id`]:exact}));await total(label,127);
      if(selectedTitle)await page.getByRole('heading',{name:selectedTitle,exact:true}).waitFor();
      const first=rpc(dataset);assert.equal(first.returned,25);assert.equal(first.selection,'found');assert.ok(!first.ids.includes(exact));
      assert.equal(first.ids[0],historyId(dataset,0,126),'Equal timestamp newest-ID order');
      const before=requests.length;
      await clickNext(label,key);await total(label,127);
      assert.equal(new URL(page.url()).searchParams.get(`${key}Id`),exact);
      if(selectedTitle)await page.getByRole('heading',{name:selectedTitle,exact:true}).waitFor();
      const next=rpc(dataset,25);assert.equal(next.returned,25);assert.equal(new Set([...first.ids,...next.ids]).size,50);
      await page.goBack();await page.waitForURL(url=>!url.searchParams.has(`${key}Page`));await total(label,127);
      await page.goForward();await page.waitForURL(url=>url.searchParams.get(`${key}Page`)==='2');await page.reload();await total(label,127);
      assert.ok(requests.length>before,'Historical page navigation uses real RSC');
      await goto(route(pathname,{panel,business:second,[`${key}Id`]:exact}));await total(label,127);
      assert.equal(rpc(dataset,0,second).selection,'missing','Same-owner foreign Business selection never substitutes');
      if(selectedTitle)assert.equal(await page.getByRole('heading',{name:selectedTitle,exact:true}).count(),0);
    });
    await check('R06 filters apply before pages while exact selection ignores list-only filters',async()=>{
      await goto(route('/dashboard/etsy',{panel:'drafts',etsyStatus:'failed',etsyQuery:'draft 1',etsyId:historyId('etsy_runs')}));
      await total('Draft runs',19);
      const filtered=rpc('etsy_runs');assert.equal(filtered.returned,19);assert.equal(filtered.selection,'found');
      await page.getByRole('heading',{name:'R06 Business 1 draft 0',exact:true}).waitFor();
      assert.ok(filtered.ids.every(value=>Number(value.slice(-3))%2===1));
      await goto(route('/dashboard/printful',{panel:'configuration',printfulPage:'6',printfulSourcePage:'2'}));
      assert.equal(rpc('printful_runs',125).returned,2);assert.equal(rpc('printful_sources',25).returned,25);
      await total('Configuration runs',127);await total('Product sources',127);
    });
    await check('R06 Quest filters and exact intervention joins preserve same-Business historical identity',async()=>{
      await goto(route('/dashboard/etsy',{panel:'drafts',quest:id(820000),etsyId:historyId('etsy_runs')}));await total('Draft runs',64);
      await page.getByRole('heading',{name:'R06 Business 1 draft 0',exact:true}).waitFor();assert.equal(rpc('etsy_runs').selection,'found');
      await goto(route('/dashboard/etsy',{panel:'drafts',quest:id(820001),etsyId:historyId('etsy_runs')}));await total('Draft runs',63);
      assert.equal(rpc('etsy_runs').selection,'missing');assert.equal(await page.getByRole('heading',{name:'R06 Business 1 draft 0',exact:true}).count(),0);
      for(const [pathname,panel,dataset,key,title]of [['/dashboard/etsy','publication','publication_runs','publicationRequest','R06 Business 1 publication 0'],['/dashboard/printful','configuration','printful_runs','intervention','R06 Business 1 configuration 0']]){
        await goto(route(pathname,{panel,[key]:interventionId(dataset)}));await page.getByRole('heading',{name:title,exact:true}).waitFor();
        assert.equal(rpc(dataset).selectedId,historyId(dataset));assert.ok(!rpc(dataset).ids.includes(historyId(dataset)));
        await goto(route(pathname,{panel,[key]:interventionId(dataset,1)}));assert.match(await page.locator('main').innerText(),/records could not be checked/);
        assert.equal(await page.getByRole('heading',{name:title,exact:true}).count(),0);
      }
    });
    await check('R06 product latest-per-entity and old decision history survive independent pages',async()=>{
      const exact=candidateId();
      await goto(route('/dashboard/products',{panel:'candidates',candidate:exact,experimentPage:'6'}));
      await total('Candidates',127);await total('Candidate decisions',128);
      const candidate=page.locator(`#candidate-${exact}`);await candidate.waitFor();assert.match(await candidate.locator('summary').first().innerText(),/Latest.*REJECT/);
      const first=rpc('product_candidates');assert.equal(first.returned,25);assert.ok(!first.ids.includes(exact));assert.equal(first.selection,'found');
      await clickNext('Candidates','candidate');assert.equal(new URL(page.url()).searchParams.get('experimentPage'),'6');
      await clickNext('Candidate decisions','decision');assert.equal(new URL(page.url()).searchParams.get('candidatePage'),'2');
      assert.match(await candidate.locator('summary').first().innerText(),/Latest.*REJECT/);
      await page.goBack();await page.waitForURL(url=>!url.searchParams.has('decisionPage'));await page.goForward();await page.waitForURL(url=>url.searchParams.get('decisionPage')==='2');await page.reload();
      assert.match(await candidate.locator('summary').first().innerText(),/Latest.*REJECT/);
      await goto(route('/dashboard/artifacts'));await total('Production evidence candidates',126);
      assert.ok(!rpc('production_candidates').ids.includes(exact),'Latest REJECT cannot be eligible because of older TEST');
      await goto('/dashboard/products?panel=candidates');await total('Candidates',254);
      assert.equal(rpc('product_candidates',0,null).total,254,'Owner-wide candidate count is independent of directory page');
    });
    for(const [kind,panel,label,table,exact]of [['stage','stages','Saved stages','workflow_stage_runs',id(20000)],['task','tasks','Saved tasks','task_contracts',id(21000)],['worker','workers','Saved worker runs','worker_runs',id(22000)]])await check(`R06 retained ${kind} server paging preserves exact child and parent`,async()=>{
      const base=route(`/dashboard/workflows/${id(1001)}`,{panel,[kind]:exact});
      await goto(base);await page.getByRole('heading',{name:`Exact saved ${kind} · ${exact}`,exact:true}).waitFor();
      const labelText=await pager(label).innerText();assert.match(labelText,/1[23]\d total/);
      const before=boundary.log.length;
      await clickNext(label,kind);await page.getByRole('heading',{name:`Exact saved ${kind} · ${exact}`,exact:true}).waitFor();
      const calls=boundary.log.slice(before).filter(c=>c.table===table);
      assert.ok(calls.some(c=>c.operations.some(([op,start,end])=>op==='range'&&start===25&&end<=50)&&c.returned<=26),'Child list is server bounded');
      assert.ok(calls.some(c=>c.operations.some(([op,key,value])=>op==='eq'&&key==='id'&&value===exact)&&c.operations.some(([op,key,value])=>op==='eq'&&key==='workflow_run_id'&&value===id(1001))));
      await page.goBack();await page.waitForURL(url=>!url.searchParams.has(`${kind}Page`));await page.goForward();await page.waitForURL(url=>url.searchParams.get(`${kind}Page`)==='2');await page.reload();
      await page.getByRole('heading',{name:`Exact saved ${kind} · ${exact}`,exact:true}).waitFor();
      await goto(route(`/dashboard/workflows/${id(1002)}`,{panel,[kind]:exact}));await page.getByText(`This exact ${kind} is missing. No replacement record was selected.`,{exact:true}).waitFor();
    });
    await check('R06 available empty, unavailable and short-page reads never collapse to a false zero',async()=>{
      for(const mode of ['empty','unavailable']){
        await context.addCookies([{name:'r03-mode',value:mode,url:origin}]);
        try{
          await goto(route('/dashboard/printful',{panel:'configuration'}));
          if(mode==='empty'){await total('Configuration runs',0);await total('Product sources',0);assert.match(await page.locator('main').innerText(),/No product configuration attempts are recorded/);}
          else assert.match(await page.locator('main').innerText(),/could not be checked|unavailable/i);
          if(mode==='unavailable')assert.equal(await page.getByText('No product configuration attempts are recorded for this Business.',{exact:true}).count(),0);
        }finally{await context.clearCookies({name:'r03-mode'});}
      }
      await control({shortDataset:'printful_runs'});await goto(route('/dashboard/printful',{panel:'configuration'}));
      await page.getByRole('alert').filter({hasText:'Product records could not be checked'}).waitFor();
      assert.equal(await page.getByText('No product configuration attempts are recorded for this Business.',{exact:true}).count(),0);
      await control({shortDataset:null});await goto(route('/dashboard/printful',{panel:'configuration'}));await total('Configuration runs',127);
      await page.screenshot({path:path.join(output,'r06-bounded-history-1280x720.png')});
    });
    await check('R06 history navigation has bounded wire records and zero write/provider effects',async()=>{
      const calls=boundary.log.slice(started).filter(c=>c.rpc==='r06_read'&&Number.isInteger(c.returned));
      assert.ok(calls.length>20);assert.ok(calls.every(c=>c.query.limit===25&&c.returned<=25&&c.query.offset>=0));
      assert.equal(boundary.effects.length,effects);assert.equal(actions.length,actionCount);
      assert.deepEqual(boundary.denied,[],'No action/provider operation is permitted by history transport');
    });
  } finally {await control({history:false,failDataset:null,shortDataset:null});await context.clearCookies({name:'r03-mode'});}
}
