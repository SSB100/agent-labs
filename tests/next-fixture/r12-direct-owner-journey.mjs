/** Focused real-browser scenario for a Next fixture seeded by
 * ownerJourneyAuthority. The host must inject the same inert provider leaves,
 * retain actual pages/actions and migrated SQL, and expose read-only diagnostics.
 * This module never launches Chromium or permits provider-origin requests. */
import assert from 'node:assert/strict';
export async function runDirectOwnerBrowserJourney({page,origin,businessId,goalId,grantId,diagnostics}){
 const blocked=[];await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin===origin)return route.continue();
  // The private viewer is an inert fixture document; never contact Steel/Etsy.
  if(url.origin==='https://api.steel.dev'&&/^\/v1\/sessions\/[a-f0-9-]+\/player$/.test(url.pathname))return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Inert owner sign-in fixture</title><p>No credentials or real account used.</p>'});
  blocked.push(url.origin);return route.abort('blockedbyclient');
 });
 const click=async name=>{const before=page.url();await Promise.all([page.waitForURL(url=>url.href!==before,{waitUntil:'domcontentloaded'}),page.getByRole('button',{name,exact:true}).click()]);};
 await page.goto(`${origin}/dashboard/products/etsy-research?business=${businessId}&goal=${goalId}`);
 await page.getByLabel('Reviewed grant').selectOption(grantId);await page.getByLabel('Combined test ceiling (USD)').fill('10');await page.getByLabel('Total test attempts').fill('10');await click('Prepare exact test review');
 await page.getByRole('heading',{name:'Saved test envelope',exact:true}).waitFor();const envelopeId=new URL(page.url()).searchParams.get('envelope');assert.ok(envelopeId);
 assert.match(await page.locator('main').innerText(),/Combined ceiling: \$10\.000000 USD/);assert.equal((await diagnostics()).providerCreates,0);
 await page.getByLabel('Confirm this exact bounded test and displayed cumulative funding amendments.').check();await click('Confirm test envelope');
 await page.getByLabel('Exact Etsy shop name').fill('SyntheticShop');await click('Review recorded sign-in and persistent access');
 await page.getByRole('heading',{name:'Review your Steel browser connection',exact:true}).waitFor();assert.match(await page.locator('main').innerText(),/reusable browser authentication profile/);assert.equal((await diagnostics()).providerCreates,0);
 await page.getByLabel('I approve this recorded owner sign-in, the scoped verification, and the disclosed persistent Etsy read access.').check();await click('Approve reviewed access');
 await page.getByRole('button',{name:'Start approved private sign-in',exact:true}).waitFor();await click('Start approved private sign-in');
 const iframe=page.getByTitle('Owner-controlled Etsy sign-in in Steel');await iframe.waitFor();assert.equal(await iframe.getAttribute('referrerpolicy'),'no-referrer');
 await click('I have finished signing in');await page.getByRole('status').filter({hasText:'Account verification: verified'}).waitFor();
 const verified=await diagnostics();assert.equal(verified.providerCreates,2);assert.equal(verified.querySubmits,0);assert.equal(verified.accountVerified,true);assert.equal(verified.cleanupPending,false);
 await page.goto(`${origin}/dashboard/products/etsy-research?business=${businessId}&goal=${goalId}&envelope=${envelopeId}`);
 assert.match(await page.locator('main').innerText(),/Still reserved for pending charges: \$0\.002000 USD/);
 await page.getByLabel('Initial Etsy search').fill('astronomy gifts');await page.getByLabel('Unresolved question').fill('Which astronomy gift wording is visible?');await page.getByLabel('What new information would answer it?').fill('Compare the literal search display for this exact wording.');await page.getByLabel('Opposing explanation to check').fill('Check whether aggregate results leave commercial demand unknown.');await click('Prepare research and data-sharing review');
 await page.getByRole('heading',{name:'Exact saved research preview',exact:true}).waitFor();assert.match(await page.locator('main').innerText(),/Saved Etsy query[\s\S]*astronomy gifts/);
 await page.getByLabel('Approve the exact source, recipient, quoted route and bounded research preview.').check();await click('Confirm and start research');await page.getByRole('heading',{name:'Recorded progress',exact:true}).waitFor();
 await click('Stop this test');assert.equal((await diagnostics()).stopped,true);assert.equal(blocked.length,0);
 return{version:'r12.direct-owner-browser-journey.1',envelopeId,actualNextActions:true,realBrowser:true,providerTransport:'inert',liveAccess:false};
}
