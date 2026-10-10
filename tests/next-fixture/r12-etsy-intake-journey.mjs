import assert from 'node:assert/strict';
import {r12OwnerRpc} from './r12-sql.mjs';

/** Actual hydrated owner form, not an injected JSON bundle or operator RPC. */
export async function saveEtsyCaptureThroughOwnerUi({page,boundary}) {
 const r=boundary.state().r12;
 const before=(await r.db.query('select (select count(*) from private.r12_adaptive_setups) setups,(select count(*) from private.r12_discovery_scopes) scopes')).rows[0];
 const region=page.getByRole('region',{name:'Etsy owner observations',exact:true});
 await region.getByText('Save a new Etsy capture',{exact:true}).click();
 const stamp=delta=>new Date(Date.now()+delta).toISOString().slice(0,16);
 await region.getByLabel('Product format',{exact:true}).fill('Original adult printed T-shirt');
 await region.getByLabel('Category',{exact:true}).fill('Adult apparel');
 await region.getByLabel('Reporting window starts (UTC)',{exact:true}).fill(stamp(-48*3600000));
 await region.getByLabel('Reporting window ends (UTC)',{exact:true}).fill(stamp(-24*3600000));
 await region.getByLabel('Account display locale',{exact:true}).fill('en-GB');
 await region.getByRole('checkbox',{name:/Declare a retrospective baseline/}).check();
 const queries=['Original astronomy star-chart shirt','Original astronomy lunar geometry shirt','Negative reference: plain adult shirt'];
 for(let index=0;index<queries.length;index++)await region.getByRole('button',{name:'Add capture',exact:true}).click();
 for(const [index,query]of queries.entries()){
  const row=region.getByRole('group',{name:`Capture ${index+1}${index===queries.length-1?' · negative/reference':''}`,exact:true});
  await row.getByLabel('Observed search term / hypothesis',{exact:true}).fill(query);
  await row.getByLabel('Exact Etsy interface URL (no query parameters)',{exact:true}).fill('https://www.etsy.com/your/shops/me/marketplace-insights');
  await row.getByLabel('Interface name',{exact:true}).fill('Etsy Marketplace Insights');
  await row.getByLabel('Captured at (UTC)',{exact:true}).fill(stamp(-3600000));
  await row.getByLabel('Exact displayed aggregate source text',{exact:true}).fill(`${query}. Conversion: Very low. No numeric conversion rate, eligible exposure count or buyer country was displayed. Explicitly synthetic browser fixture.`);
  await row.getByLabel('Exact citable excerpt from that text (up to 160 characters)',{exact:true}).fill('Conversion: Very low.');
  await row.getByLabel('Coverage, units/currency, missing values and limitations',{exact:true}).fill('Ordinal label only; numeric rate, item sales, eligible exposure and buyer geography are unknown. No profit conclusion.');
 }
 await region.getByLabel('Falsifiable hypothesis',{exact:true}).fill('Original astronomy candidate interest may differ from the plain adult shirt reference under comparable exposure.');
 await region.getByLabel('Success criterion / useful next experiment',{exact:true}).fill('A supported contrast with known comparable exposure justifies a separately reviewed bounded learning experiment.');
 await region.getByLabel('Failure criterion',{exact:true}).fill('Equal or worse candidate response under comparable exposure contradicts the proposed astronomy preference.');
 await region.getByLabel('Inconclusive criterion',{exact:true}).fill('Missing exposure, missing values or ordinal conversion alone leaves candidate demand unknown.');
 await region.getByRole('button',{name:'Review capture before saving',exact:true}).click();
 const save=region.getByRole('button',{name:'Save this exact capture',exact:true});
 await save.waitFor();assert.equal(await save.isDisabled(),true);
 await region.getByRole('checkbox',{name:/I checked these exact aggregate observations/}).check();
 await region.getByRole('button',{name:'Back to edit',exact:true}).click();
 await region.getByRole('button',{name:'Review capture before saving',exact:true}).click();
 assert.equal(await save.isDisabled(),true,'Returning to edit clears privacy consent');
 await region.getByRole('checkbox',{name:/I checked these exact aggregate observations/}).check();
 await save.dblclick();
 await region.getByText(/Immutable owner capture saved and selected/).waitFor();
 const saved=await r12OwnerRpc(boundary.state(),'r12_owner_observation_server',{p_business_id:r.businessId,p_operation:'list',p_payload:{},p_server_key:null});
 assert.equal(saved.error,null);assert.equal(saved.data.bundles.length,1,'Repeated Save creates one immutable capture');
 const bundle=saved.data.bundles[0];assert.equal(bundle.observations.length,3);assert.equal(bundle.baseline.candidateObservationIds.length,2);
 assert.equal(bundle.baseline.referenceObservationId,bundle.observations[2].id);
 for(const observation of bundle.observations){assert.equal(observation.context.geography.kind,'unknown');assert.equal(observation.metrics[0].displayed,'Conversion: Very low.');}
 assert.deepEqual((await r.db.query('select (select count(*) from private.r12_adaptive_setups) setups,(select count(*) from private.r12_discovery_scopes) scopes')).rows[0],before,'Saving captures creates no run authority');
 const calls=[...r.calls];await page.reload();
 const selector=page.getByLabel('Reviewed immutable capture bundle',{exact:true});
 await selector.locator(`option[value="${bundle.id}"]`).waitFor({state:'attached'});
 assert.equal(await selector.inputValue(),'','Reload does not silently select private evidence');
 await selector.selectOption(bundle.id);await selector.selectOption('');await selector.selectOption(bundle.id);
 assert.deepEqual(r.calls,calls,'Save, readback and explicit selection make no provider calls');
 return bundle;
}
