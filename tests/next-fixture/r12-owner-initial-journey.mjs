import assert from 'node:assert/strict';
import path from 'node:path';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import sharp from 'sharp';
import {r12OwnerRpc} from './r12-sql.mjs';
import {actualZoomBrowser} from './browser-zoom.mjs';
import {extendOwnerInitialNextAllowance} from './r12-owner-initial.mjs';

// Failure artifacts contain only this journey's inert fixture data. Keep each
// browser read and screenshot bounded so diagnostics cannot hide the first error.
export async function captureOwnerJourneyFailure({page,output,stage,index}) {
  const stem=`failed-stage-${String(index).padStart(2,'0')}`;
  const diagnostic={stage:stage.slice(0,500),url:page.url().slice(0,2048),errors:[]};
  const bounded=async work=>{let timer;try{return await Promise.race([work(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Failure capture exceeded 3500ms')),3500);})]);}finally{clearTimeout(timer);}};
  const snapshots=await Promise.allSettled([
    bounded(()=>page.locator('body').evaluate(body=>{
      const root=body.ownerDocument.documentElement;
      const viewport={width:root.clientWidth,height:root.clientHeight,documentWidth:root.scrollWidth,documentHeight:root.scrollHeight};
      const overflow=Array.from(body.querySelectorAll('*')).slice(0,1500).map(node=>{
        const rect=node.getBoundingClientRect();
        return{tag:node.tagName.toLowerCase(),id:node.id.slice(0,200),classes:(node.getAttribute('class')??'').slice(0,200),left:rect.left,right:rect.right,width:rect.width,height:rect.height,clientWidth:node.clientWidth,scrollWidth:node.scrollWidth};
      }).filter(node=>node.width>0&&node.height>0&&(node.left< -1||node.right>viewport.width+1||node.scrollWidth>node.clientWidth+1)).slice(0,40);
      return{viewport,overflow,
      text:body.innerText.slice(0,12000),
      controls:Array.from(body.querySelectorAll('select,input,button,[role="combobox"]')).slice(0,60).map(node=>({
        tag:node.tagName.toLowerCase(),id:node.id.slice(0,200),type:(node.getAttribute('type')??'').slice(0,100),
        name:(node.getAttribute('name')??'').slice(0,200),ariaLabel:(node.getAttribute('aria-label')??'').slice(0,500),
        labels:Array.from(node.labels??[]).slice(0,4).map(label=>label.textContent.replace(/\s+/g,' ').trim().slice(0,500)),
        disabled:node.matches(':disabled'),
      })),
      };
    },undefined,{timeout:2000})),
    bounded(()=>page.locator('body').ariaSnapshot({timeout:2000})),
    bounded(()=>page.screenshot({path:path.join(output,`${stem}.png`),fullPage:false,timeout:3000})),
  ]);
  for(const [index,key]of ['dom','accessibleNames','screenshot'].entries()){
    const result=snapshots[index];
    if(result.status==='rejected')diagnostic.errors.push({capture:key,error:String(result.reason).slice(0,2000)});
    else diagnostic[key]=key==='screenshot'?`${stem}.png`:key==='accessibleNames'?result.value.slice(0,16000):result.value;
  }
  await writeFile(path.join(output,`${stem}.json`),JSON.stringify(diagnostic,null,2));
  return{diagnostic:`${stem}.json`,...(diagnostic.screenshot?{screenshot:diagnostic.screenshot}:{})};
}

// Native viewport capture avoids mixing deep-scroll offsets with real tab zoom.
export async function captureOwnerZoomViewport({page,target,output,name}) {
  await page.bringToFront();await target.scrollIntoViewIfNeeded();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const geometry=await target.evaluate(element=>{
    const rect=element.getBoundingClientRect();
    return{width:innerWidth,height:innerHeight,target:{left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height},hit:document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2)===element};
  });
  assert.ok(geometry.hit&&geometry.target.width>0&&geometry.target.height>0&&geometry.target.left>=0&&geometry.target.right<=geometry.width&&geometry.target.top>=0&&geometry.target.bottom<=geometry.height,`${name}: captured target must be visible and hit-testable in the actual zoom viewport ${JSON.stringify(geometry)}`);
  const viewport=page.viewportSize(),cdp=await page.context().newCDPSession(page);
  try{
    const capture=await cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false}),pixels=Buffer.from(capture.data,'base64');
    assert.equal(pixels.readUInt32BE(16),viewport.width,'Zoom capture preserves the full physical viewport width');assert.equal(pixels.readUInt32BE(20),viewport.height);
    await writeFile(path.join(output,name),pixels);
    assert.ok((await sharp(pixels).stats()).channels.some(channel=>channel.stdev>5),`${name}: actual zoom capture must contain rendered content`);
  }finally{await cdp.detach();}
}

/** Real Next/React/authenticated owner actions and migrated isolated SQL.
 * All public catalogs, provider responses and receipts are synthetic engineering
 * evidence. This journey makes no business-purpose qualification claim. */
export async function runOwnerInitialJourney({origin,boundary,output}) {
  const results=[],external=[],errors=[];let browserStatus='not started',page;
  const report=()=>writeFile(path.join(output,'acceptance.json'),JSON.stringify({results,external,errors,browser:browserStatus,boundary:'isolated SQL and synthetic provider transport only'},null,2));
  const check=async(name,work)=>{
    console.log('START:',name);let failure;
    const captureFailure=async target=>{try{failure={artifacts:await captureOwnerJourneyFailure({page:target,output,stage:name,index:results.length+1})};}catch(error){failure={diagnosticError:String(error).slice(0,2000)};}};
    try{await work(captureFailure);results.push({name,status:'passed'});console.log('PASS:',name);}
    catch(error){if(!failure)await captureFailure(page);results.push({name,status:'failed',error:String(error.stack??error),...failure});await report();throw error;}
    await report();
  };
  const control=async(kind)=>{const response=await fetch(boundary.origin+'/control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({r12Scenario:`owner-initial-${kind}`,r12DelayReceipt:false}),signal:AbortSignal.timeout(90000)});assert.equal(response.status,200,await response.text());};
  const current=()=>boundary.state().r12;
  const catalog=async(goalId=current().goalId,setupId=null)=>{const result=await r12OwnerRpc(boundary.state(),'r12_owner_research_read',{p_business_id:current().businessId,p_goal_id:goalId,p_setup_id:setupId});assert.equal(result.error,null);return result.data;};
  let browser;
  try{browser=await chromium.launch({headless:true,...(process.env.GUIDED_UI_CHROMIUM_PATH?{executablePath:process.env.GUIDED_UI_CHROMIUM_PATH}:{}),args:['--no-sandbox']});browserStatus='actual Chromium';}
  catch(error){browserStatus='launch blocked; journeys unrun';results.push({name:'Launch isolated Chromium',status:'failed',error:String(error)});await report();throw error;}
  const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});
  context.setDefaultTimeout(30000);context.setDefaultNavigationTimeout(30000);
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(['http:','https:'].includes(url.protocol)&&url.origin!==origin){external.push(url.origin);return route.abort('blockedbyclient');}return route.continue();});
  page=await context.newPage();page.on('pageerror',error=>errors.push(String(error)));
  const text=()=>page.locator('main').innerText();
  const choose=async(grantId)=>{const rows=(await catalog(goalId)).profiles.filter(row=>row.profile.id===current().profileId&&(!grantId||row.grantId===grantId));assert.equal(rows.length,1,'Exact reviewed profile and grant must be present once in the saved catalog');const profile=page.getByLabel('Reviewed research profile',{exact:true}),expected=`${current().profileId}:${rows[0].grantId}`;const options=await profile.locator('option').evaluateAll(nodes=>nodes.map(node=>node.value));assert.ok(options.includes(expected),`Reviewed UI omitted selected catalog grant: ${JSON.stringify({expected,options})}`);await profile.selectOption(expected);await page.getByLabel('Public market set',{exact:true}).selectOption('gb');await page.getByLabel('Public topic and adult audience',{exact:true}).selectOption('astronomy');await page.getByLabel('Proposed Business lifetime limit (USD)',{exact:true}).fill('6.000000');};
  const capture=async(name)=>{const geometry=await page.evaluate(()=>({width:document.documentElement.clientWidth,height:document.documentElement.clientHeight,documentWidth:document.documentElement.scrollWidth,documentHeight:document.documentElement.scrollHeight}));assert.ok(geometry.documentWidth<=geometry.width+1,`${name}: horizontal overflow ${JSON.stringify(geometry)}`);if(geometry.width>=1280)assert.ok(geometry.documentHeight<=geometry.height+1,`${name}: desktop document escaped its viewport ${JSON.stringify(geometry)}`);await page.screenshot({path:path.join(output,`${name}.png`),fullPage:true});};
  let goalId,receipt;
  try {
    await control('native');
    await check('ordinary Business chooser lists genuine saved Quests without selecting current or dispatching',async()=>{
      await page.goto(`${origin}/dashboard/quests/research?business=${current().businessId}`);
      await page.getByRole('heading',{name:'Choose your saved objective',exact:true}).waitFor();
      assert.equal(await page.getByLabel('Reviewed research profile',{exact:true}).count(),0);assert.deepEqual(current().calls,[]);
      await capture('01-exact-quest-selection');
    });
    await check('Business-level setup reference uses the real owner route without creating authority or dispatch',async()=>{
      const state=async()=>(await current().db.query('select (select count(*) from private.r12_owner_setups) setups,(select count(*) from private.r12_owner_activations) initial_activations,(select count(*) from private.r12_owner_episode_activations) episode_activations,(select count(*) from private.r12_discovery_scopes) scopes')).rows[0];
      const before=await state(),field=page.getByRole('textbox',{name:'Operator-supplied grant UUID',exact:true});
      await page.getByRole('heading',{name:'Prepare research setup reference',exact:true}).waitFor();
      await field.fill('not-a-uuid');assert.equal(await page.getByRole('button',{name:'Prepare setup reference',exact:true}).isDisabled(),true);
      await field.fill(current().continuationGrantId);await page.getByRole('button',{name:'Prepare setup reference',exact:true}).click();
      const result=page.getByRole('textbox',{name:'Nonsecret setup reference',exact:true});await result.waitFor();const reference=JSON.parse(await result.inputValue());
      assert.deepEqual(Object.keys(reference).sort(),['authorityCreated','bootstrapKeyHash','businessId','grantId','ownerId']);
      assert.equal(reference.businessId,current().businessId);assert.equal(reference.ownerId,current().ownerId);assert.equal(reference.grantId,current().continuationGrantId);assert.equal(reference.authorityCreated,false);assert.match(reference.bootstrapKeyHash,/^[a-f0-9]{64}$/);
      await result.focus();assert.deepEqual(await result.evaluate(node=>[node.selectionStart,node.selectionEnd]),[0,(await result.inputValue()).length]);
      const foreign=await page.evaluate(async()=>{const response=await fetch('/api/research/r12/owner-bootstrap',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({businessId:crypto.randomUUID(),grantId:crypto.randomUUID()})});return response.status;});assert.equal(foreign,403);
      assert.deepEqual(await state(),before);assert.deepEqual(current().calls,[]);assert.deepEqual(current().receipts,[]);await capture('01a-nonsecret-setup-reference');
      await field.fill(crypto.randomUUID());assert.equal(await result.count(),0,'Editing the grant clears a stale reference');
      await page.setViewportSize({width:320,height:800});await capture('01b-setup-reference-320');
      await field.focus();await page.keyboard.press('Tab');const focus=await page.getByRole('button',{name:'Prepare setup reference',exact:true}).evaluate(node=>({active:document.activeElement===node,visible:node.matches(':focus-visible'),outline:parseFloat(getComputedStyle(node).outlineWidth)}));assert.ok(focus.active&&focus.visible&&focus.outline>=2,'Setup reference button must have visible keyboard focus at mobile width');
      await page.setViewportSize({width:1280,height:900});
    });
    await check('actual R04 creation and ready preference lead to Research this Quest without substituting objective',async()=>{
      await page.getByRole('link',{name:'Create or edit a Quest',exact:true}).click();
      await page.getByRole('textbox',{name:'Quest title',exact:true}).fill('Technical owner-created astronomy research');
      await page.getByRole('textbox',{name:'Your Quest in plain language',exact:true}).fill('Target 1 units; budget USD 2; deadline: 2027-12-31T23:59:00Z; geography: United Kingdom; scope: original POD T-shirt research; stop if costs rise. Synthetic technical objective; no demand claim.');
      await page.getByRole('checkbox',{name:/I reviewed the extracted facts and unresolved items/}).check();
      await page.getByRole('button',{name:'Save Quest draft',exact:true}).click();
      await page.waitForURL(url=>url.pathname==='/dashboard/quests'&&!!url.searchParams.get('quest'));
      goalId=new URL(page.url()).searchParams.get('quest');assert.ok(goalId);
      await page.getByText('Record lifecycle preference',{exact:true}).click();await page.getByRole('button',{name:'ready',exact:true}).click();
      await page.getByRole('link',{name:'Research this Quest',exact:true}).click();
      await page.getByRole('heading',{name:'Technical owner-created astronomy research',exact:true}).waitFor();
      assert.equal(new URL(page.url()).searchParams.get('quest'),goalId);assert.deepEqual(current().calls,[]);
      assert.equal(await page.getByLabel('Reviewed research profile',{exact:true}).inputValue(),'');
    });
    await check('lost preparation response recovers one exact saved receipt after reload with no paid call',async()=>{
      await choose();let interrupted=false;
      const intercept=async route=>{if(!interrupted&&route.request().method()==='POST'&&route.request().headers()['next-action']){interrupted=true;await route.fetch();return route.abort('failed');}return route.fallback();};
      await page.route('**/dashboard/quests/research?**',intercept);
      try {await page.getByRole('button',{name:'Prepare exact research packet',exact:true}).click();await page.getByText(/The response was interrupted\./).waitFor();}finally{await page.unroute('**/dashboard/quests/research?**',intercept);}
      assert.ok(interrupted);let saved=await catalog(goalId);assert.equal(saved.setups.length,1);receipt=saved.setups[0];assert.equal(receipt.confirmed,false);assert.equal(receipt.activated,false);assert.deepEqual(current().calls,[]);
      await page.reload();await page.getByRole('link',{name:`Setup ${receipt.setupId}`,exact:true}).click();
      await page.getByRole('heading',{name:'Review this exact research packet',exact:true}).waitFor();
      assert.equal(new URL(page.url()).searchParams.get('setup'),receipt.setupId);
      assert.equal(await page.getByRole('button',{name:'Confirm this exact research policy',exact:true}).isDisabled(),true);
      assert.equal(await page.getByLabel('Proposed original cumulative research limit (USD)',{exact:true}).count(),0);
      assert.match(await text(),/one cumulative cap/);assert.match(await text(),/dispatch clock starts at confirmation/);
      assert.doesNotMatch(receipt.preview.approvedQuery,/Synthetic technical objective|Target 1 units/);
      await capture('02-native-exact-packet');
      await page.setViewportSize({width:320,height:800});await capture('03-native-packet-320');await page.setViewportSize({width:1280,height:900});
      await page.getByRole('checkbox',{name:/I reviewed this exact packet/}).check();await page.reload();
      assert.equal(await page.getByRole('checkbox',{name:/I reviewed this exact packet/}).isChecked(),false,'Consent must not survive reload');
      saved=await catalog(goalId);assert.equal(saved.setups.length,1);
    });
    await check('new owner page is contained at desktop sizes and keyboard reachable at mobile/reflow sizes',async()=>{
      for(const[width,height]of [[1280,720],[1440,900],[390,844],[320,800],[640,360]]){
        await page.setViewportSize({width,height});await page.getByRole('heading',{name:'Research a saved Quest',exact:true}).scrollIntoViewIfNeeded();await capture(`owner-packet-${width}x${height}`);
        const consent=page.getByRole('checkbox',{name:/I reviewed this exact packet/});await consent.scrollIntoViewIfNeeded();await consent.focus();await page.keyboard.press('Space');assert.equal(await consent.isChecked(),true);
        const focus=await consent.evaluate(node=>({active:document.activeElement===node,visible:node.matches(':focus-visible'),outline:parseFloat(getComputedStyle(node).outlineWidth)}));assert.ok(focus.active&&focus.visible&&focus.outline>=2,'Consent must have visible keyboard focus');
        await page.keyboard.press('Space');assert.equal(await consent.isChecked(),false);assert.equal(await page.getByRole('button',{name:'Confirm this exact research policy',exact:true}).isDisabled(),true);
        await capture(`owner-confirmation-controls-${width}x${height}`);
      }
      await page.setViewportSize({width:1280,height:720});assert.deepEqual(current().calls,[]);
    });
    await check('new owner page clears consent after editing, keyboard navigation, Back, Forward and reload',async()=>{
      const exact=page.url(),consent=()=>page.getByRole('checkbox',{name:/I reviewed this exact packet/});
      await consent().check();await page.getByLabel('Public topic and adult audience',{exact:true}).selectOption('gardening');assert.equal(await page.getByRole('heading',{name:'Review this exact research packet',exact:true}).count(),0);
      await page.reload();await consent().waitFor();assert.equal(await consent().isChecked(),false);assert.equal(await page.getByLabel('Public topic and adult audience',{exact:true}).inputValue(),'astronomy');
      await consent().check();const chooseAnother=page.getByRole('link',{name:'Choose another Quest',exact:true});await chooseAnother.scrollIntoViewIfNeeded();await chooseAnother.focus();await page.keyboard.press('Enter');
      await page.waitForURL(url=>url.pathname==='/dashboard/quests/research'&&!url.searchParams.has('quest'));await page.getByRole('heading',{name:'Choose your saved objective',exact:true}).waitFor();
      await page.goBack();await page.waitForURL(exact);await consent().waitFor();assert.equal(await consent().isChecked(),false,'Back cannot restore unsent permission');
      await page.goForward();await page.waitForURL(url=>!url.searchParams.has('quest'));await page.goBack();await page.waitForURL(exact);await consent().waitFor();assert.equal(await consent().isChecked(),false,'Forward/Back cannot restore unsent permission');
      await consent().check();await page.reload();await consent().waitFor();assert.equal(await consent().isChecked(),false);assert.equal((await catalog(goalId)).setups.length,1);assert.deepEqual(current().calls,[]);await capture('owner-history-consent-reset');
    });
    await check('new owner packet supports real 200 percent browser zoom and keyboard consent without dispatch',async captureFailure=>{
      const zoom=await actualZoomBrowser();let zoomPage;
      try{
        await zoom.context.route('**/*',route=>{const url=new URL(route.request().url());if(['http:','https:'].includes(url.protocol)&&url.origin!==origin){external.push(url.origin);return route.abort('blockedbyclient');}return route.continue();});
        zoomPage=await zoom.context.newPage();zoomPage.on('pageerror',error=>errors.push(String(error)));await zoomPage.goto(page.url());assert.equal(await zoom.set(zoomPage,2),2);
        await zoomPage.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        const consent=zoomPage.getByRole('checkbox',{name:/I reviewed this exact packet/});await consent.scrollIntoViewIfNeeded();await consent.focus();await zoomPage.keyboard.press('Space');assert.equal(await consent.isChecked(),true);await zoomPage.keyboard.press('Space');assert.equal(await consent.isChecked(),false);
        const geometry=await zoomPage.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth}));assert.ok(geometry.width>=630&&geometry.width<=650,'Verify actual 2x browser zoom viewport');assert.ok(geometry.documentWidth<=geometry.width+1);
        const confirm=zoomPage.getByRole('button',{name:'Confirm this exact research policy',exact:true});await confirm.scrollIntoViewIfNeeded();const box=await confirm.boundingBox();assert.ok(box&&box.width>=100&&box.height>=43.5,'Zoomed confirmation stays reachable/readable');
        await captureOwnerZoomViewport({page:zoomPage,target:confirm,output,name:'owner-packet-controls-zoom200.png'});
        await captureOwnerZoomViewport({page:zoomPage,target:zoomPage.getByRole('button',{name:'Prepare setup reference',exact:true}),output,name:'owner-setup-reference-zoom200.png'});
        await captureOwnerZoomViewport({page:zoomPage,target:zoomPage.getByRole('heading',{name:'Research a saved Quest',exact:true}),output,name:'owner-packet-zoom200.png'});assert.deepEqual(current().calls,[]);
      }catch(error){if(zoomPage)await captureFailure(zoomPage);throw error;}finally{await zoom.close();}
    });
    await check('exact confirmation blocks repeated clicks, activates only finite authority, and opens existing Continue/Stop workspace',async()=>{
      await page.getByRole('checkbox',{name:/I reviewed this exact packet/}).check();
      await page.getByRole('button',{name:'Confirm this exact research policy',exact:true}).dblclick();
      await page.getByRole('link',{name:'Open research workspace for Continue / Stop',exact:true}).waitFor();
      const saved=(await catalog(goalId,receipt.setupId)).setups[0];assert.equal(saved.confirmed,true);assert.equal(saved.activated,true);assert.deepEqual(current().calls,[]);receipt=saved;
      await page.reload();assert.equal(await page.getByRole('checkbox',{name:/I reviewed this exact packet/}).count(),0);
      await page.getByRole('link',{name:'Open research workspace for Continue / Stop',exact:true}).click();
      await page.getByRole('button',{name:'Continue approved research',exact:true}).waitFor();
      assert.equal(new URL(page.url()).searchParams.get('selected'),receipt.scopeId);assert.equal(new URL(page.url()).searchParams.get('quest'),goalId);
      await capture('04-confirmed-existing-workspace');
    });
    await check('Continue runs the existing five-phase engine once and preserves an honest result and Stop',async()=>{
      await page.getByRole('button',{name:'Continue approved research',exact:true}).click();
      await page.getByRole('heading',{name:'Needs more evidence',exact:true}).waitFor({timeout:90000});
      assert.deepEqual(current().calls,['plan','search1','select1','strategy','review']);assert.deepEqual(current().receipts,current().calls);
      assert.match(await text(),/Market evaluation/);assert.doesNotMatch(await text(),/realised profit|proven demand/i);
      await capture('05-honest-native-result');
      await page.getByRole('button',{name:'Stop research',exact:true}).click();
      // Pending is named "Stopping…". Wait for the settled, disabled control
      // after the natural refresh so reload cannot cancel the Stop action.
      await page.getByRole('button',{name:'Stop research',exact:true,disabled:true}).waitFor();
      await page.reload();
      await page.getByRole('heading',{name:'Needs more evidence',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Stop research',exact:true}).isDisabled(),true);
      assert.equal(current().calls.length,5);
    });
    await check('consumed one-scope allowance stays blocked until an explicit revision of the same root',async()=>{
      await page.goto(`${origin}/dashboard/quests/research?business=${current().businessId}&quest=${goalId}`);
      await page.getByRole('heading',{name:'Continue research from a closed episode',exact:true}).waitFor();
      const exhausted=await catalog(goalId);assert.equal(exhausted.profiles.length,0);
      assert.equal(await page.getByRole('button',{name:'Prepare continuation packet',exact:true}).count(),0);
      assert.match(await text(),/Research preparation is technically unavailable/);
      assert.equal(current().calls.length,5);await capture('08-exhausted-one-scope-allowance');
      const oldGrant=current().continuationGrantId,root=current().grantRootId;
      await extendOwnerInitialNextAllowance(current());
      assert.equal(current().grantRootId,root);assert.equal(current().grantRootRevision.rootId,root);
      assert.equal(current().calls.length,5,'Operator approval itself makes no provider call');
      await page.reload();await page.getByLabel('Reviewed research profile',{exact:true}).waitFor();
      const renewed=await catalog(goalId);assert.ok(renewed.profiles.some(row=>row.grantId===current().continuationGrantId));
      assert.ok(!renewed.profiles.some(row=>row.grantId===oldGrant),'Old exhausted grant does not inherit the extension');
    });
    let episodeOne;
    await check('same saved Quest offers a finite continuation packet from its exact closed predecessor',async()=>{
      const initialScopeId=receipt.scopeId;
      await page.goto(`${origin}/dashboard/quests/research?business=${current().businessId}&quest=${goalId}`);
      await page.getByRole('heading',{name:'Continue research from a closed episode',exact:true}).waitFor();
      const before=await catalog(goalId);
      assert.equal(before.goal.id,goalId);assert.equal(before.goal.continuation.eligible,true,before.goal.continuation.reason);
      assert.equal(before.goal.continuation.predecessorClosure.predecessorScopeId,initialScopeId);
      assert.ok(before.profiles.find(row=>row.grantId===current().continuationGrantId)?.continuationBounds);
      await choose(current().continuationGrantId);await page.getByRole('button',{name:'Prepare continuation packet',exact:true}).click();
      await page.getByRole('heading',{name:'Review this exact research packet',exact:true}).waitFor();
      episodeOne=(await catalog(goalId)).setups.find(setup=>setup.preview.version==='r12.owner-research-episode-preview.1');
      assert.ok(episodeOne);assert.equal(episodeOne.preview.episodeNumber,1);
      assert.equal(episodeOne.preview.predecessorClosure.predecessorScopeId,initialScopeId);
      assert.equal(episodeOne.preview.predecessorClosureHash,before.goal.continuation.predecessorClosureHash);
      assert.deepEqual(episodeOne.preview.grantRootRevision,current().grantRootRevision);
      assert.match(await page.getByRole('link',{name:'View previous research and result',exact:true}).first().getAttribute('href'),new RegExp(`selected=${initialScopeId}`));
      assert.equal(episodeOne.activated,false);assert.equal(current().calls.length,5,'Preparation cannot call the provider');
      assert.match(await text(),/Planned Quest total including this new maximum/);
      assert.match(await text(),/does not cover Exa/);await capture('08-episode-one-exact-packet');
      await page.getByRole('heading',{name:'Approved cumulative research allowance',exact:true}).scrollIntoViewIfNeeded();
      assert.match(await text(),/Earlier consumed allocations remain counted/);await capture('08-grant-revision-desktop');
    });
    await check('continuation consent and exact packet survive mobile keyboard, history, reload and real 200 percent zoom',async captureFailure=>{
      await page.setViewportSize({width:320,height:800});
      await page.getByRole('heading',{name:'Approved cumulative research allowance',exact:true}).scrollIntoViewIfNeeded();await capture('09-episode-one-packet-320');
      await page.screenshot({path:path.join(output,'09-grant-revision-mobile-viewport.png'),fullPage:false});
      const consent=()=>page.getByRole('checkbox',{name:/I reviewed this exact packet/});
      await consent().scrollIntoViewIfNeeded();await consent().focus();await page.keyboard.press('Space');assert.equal(await consent().isChecked(),true);
      await page.keyboard.press('Space');assert.equal(await consent().isChecked(),false);
      const exact=page.url();await page.reload();await consent().waitFor();assert.equal(await consent().isChecked(),false);
      await page.getByRole('link',{name:'Choose another Quest',exact:true}).click();await page.waitForURL(url=>!url.searchParams.has('quest'));
      await page.goBack();await page.waitForURL(exact);await consent().waitFor();assert.equal(await consent().isChecked(),false);
      await page.setViewportSize({width:1280,height:720});
      const zoom=await actualZoomBrowser();let zoomPage;
      try{
        await zoom.context.route('**/*',route=>{const url=new URL(route.request().url());if(['http:','https:'].includes(url.protocol)&&url.origin!==origin){external.push(url.origin);return route.abort('blockedbyclient');}return route.continue();});
        zoomPage=await zoom.context.newPage();zoomPage.on('pageerror',error=>errors.push(String(error)));await zoomPage.goto(exact);assert.equal(await zoom.set(zoomPage,2),2);
        const zoomConsent=zoomPage.getByRole('checkbox',{name:/I reviewed this exact packet/});await zoomConsent.scrollIntoViewIfNeeded();await zoomConsent.focus();await zoomPage.keyboard.press('Space');assert.equal(await zoomConsent.isChecked(),true);
        await zoomPage.keyboard.press('Space');assert.equal(await zoomConsent.isChecked(),false);
        const confirm=zoomPage.getByRole('button',{name:'Confirm this exact research policy',exact:true});
        await captureOwnerZoomViewport({page:zoomPage,target:confirm,output,name:'owner-episode-controls-zoom200.png'});
        await captureOwnerZoomViewport({page:zoomPage,target:zoomPage.getByRole('heading',{name:'Approved cumulative research allowance',exact:true}),output,name:'owner-grant-revision-zoom200.png'});
        const geometry=await zoomPage.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth}));assert.ok(geometry.documentWidth<=geometry.width+1);
      }catch(error){if(zoomPage)await captureFailure(zoomPage);throw error;}finally{await zoom.close();}
      assert.equal(current().calls.length,5);
    });
    await check('Stop before the first continuation call consumes its episode without provider work',async()=>{
      await page.getByRole('checkbox',{name:/I reviewed this exact packet/}).check();
      await page.getByRole('button',{name:'Confirm this exact research policy',exact:true}).click();
      await page.getByRole('link',{name:'Open research workspace for Continue / Stop',exact:true}).waitFor();
      episodeOne=(await catalog(goalId,episodeOne.setupId)).setups[0];assert.equal(episodeOne.activated,true);
      assert.equal(current().calls.length,0);
      await page.getByRole('button',{name:'Stop this research setup',exact:true}).click();
      await page.getByText('Saved setup status: stopped.',{exact:true}).waitFor();
      assert.equal(current().calls.length,0);
      await page.reload();assert.equal((await catalog(goalId,episodeOne.setupId)).setups[0].stopped,true);
      await capture('10-episode-one-stopped-before-call');
    });
    await check('second finite continuation episode runs the real five-phase engine once with one collection',async()=>{
      await page.goto(`${origin}/dashboard/quests/research?business=${current().businessId}&quest=${goalId}`);
      await page.getByRole('heading',{name:'Continue research from a closed episode',exact:true}).waitFor();
      const before=await catalog(goalId);assert.equal(before.goal.continuation.predecessorClosure.predecessorScopeId,episodeOne.scopeId);
      await choose(current().continuationGrantId);await page.getByRole('button',{name:'Prepare continuation packet',exact:true}).click();
      await page.getByRole('heading',{name:'Review this exact research packet',exact:true}).waitFor();
      const second=(await catalog(goalId)).setups.find(setup=>setup.preview.version==='r12.owner-research-episode-preview.1'&&setup.preview.episodeNumber===2);
      assert.ok(second);assert.equal(second.preview.predecessorClosure.predecessorScopeId,episodeOne.scopeId);
      await page.getByRole('checkbox',{name:/I reviewed this exact packet/}).check();
      await page.getByRole('button',{name:'Confirm this exact research policy',exact:true}).click();
      await page.getByRole('link',{name:'Open research workspace for Continue / Stop',exact:true}).click();
      await page.getByRole('button',{name:'Continue approved research',exact:true}).click();
      await page.getByRole('heading',{name:'Needs more evidence',exact:true}).waitFor({timeout:90000});
      assert.deepEqual(current().calls,['plan','search1','select1','strategy','review']);
      assert.equal(current().calls.filter(phase=>phase==='search1').length,1);
      assert.deepEqual(current().receipts,current().calls);
      assert.match(await text(),/Earlier outcomes, costs and limits remain preserved/);
      assert.doesNotMatch(await text(),/proven demand/i);
      await capture('11-episode-two-honest-result');
      await page.reload();await page.getByRole('heading',{name:'Needs more evidence',exact:true}).waitFor();
      assert.equal(current().calls.length,5);
    });
    await control('legacy');
    await check('legacy packet retains prior costs and explicitly confirms an append-only cumulative funding increase',async()=>{
      goalId=current().goalId;await page.goto(`${origin}/dashboard/quests/research?business=${current().businessId}&quest=${goalId}`);await choose();
      assert.equal(await page.getByLabel('Proposed original cumulative research limit (USD)',{exact:true}).inputValue(),'2.000000');
      await page.getByLabel('Proposed original cumulative research limit (USD)',{exact:true}).fill('2.500000');
      await page.getByRole('button',{name:'Prepare exact research packet',exact:true}).click();await page.getByRole('heading',{name:'Review this exact research packet',exact:true}).waitFor();
      assert.match(await text(),/USD 1\.900000/);assert.match(await text(),/USD 2\.000000/);assert.match(await text(),/USD 2\.500000/);assert.match(await text(),/Every prior cost remains/);await capture('06-legacy-cumulative-extension');
      receipt=(await catalog(goalId)).setups[0];assert.equal(receipt.preview.funding.committedMicrounits,'1900000');
      await page.getByRole('checkbox',{name:/I reviewed this exact packet/}).check();await page.getByRole('button',{name:'Confirm this exact research policy',exact:true}).click();await page.getByRole('link',{name:'Open research workspace for Continue / Stop',exact:true}).waitFor();
      const saved=await catalog(goalId,receipt.setupId);assert.equal(saved.setups[0].activated,true);assert.equal(saved.funding.maximumMicrounits,'2000000','Exact saved packet preserves its before-confirm snapshot');const effective=await catalog(goalId);assert.equal(effective.funding.maximumMicrounits,'2500000');assert.equal(effective.funding.committedMicrounits,'1900000');assert.deepEqual(current().calls,[]);
      await page.getByRole('button',{name:'Stop this research setup',exact:true}).click();await page.getByText('Saved setup status: stopped.',{exact:true}).waitFor();assert.deepEqual(current().calls,[]);
      await page.reload();assert.equal(await page.getByRole('button',{name:'Stop this research setup',exact:true}).count(),0);await capture('07-stopped-before-provider');
    });
    assert.deepEqual(external,[]);assert.deepEqual(errors,[]);await report();
  } finally {await context.close();await browser.close();await report();}
}
