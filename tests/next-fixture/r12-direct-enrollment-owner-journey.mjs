/** Real Next enrollment actions precede the existing browser/account journey. */
import assert from 'node:assert/strict';
import {runDirectOwnerBrowserJourney} from './r12-direct-owner-journey.mjs';
export async function runDirectEnrollmentOwnerBrowserJourney({page,origin,businessId,goalId,grantId,reviewedPackageHash,diagnostics}){
 const confined=route=>new URL(route.request().url()).origin===origin?route.continue():route.abort('blockedbyclient');await page.route('**/*',confined);
 const click=async name=>{const before=page.url();await Promise.all([page.waitForURL(url=>url.href!==before,{waitUntil:'domcontentloaded'}),page.getByRole('button',{name,exact:true}).click()]);};
 await page.goto(`${origin}/dashboard/products/etsy-research?business=${businessId}&goal=${goalId}`);
 assert.equal((await diagnostics()).newGrants,0);assert.equal((await diagnostics()).providerCreates,0);
 await page.getByLabel('Independently reviewed package').selectOption(reviewedPackageHash);await click('Prepare grant extension review');
 await page.getByRole('heading',{name:'Exact saved grant extension',exact:true}).waitFor();assert.match(await page.locator('main').innerText(),/Consumed allocations are retained/);
 assert.equal((await diagnostics()).newGrants,0);
 await page.getByLabel('Confirm this exact finite grant extension and retained cumulative allocations.').check();await click('Confirm reviewed grant extension');
 assert.equal((await diagnostics()).newGrants,1);assert.equal((await diagnostics()).providerCreates,0);
 await page.unroute('**/*',confined);
 const report=await runDirectOwnerBrowserJourney({page,origin,businessId,goalId,grantId,diagnostics});
 const previewText=await page.locator('main').innerText();for(const text of ['anthropic/claude-sonnet-4.6','anthropic/claude-4.6-sonnet-20260217','Amazon Bedrock','amazon-bedrock/us','Quoted maximum liabilities','Complete research-window maximum:'])assert.ok(previewText.includes(text),text);
 return{...report,version:'r12.direct-enrollment-owner-browser-journey.1',enrollmentViaActualNextActions:true,newGrantSeeded:false,reviewedPackageHash};
}
