import assert from 'node:assert/strict';
import path from 'node:path';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {r12OwnerRpc} from './r12-sql.mjs';
import {actualZoomBrowser} from './browser-zoom.mjs';

/** Real Next/React/authenticated owner actions and migrated isolated SQL.
 * All public catalogs, provider responses and receipts are synthetic engineering
 * evidence. This journey makes no business-purpose qualification claim. */
export async function runOwnerInitialJourney({origin,boundary,output}) {
  const results=[],external=[],errors=[];let browserStatus='not started';
  const report=()=>writeFile(path.join(output,'acceptance.json'),JSON.stringify({results,external,errors,browser:browserStatus,boundary:'isolated SQL and synthetic provider transport only'},null,2));
  const check=async(name,work)=>{console.log('START:',name);try{await work();results.push({name,status:'passed'});console.log('PASS:',name);}catch(error){results.push({name,status:'failed',error:String(error.stack??error)});await report();throw error;}await report();};
  const control=async(kind)=>{const response=await fetch(boundary.origin+'/control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({r12Scenario:`owner-initial-${kind}`,r12DelayReceipt:false}),signal:AbortSignal.timeout(90000)});assert.equal(response.status,200,await response.text());};
  const current=()=>boundary.state().r12;
  const catalog=async(goalId=current().goalId,setupId=null)=>{const result=await r12OwnerRpc(boundary.state(),'r12_owner_research_read',{p_business_id:current().businessId,p_goal_id:goalId,p_setup_id:setupId});assert.equal(result.error,null);return result.data;};
  let browser;
  try{browser=await chromium.launch({headless:true,...(process.env.GUIDED_UI_CHROMIUM_PATH?{executablePath:process.env.GUIDED_UI_CHROMIUM_PATH}:{}),args:['--no-sandbox']});browserStatus='actual Chromium';}
  catch(error){browserStatus='launch blocked; journeys unrun';results.push({name:'Launch isolated Chromium',status:'failed',error:String(error)});await report();throw error;}
  const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});
  context.setDefaultTimeout(30000);context.setDefaultNavigationTimeout(30000);
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(['http:','https:'].includes(url.protocol)&&url.origin!==origin){external.push(url.origin);return route.abort('blockedbyclient');}return route.continue();});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(String(error)));
  const text=()=>page.locator('main').innerText();
  const choose=async()=>{await page.getByLabel('Reviewed research profile',{exact:true}).selectOption(`${current().profileId}:${current().grantId}`);await page.getByLabel('Public market set',{exact:true}).selectOption('gb');await page.getByLabel('Public topic and adult audience',{exact:true}).selectOption('astronomy');await page.getByLabel('Proposed Business lifetime limit (USD)',{exact:true}).fill('6.000000');};
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
    await check('new owner packet supports real 200 percent browser zoom and keyboard consent without dispatch',async()=>{
      const zoom=await actualZoomBrowser();
      try{
        await zoom.context.route('**/*',route=>{const url=new URL(route.request().url());if(['http:','https:'].includes(url.protocol)&&url.origin!==origin){external.push(url.origin);return route.abort('blockedbyclient');}return route.continue();});
        const zoomPage=await zoom.context.newPage();zoomPage.on('pageerror',error=>errors.push(String(error)));await zoomPage.goto(page.url());assert.equal(await zoom.set(zoomPage,2),2);
        await zoomPage.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        const consent=zoomPage.getByRole('checkbox',{name:/I reviewed this exact packet/});await consent.scrollIntoViewIfNeeded();await consent.focus();await zoomPage.keyboard.press('Space');assert.equal(await consent.isChecked(),true);await zoomPage.keyboard.press('Space');assert.equal(await consent.isChecked(),false);
        const geometry=await zoomPage.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth}));assert.ok(geometry.width>=630&&geometry.width<=650,'Verify actual 2x browser zoom viewport');assert.ok(geometry.documentWidth<=geometry.width+1);
        const confirm=zoomPage.getByRole('button',{name:'Confirm this exact research policy',exact:true});await confirm.scrollIntoViewIfNeeded();const box=await confirm.boundingBox();assert.ok(box&&box.width>=100&&box.height>=43.5,'Zoomed confirmation stays reachable/readable');
        await zoomPage.screenshot({path:path.join(output,'owner-packet-controls-zoom200.png')});await zoomPage.getByRole('heading',{name:'Research a saved Quest',exact:true}).scrollIntoViewIfNeeded();await zoomPage.screenshot({path:path.join(output,'owner-packet-zoom200.png')});assert.deepEqual(current().calls,[]);
      }finally{await zoom.close();}
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
      await page.getByRole('button',{name:'Stop research',exact:true}).click();await page.reload();
      await page.getByRole('heading',{name:'Needs more evidence',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Stop research',exact:true}).isDisabled(),true);
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
