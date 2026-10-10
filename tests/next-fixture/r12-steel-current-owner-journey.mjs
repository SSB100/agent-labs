/** Current production owner pages and Next actions, with real migrated SQL.
 * Provider/browser leaves and workflow hosting stay inert. The operator fixture
 * callback is deliberately outside the owner HTTP API and cannot be invoked by
 * an owner form. It publishes only after the actual metadata action saved proof. */
import assert from 'node:assert/strict';
export async function runCurrentSteelOwnerBrowserJourney({page,origin,businessId,goalId,grantId,diagnostics,publishReviewedAuthority,executeCycle,capture}){
 const blocked=[];await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin===origin)return route.continue();
  // The private viewer is an inert fixture document; never contact Steel/Etsy.
  if(url.origin==='https://api.steel.dev'&&/^\/v1\/sessions\/[a-f0-9-]+\/player$/.test(url.pathname))return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Inert owner sign-in fixture</title><p>No credentials or real account used.</p>'});
  blocked.push(url.origin);return route.abort('blockedbyclient');
 });
 const click=async name=>{const before=page.url();await Promise.all([page.waitForURL(url=>url.href!==before,{waitUntil:'domcontentloaded'}),page.getByRole('button',{name,exact:true}).click()]);};
 await page.goto(`${origin}/dashboard/products/etsy-research?business=${businessId}&goal=${goalId}`);
 assert.equal((await diagnostics()).newGrants,0);assert.equal((await diagnostics()).providerCreates,0);assert.equal((await diagnostics()).readbackStatus,'ready');
 await click('Verify configured Steel project');assert.match(await page.locator('main').innerText(),/configured Steel project matched the reviewed target/);
 await page.reload();assert.equal((await diagnostics()).metadataGets,1);assert.equal((await diagnostics()).configurationPermits,0);assert.equal((await diagnostics()).newGrants,0);
 assert.equal(await page.getByRole('button',{name:'Prepare grant extension review',exact:true}).count(),0);
 await capture?.('metadata-verified');
 // Trusted test-operator callback, no owner HTTP endpoint or owner publisher privilege.
 const publication=await publishReviewedAuthority();assert.equal((await diagnostics()).ownerHasPublisherPrivilege,false);
 await page.goto(`${origin}/dashboard/products/etsy-research?business=${businessId}&goal=${goalId}`);
 await page.getByLabel('Independently reviewed package').selectOption(publication.reviewedPackageHash);await click('Prepare grant extension review');
 await page.getByRole('heading',{name:'Exact saved grant extension',exact:true}).waitFor();assert.match(await page.locator('main').innerText(),/Consumed allocations are retained/);assert.equal((await diagnostics()).newGrants,0);
 await page.getByLabel('Confirm this exact finite grant extension and retained cumulative allocations.').check();await click('Confirm reviewed grant extension');
 assert.equal((await diagnostics()).newGrants,1);assert.equal((await diagnostics()).providerCreates,0);
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
 const preview=await page.locator('main').innerText();for(const text of ['anthropic/claude-sonnet-4.6','anthropic/claude-4.6-sonnet-20260217','Amazon Bedrock','amazon-bedrock/us','Quoted maximum liabilities'])assert.ok(preview.includes(text),text);
 await page.getByLabel('Approve the exact source, recipient, quoted route and bounded research preview.').check();await click('Confirm and start research');await page.getByRole('heading',{name:'Recorded progress',exact:true}).waitFor();
 const cycle=await executeCycle(envelopeId);assert.equal(cycle.modelRequests,3);assert.equal(cycle.providerCreates,3);assert.equal(cycle.configurationUses,3);assert.equal(cycle.metadataGets,1);assert.equal(cycle.savedProofReused,true);
 await page.reload();const progress=await page.locator('main').innerText();assert.match(progress,/Confirmed actual: \$0\.000003 USD/);assert.match(progress,/Still reserved for pending charges: \$0\.003000 USD/);assert.match(progress,/Model calls: 3/);assert.match(progress,/Source operations: 1/);
 await page.locator('summary').filter({hasText:/Attempt 1 · completed/}).click();
 await page.getByText('The descriptive result is concrete but the hypothesis remains unmeasured.',{exact:true}).waitFor({state:'visible'});
 await capture?.('source-review-completed');
 await click('Stop this test');assert.equal((await diagnostics()).stopped,true);assert.equal(blocked.length,0);
 return{version:'r12.steel-current-owner-browser-journey.1',envelopeId,metadataViaActualNextAction:true,enrollmentViaActualNextActions:true,newGrantSeeded:false,operatorPublicationOutsideOwnerApi:true,cycle,actualNextActions:true,realBrowser:true,providerTransport:'inert',liveAccess:false};
}
