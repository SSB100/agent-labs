import assert from 'node:assert/strict';
import path from 'node:path';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import sharp from 'sharp';
import {saveEtsyCaptureThroughOwnerUi} from './r12-etsy-intake-journey.mjs';
import {snapshotConfirmedEtsyBranch} from './r12-etsy-branch.mjs';
import {r12OwnerRpc} from './r12-sql.mjs';
import {actualZoomBrowser} from './browser-zoom.mjs';
import {extendOwnerInitialNextAllowance,enrollAdaptiveOwnerNextAllowance} from './r12-owner-initial.mjs';

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
  const results=[],external=[],errors=[];let browserStatus='not started',page,technicalScenario='ordinary-owner-lineage';
  const report=()=>writeFile(path.join(output,'acceptance.json'),JSON.stringify({results,external,errors,browser:browserStatus,boundary:'isolated SQL and synthetic provider transport only'},null,2));
  const check=async(name,work)=>{
    console.log('START:',name);let failure;
    const captureFailure=async target=>{try{failure={artifacts:await captureOwnerJourneyFailure({page:target,output,stage:name,index:results.length+1})};}catch(error){failure={diagnosticError:String(error).slice(0,2000)};}};
    try{await work(captureFailure);results.push({name,status:'passed',technicalScenario});console.log('PASS:',name);}
    catch(error){if(!failure)await captureFailure(page);results.push({name,status:'failed',technicalScenario,error:String(error.stack??error),...failure});await report();throw error;}
    await report();
  };
  const control=async(kind)=>{const response=await fetch(boundary.origin+'/control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({r12Scenario:`owner-initial-${kind}`,r12DelayReceipt:false}),signal:AbortSignal.timeout(90000)});assert.equal(response.status,200,await response.text());};
  const current=()=>boundary.state().r12;
  const catalog=async(goalId=current().goalId,setupId=null)=>{const result=await r12OwnerRpc(boundary.state(),'r12_owner_research_read',{p_business_id:current().businessId,p_goal_id:goalId,p_setup_id:setupId});assert.equal(result.error,null);return result.data;};
  const adaptiveCatalog=async(goalId=current().goalId,setupId=null)=>{const result=await r12OwnerRpc(boundary.state(),'r12_owner_adaptive_read',{p_business_id:current().businessId,p_goal_id:goalId,p_setup_id:setupId});assert.equal(result.error,null);return result.data;};
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
  const waitUntil=async(condition,description,timeoutMs=90000)=>{const until=Date.now()+timeoutMs;while(Date.now()<until){if(await condition())return;await new Promise(resolve=>setTimeout(resolve,250));}throw Error(`Timed out waiting for ${description}`);};
  let goalId,receipt,adaptiveReceipt,ownerCapture,startReceiptBranch;
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
      await page.getByRole('button',{name:'Stop research',exact:true}).click();
      await page.getByRole('button',{name:'Stop research',exact:true,disabled:true}).waitFor();
      await page.reload();await page.getByRole('heading',{name:'Needs more evidence',exact:true}).waitFor();
      assert.equal(current().calls.length,5);
      const predecessorRows=(await current().db.query(`select a.step_key,r.content->'result' result,ar.content artifact,a.dependency_pins,q.payload request
        from private.r07_heads h join private.r07_attempts a on a.plan_id=h.plan_id and a.business_id=h.business_id
        join private.r07_responses r on r.attempt_id=a.id and r.business_id=a.business_id
        join public.artifacts ar on ar.id=r.artifact_id and ar.business_id=r.business_id
        left join private.r07_bindings bind on bind.attempt_id=a.id and bind.business_id=a.business_id
        left join private.r05_requests q on q.id=bind.request_id and q.business_id=bind.business_id
        where h.goal_id=$1 and a.step_key in ('select1','strategy','review') order by a.step_key`,[goalId])).rows;
      const keys=value=>value&&typeof value==='object'&&!Array.isArray(value)?Object.keys(value).sort():[];
      console.log('PREDECESSOR_SAVED_FIELD_KEYS:',JSON.stringify(predecessorRows.map(row=>({phase:row.step_key,result:keys(row.result),artifact:keys(row.artifact),artifactResult:keys(row.artifact?.result),dependencyPins:Array.isArray(row.dependency_pins)?row.dependency_pins.map(keys):[],request:keys(row.request)}))));
    });
    await check('owner revises the same saved Quest budget from USD 2 to USD 10 after closed research',async()=>{
      const latestGoal=async()=>(await current().db.query('select v.revision,v.content_hash,v.preference,v.content from private.r04_goal_state s join private.r04_goal_versions v on v.goal_id=s.goal_id and v.business_id=s.business_id and v.revision=s.revision where s.goal_id=$1',[goalId])).rows[0];
      const before=await latestGoal();
      assert.ok(['draft','ready'].includes(before.preference));
      const beforeCalls=[...current().calls],beforeReceipts=[...current().receipts];
      await page.goto(`${origin}/dashboard/quests?business=${current().businessId}&quest=${goalId}`);
      await page.getByRole('heading',{name:`Technical owner-created astronomy research · version ${before.revision}`,exact:true}).waitFor();
      await page.getByRole('button',{name:'Edit as a new Quest version',exact:true}).click();
      const revised='Target 1 units; budget USD 10; deadline: 2027-12-31T23:59:00Z; geography: United Kingdom; scope: original POD T-shirt research; stop if costs rise. Synthetic technical objective; no demand claim.';
      await page.getByRole('textbox',{name:'Your Quest in plain language',exact:true}).fill(revised);
      await page.getByRole('checkbox',{name:/I reviewed the extracted facts and unresolved items/}).check();
      await page.getByRole('button',{name:'Save Quest draft',exact:true}).click();
      await page.getByRole('heading',{name:`Technical owner-created astronomy research · version ${before.revision+1}`,exact:true}).waitFor();
      const drafted=await latestGoal();
      assert.equal(drafted.revision,before.revision+1);assert.notEqual(drafted.content_hash,before.content_hash);
      assert.match(drafted.content.originalIntent,/budget USD 10/);
      if(drafted.preference!=='ready'){
        await page.getByText('Record lifecycle preference',{exact:true}).click();
        await page.getByRole('button',{name:'ready',exact:true}).click();
        await page.getByRole('heading',{name:`Technical owner-created astronomy research · version ${drafted.revision+1}`,exact:true}).waitFor();
      }
      const after=await latestGoal();
      assert.equal(after.preference,'ready');assert.ok(after.revision>before.revision);
      assert.deepEqual(current().calls,beforeCalls);assert.deepEqual(current().receipts,beforeReceipts);
      const stillSame=(await catalog(goalId)).goal;assert.equal(stillSame.id,goalId);
      await capture('11a-same-quest-budget-revised');
    });
    await check('ordinary owner saves reviews and explicitly selects an immutable Etsy comparison without a grant or provider call',async()=>{
      await page.goto(`${origin}/dashboard/quests/research?business=${current().businessId}&quest=${goalId}`);
      ownerCapture=await saveEtsyCaptureThroughOwnerUi({page,boundary});
      assert.equal((await adaptiveCatalog(goalId)).grants.length,0,'Owner capture intake is independent of special grant enrollment');
      await capture('11b-ordinary-etsy-capture-selected');
      await page.setViewportSize({width:320,height:800});await capture('11c-etsy-capture-mobile');await page.setViewportSize({width:1280,height:720});
    });
    await check('inert operator enrollment exposes only a fresh reviewed adaptive grant on the exhausted root',async()=>{
      const lineage=(await current().db.query(`select x.version,x.content->>'format' format,sc.origin,
        x.content_hash=private.r04_hash(x.content) plan_hash_ok,
        sc.amendment_hash=private.stage14_hash(sc.amendment) scope_hash_ok,
        x.content->>'discoveryScopeHash'=sc.amendment_hash plan_scope_ok,
        q.scope_id is not null authority_present,q.plan=x.content authority_plan_ok,q.plan_hash=x.content_hash authority_hash_ok,
        pol.id is not null policy_present,pol.content_hash=x.content->>'policyHash' policy_hash_ok,
        exists(select 1 from private.r05_revocations z where z.policy_id=x.policy_id and z.business_id=x.business_id) policy_revoked,
        exists(select 1 from private.r07_server_revocations z where z.key_hash=q.controller_key_hash)
          or exists(select 1 from private.r07_server_keys k where k.key_hash=q.controller_key_hash and k.expires_at<=clock_timestamp()) controller_closed,
        exists(select 1 from private.r05_server_revocations z where z.key_hash=q.admission_key_hash)
          or exists(select 1 from private.r05_server_keys k where k.key_hash=q.admission_key_hash and k.expires_at<=clock_timestamp()) admission_closed,
        (select count(*) from private.r07_plans z where z.business_id=$1 and z.goal_id=$2) total_plans
        from private.r07_plans x left join private.r12_discovery_scopes sc on sc.id=(x.content->>'discoveryScopeId')::uuid
        left join private.r12_discovery_authorities q on q.scope_id=sc.id left join private.r05_policies pol on pol.id=x.policy_id
        where x.business_id=$1 and x.goal_id=$2 order by x.version`,[current().businessId,goalId])).rows;
      console.log('PREDECESSOR_LINEAGE_BOOLS:',JSON.stringify(lineage));
      let closure;
      try {closure=(await current().db.query('select private.r12_owner_episode_predecessor($1,$2) result',[current().businessId,goalId])).rows[0].result;}
      catch(error){throw Error(`Exact late-Goal predecessor probe failed: ${String(error.message??error)}`);}
      assert.ok(closure?.predecessorPlanId,'Exact late-Goal predecessor probe returned no saved plan');
      try {await current().db.query('select private.r12_adaptive_imports($1,true) result',[closure.predecessorPlanId]);}
      catch(error){throw Error(`Exact historical-import probe failed: ${String(error.message??error)}`);}
      const before=await adaptiveCatalog(goalId);assert.equal(before.businessId,current().businessId);assert.equal(before.goalId,goalId);
      assert.equal(before.grants.length,0,'Old owner grants cannot silently authorize adaptive research');
      const enrolled=await enrollAdaptiveOwnerNextAllowance(current(),goalId);
      const after=await adaptiveCatalog(goalId);assert.equal(after.eligible,true,after.reason);
      assert.equal(current().adaptiveProfile.version,'r12.owner-research-profile.3');
      assert.deepEqual(current().adaptiveProfile.allowedDomains,['etsy.com']);
      assert.deepEqual(current().adaptiveProfile.excludedDomains,['etsy.com','etsy.me','etsystatic.com']);
      assert.equal(current().adaptiveProfile.sourceReviews[0].basis,'owner_reported_capture');
      assert.equal(after.profiles.find(row=>row.profile.id===enrolled.profileId)?.profileHash,enrolled.profileHash);
      assert.equal(after.grants.find(row=>row.id===enrolled.grantId)?.maximumRunMicrounits,'10000000');
      assert.equal(after.predecessorClosure.predecessorScopeId,current().scopeId);
      assert.equal(current().calls.length,5,'Operator enrollment does not dispatch a provider call');
    });
    await check('normal owner page prepares the exact adaptive packet without a paid action',async()=>{
      await page.goto(`${origin}/dashboard/quests/research?business=${current().businessId}&quest=${goalId}`);
      await page.getByRole('heading',{name:'Adaptive research from saved evidence',exact:true}).waitFor();
      assert.equal(await page.getByText(/This exact Business, Quest or setup could not be verified/).count(),0,'Adaptive profile enrollment must preserve the original owner catalog');
      const profile=page.getByLabel('Reviewed profile and finite grant',{exact:true}),expected=`${current().adaptiveProfileId}:${current().adaptiveGrantId}`;
      await profile.locator('option').filter({hasText:'Inert reviewed Etsy owner-capture research'}).waitFor({state:'attached'});
      const options=await profile.locator('option').evaluateAll(nodes=>nodes.map(node=>node.value));
      const currentCatalog=await adaptiveCatalog(goalId);
      assert.ok(options.includes(expected),`Adaptive option mismatch: ${JSON.stringify({expected,options,profiles:currentCatalog.profiles.map(row=>row.profile.id),grants:currentCatalog.grants.map(row=>({id:row.id,profileId:row.profileId}))})}`);
      await profile.selectOption(expected);
      await page.getByLabel('Goal market comparison',{exact:true}).selectOption('gb');
      await page.getByLabel('Reviewed topic and adult audience',{exact:true}).selectOption('astronomy');
      const captureSelector=page.getByLabel('Reviewed immutable capture bundle',{exact:true});
      await captureSelector.locator(`option[value="${ownerCapture.id}"]`).waitFor({state:'attached'});
      assert.equal(await page.getByRole('button',{name:'Prepare adaptive research packet',exact:true}).isDisabled(),true,'No capture is implicitly selected after navigation');
      await captureSelector.selectOption(ownerCapture.id);
      await page.getByRole('button',{name:'Prepare adaptive research packet',exact:true}).click();
      await page.getByRole('heading',{name:'Review this exact adaptive research packet',exact:true}).waitFor();
      adaptiveReceipt=(await adaptiveCatalog(goalId)).setups[0];assert.ok(adaptiveReceipt);
      assert.equal(adaptiveReceipt.confirmed,false);assert.equal(adaptiveReceipt.activated,false);assert.equal(adaptiveReceipt.actions.length,0);
      assert.equal(adaptiveReceipt.preview.maximumRunMicrounits,'10000000');
      assert.equal(adaptiveReceipt.preview.predecessor.predecessorScopeId,current().scopeId);
      assert.equal(new URL(page.url()).searchParams.get('adaptiveSetup'),adaptiveReceipt.setupId);
      assert.equal(adaptiveReceipt.quote.version,'r12.adaptive-quote.2');
      assert.deepEqual(Object.keys(adaptiveReceipt.quote.ceilings).sort(),['plan','review','strategy']);
      assert.equal(adaptiveReceipt.ownerObservationRef.manifest[0].bundleId,ownerCapture.id);
      await page.getByRole('heading',{name:'Retrospective comparison declaration',exact:true}).waitFor();
      assert.match(await text(),/No Exa or Etsy API request/);
      assert.match(await text(),/Conversion: Very low/);
      assert.match(await text(),/buyer geography unknown/);
      assert.match(await text(),/Known Quest cost before this run/);
      assert.equal(current().calls.length,5,'Preparation cannot dispatch a provider call');
      await capture('12-adaptive-exact-packet');
    });
    await check('adaptive packet survives mobile keyboard, history, reload and actual 200 percent zoom',async captureFailure=>{
      const exact=page.url(),consent=()=>page.getByRole('checkbox',{name:/I reviewed this exact adaptive packet/});
      await page.setViewportSize({width:320,height:800});await capture('13-adaptive-packet-mobile');
      await consent().scrollIntoViewIfNeeded();await consent().focus();await page.keyboard.press('Space');assert.equal(await consent().isChecked(),true);
      await page.keyboard.press('Space');assert.equal(await consent().isChecked(),false);
      await page.reload();await consent().waitFor();assert.equal(await consent().isChecked(),false);
      await page.getByRole('link',{name:'Choose another Quest',exact:true}).click();
      await page.goto(exact);await consent().waitFor();await page.goBack();await page.goForward();await page.waitForURL(exact);
      await consent().waitFor();assert.equal(await consent().isChecked(),false);
      await page.setViewportSize({width:1280,height:720});
      const zoom=await actualZoomBrowser();let zoomPage;
      try{
        await zoom.context.route('**/*',route=>{const url=new URL(route.request().url());if(['http:','https:'].includes(url.protocol)&&url.origin!==origin){external.push(url.origin);return route.abort('blockedbyclient');}return route.continue();});
        zoomPage=await zoom.context.newPage();zoomPage.on('pageerror',error=>errors.push(String(error)));await zoomPage.goto(exact);assert.equal(await zoom.set(zoomPage,2),2);
        const confirm=zoomPage.getByRole('button',{name:'Confirm this exact adaptive policy',exact:true});await confirm.scrollIntoViewIfNeeded();
        await captureOwnerZoomViewport({page:zoomPage,target:confirm,output,name:'owner-adaptive-confirm-zoom200.png'});
        await captureOwnerZoomViewport({page:zoomPage,target:zoomPage.getByRole('heading',{name:'Review this exact adaptive research packet',exact:true}),output,name:'owner-adaptive-packet-zoom200.png'});
        const geometry=await zoomPage.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth}));assert.ok(geometry.documentWidth<=geometry.width+1);
      }catch(error){if(zoomPage)await captureFailure(zoomPage);throw error;}finally{await zoom.close();}
      assert.equal(current().calls.length,5);
    });
    await check('adaptive confirmation admits its first decision without an implicit provider call',async()=>{
      await page.getByRole('checkbox',{name:/I reviewed this exact adaptive packet/}).check();
      await page.getByRole('button',{name:'Confirm this exact adaptive policy',exact:true}).click();
      await page.getByText(/Saved setup: authority activated/).waitFor();
      adaptiveReceipt=(await adaptiveCatalog(goalId,adaptiveReceipt.setupId)).setups[0];assert.equal(adaptiveReceipt.confirmed,true);
      assert.equal(adaptiveReceipt.activated,true);assert.deepEqual(adaptiveReceipt.actions.map(item=>item.action.ordinal),[0]);
      assert.equal(adaptiveReceipt.actions[0].action.kind,'initial');assert.equal(adaptiveReceipt.actions[0].state,'admitted');
      assert.equal(current().calls.length,5,'Admission is a saved decision, not a paid provider call');
      const run=page.getByRole('button',{name:'Run or resume approved adaptive research',exact:true}),stop=page.getByRole('button',{name:'Stop this adaptive setup',exact:true});
      assert.equal(await run.count(),1,'Run requires an intentional owner click after exact confirmation');
      await run.focus();await page.keyboard.press('Tab');
      const stopFocus=await stop.evaluate(node=>({focused:document.activeElement===node,visible:node.matches(':focus-visible'),outline:parseFloat(getComputedStyle(node).outlineWidth)}));
      assert.ok(stopFocus.focused&&stopFocus.visible&&stopFocus.outline>=2,'Keyboard Run to Stop path keeps a visible focus target');
      await capture('14-adaptive-activated-no-call');
      await page.setViewportSize({width:320,height:800});await stop.scrollIntoViewIfNeeded();await capture('14a-adaptive-activated-mobile');
      await page.setViewportSize({width:1280,height:720});
      const zoom=await actualZoomBrowser();
      try{
        await zoom.context.route('**/*',route=>{const url=new URL(route.request().url());if(['http:','https:'].includes(url.protocol)&&url.origin!==origin){external.push(url.origin);return route.abort('blockedbyclient');}return route.continue();});
        const zoomPage=await zoom.context.newPage();zoomPage.on('pageerror',error=>errors.push(String(error)));await zoomPage.goto(page.url());assert.equal(await zoom.set(zoomPage,2),2);
        await captureOwnerZoomViewport({page:zoomPage,target:zoomPage.getByRole('button',{name:'Run or resume approved adaptive research',exact:true}),output,name:'owner-adaptive-run-zoom200.png'});
      }finally{await zoom.close();}
      assert.equal(current().adaptiveCalls.length,0,'Confirmation admits no provider transport');
      assert.equal(current().adaptiveScope.version,'r12.discovery-owner-adaptive.2');
      assert.equal(current().adaptiveScope.intent.limits.maximumNewCollections,0);
      startReceiptBranch=await snapshotConfirmedEtsyBranch(boundary.state());
    });
    await check('one intentional Etsy Run makes three real inert calls and pauses before a missing-source follow-up',async()=>{
      technicalScenario='etsy-owner-missing-source';
      await page.getByRole('button',{name:'Run or resume approved adaptive research',exact:true}).click();
      await waitUntil(async()=>{if(await page.getByText('The saved adaptive run could not be advanced or verified. Reload its exact setup and review current authority, costs and findings before resuming.').count())throw Error('Etsy Run stopped before its three inert phases; inspect ADAPTIVE_RUNTIME_RPC_REJECTED');return (await adaptiveCatalog(goalId,adaptiveReceipt.setupId)).setups[0]?.actions[0]?.outcome==='NEEDS_MORE_EVIDENCE';},'independently saved Etsy NME result');
      const expected=[[0,'plan'],[0,'strategy'],[0,'review']];
      assert.deepEqual(current().adaptiveCalls.map(item=>[item.ordinal,item.phase]),expected);
      const pause=page.getByRole('status',{name:'Saved research pause',exact:true});await pause.waitFor();
      assert.match(await pause.innerText(),/selected Etsy captures cannot answer the next evidence question/);
      const pausedCatalog=await adaptiveCatalog(goalId,adaptiveReceipt.setupId);
      assert.equal(pausedCatalog.activation.pauseReason,'owner_source_operation_required');
      const latest=pausedCatalog.setups[0];assert.equal(latest.actions.length,1);
      assert.equal(latest.actions[0].outcome,'NEEDS_MORE_EVIDENCE');
      const denied=boundary.log.filter(item=>item.rpc==='r12_adaptive_controller_server'&&item.operation==='admit_next');
      assert.ok(denied.length>0,'Actual controller attempted the missing-source guard');
      await capture('15-etsy-three-role-missing-source-pause');
      for(let attempt=0;attempt<2;attempt++){
        const run=page.getByRole('button',{name:'Run or resume approved adaptive research',exact:true});
        const before=boundary.log.filter(item=>item.rpc==='r12_adaptive_controller_server'&&item.operation==='admit_next').length;
        await run.click();
        await waitUntil(async()=>boundary.log.filter(item=>item.rpc==='r12_adaptive_controller_server'&&item.operation==='admit_next').length>before&&!await run.isDisabled(),'repeated missing-source guard readback');
        await pause.waitFor();
        assert.deepEqual(current().adaptiveCalls.map(item=>[item.ordinal,item.phase]),expected,'Repeated Run cannot manufacture new channel observations');
      }
      await page.reload();await pause.waitFor();
      assert.equal((await adaptiveCatalog(goalId,adaptiveReceipt.setupId)).activation.pauseReason,'owner_source_operation_required');
      assert.deepEqual(current().adaptiveCalls.map(item=>[item.ordinal,item.phase]),expected);
      await page.getByRole('button',{name:'Stop this adaptive setup',exact:true}).click();await page.getByText(/Saved setup: stopped/).waitFor();
      assert.deepEqual(current().adaptiveCalls.map(item=>[item.ordinal,item.phase]),expected);
      await capture('15a-etsy-missing-source-stopped');
    });
    await check('independent confirmed fixture branch holds the initial Etsy review receipt without creating a follow-up',async()=>{
      // This second fresh database starts from the pre-send confirmation snapshot.
      // It is explicitly independent of the completed missing-source scenario.
      technicalScenario='independent-etsy-receipt-stop';
      const exact=page.url();await page.goto('about:blank');
      await startReceiptBranch(process.env.R12_SQL_TEST_HOST);
      const response=await fetch(boundary.origin+'/control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({r12HoldAdaptiveResponse:true,r12DelayAdaptiveReceipt:true}),signal:AbortSignal.timeout(10000)});assert.equal(response.status,200);
      await page.goto(exact);await page.getByRole('button',{name:'Run or resume approved adaptive research',exact:true}).click();
      await waitUntil(()=>boundary.heldAdaptiveResponses()===1,'saved initial Etsy review receipt held in flight');
      assert.deepEqual(current().adaptiveCalls.map(item=>[item.ordinal,item.phase]),[[0,'plan'],[0,'strategy'],[0,'review']]);
      const latest=(await adaptiveCatalog(goalId,adaptiveReceipt.setupId)).setups[0];assert.equal(latest.actions.length,1);
      await capture('16-independent-etsy-receipt-inflight');
      const stop=page.getByRole('button',{name:'Stop this adaptive setup',exact:true});
      assert.equal(await stop.isDisabled(),false,'Stop stays enabled during the in-flight receipt');
      // Pointer-clicking Run does not establish keyboard focus-visible modality.
      // Traverse from the next real control instead of programmatic Stop focus.
      await page.getByRole('link',{name:'Stable saved adaptive setup link',exact:true}).focus();
      await page.keyboard.press('Shift+Tab');
      const focus=await stop.evaluate(node=>{const rect=node.getBoundingClientRect();return {active:document.activeElement===node,visible:node.matches(':focus-visible'),outline:parseFloat(getComputedStyle(node).outlineWidth),left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height,viewportWidth:innerWidth,viewportHeight:innerHeight};});
      assert.ok(focus.active&&focus.visible&&focus.outline>=2&&focus.width>0&&focus.height>0&&focus.left>=0&&focus.right<=focus.viewportWidth&&focus.top>=0&&focus.bottom<=focus.viewportHeight,`Stop is keyboard reachable during the in-flight receipt: ${JSON.stringify(focus)}`);
      await page.setViewportSize({width:320,height:800});await stop.scrollIntoViewIfNeeded();await capture('16a-independent-etsy-action-history-mobile');
      await page.setViewportSize({width:1280,height:720});
    });
    await check('Stop during saved receipt wait blocks new sends and allows receipt-only recovery',async()=>{
      const before=current().adaptiveCalls.length;
      const stop=page.getByRole('button',{name:'Stop this adaptive setup',exact:true});
      assert.equal(await stop.isDisabled(),false);
      assert.ok(await stop.evaluate(node=>document.activeElement===node&&node.matches(':focus-visible')&&parseFloat(getComputedStyle(node).outlineWidth)>=2),'Keyboard Stop focus remains visible after responsive captures');
      await page.keyboard.press('Enter');
      await page.getByText(/Saved setup: stopped/).waitFor();
      assert.equal(current().adaptiveCalls.length,before,'Stop cannot start a fresh adaptive provider call');
      boundary.releaseAdaptiveResponses();
      await page.reload();await page.getByRole('heading',{name:'Saved adaptive setup history',exact:true}).waitFor();
      adaptiveReceipt=(await adaptiveCatalog(goalId,adaptiveReceipt.setupId)).setups[0];assert.equal(adaptiveReceipt.stopped,true);
      const pending=(await adaptiveCatalog(goalId,adaptiveReceipt.setupId)).activation;
      assert.equal(pending?.pendingReceiptReadback,true,'A stopped marked attempt keeps its saved receipt-only recovery path');
      const response=await fetch(boundary.origin+'/control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({r12DelayAdaptiveReceipt:false,r12ReleaseAdaptiveResponses:true}),signal:AbortSignal.timeout(10000)});assert.equal(response.status,200);
      const checkReceipts=page.getByRole('button',{name:'Check saved receipts',exact:true});await checkReceipts.waitFor();await checkReceipts.dblclick();
      await waitUntil(async()=>{const catalog=await adaptiveCatalog(goalId,adaptiveReceipt.setupId);return catalog.activation?.pendingReceiptReadback===false;},'saved receipt-only settlement',180000);
      assert.equal(current().adaptiveCalls.length,before,'Receipt-only recovery never resends a provider call');
      await page.reload();assert.equal(await page.getByRole('button',{name:'Run or resume approved adaptive research',exact:true}).count(),0);
      assert.equal(await page.getByRole('button',{name:'Check saved receipts',exact:true}).count(),0);
      const exact=page.url();await page.getByRole('link',{name:'Choose another Quest',exact:true}).click();await page.goBack();await page.waitForURL(exact);await page.reload();
      assert.equal(current().adaptiveCalls.length,before,'Reload and Back after receipt settlement cannot resend a paid call');
      assert.equal((await adaptiveCatalog(goalId,adaptiveReceipt.setupId)).activation?.pendingReceiptReadback,false);
      await capture('17-adaptive-stopped-receipt-history');
    });
    technicalScenario='ordinary-owner-legacy';
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
