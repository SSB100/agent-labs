import assert from 'node:assert/strict';
import path from 'node:path';
import {id} from './data.mjs';
export async function runConnectionJourneys({page,origin,boundary,output,check}){
 const business=id(1),control=values=>fetch(boundary.origin+'/control',{method:'POST',body:JSON.stringify(values)});
    await check('R11 renewable-read metadata is inert and Stop survives repeated navigation and reload',async()=>{
      await control({r11Reads:true,r11ReadState:'ready'});await page.setViewportSize({width:1280,height:720});await page.goto(origin+`/dashboard/connections?business=${business}`);
      await page.getByRole('heading',{name:'Authorized own-shop reads',exact:true}).waitFor();await page.getByText(/Observed 2 drafts/).waitFor();
      assert.equal(await page.getByRole('button',{name:'Read latest draft status',exact:true}).isDisabled(),true,'No Production credentials are present in the inert browser fixture');
      await page.screenshot({path:path.join(output,'r11-read-window-ready-1280x720.png'),fullPage:true});const before=boundary.effects.length;
      await page.getByRole('button',{name:'Stop this read window',exact:true}).click();await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Stop this read window'&&b.disabled));assert.equal(boundary.effects.length,before+1);
      await page.reload();assert.equal(await page.getByRole('button',{name:'Stop this read window',exact:true}).isDisabled(),true);
      await page.goto(origin+`/dashboard/connections?business=${id(2)}`);assert.equal(await page.getByRole('button',{name:'Stop this read window',exact:true}).isEnabled(),true);
      await page.goBack();await page.waitForURL(u=>u.searchParams.get('business')===business);assert.equal(await page.getByRole('button',{name:'Stop this read window',exact:true}).isDisabled(),true);assert.equal(boundary.effects.length,before+1);
      await control({r11ReadState:'candidate'});await page.reload();await page.getByText(/refresh_unverified/).waitFor();await page.getByText(/The saved operation is not replayed/).waitFor();assert.equal(await page.getByRole('button',{name:'Read latest draft status',exact:true}).isDisabled(),true);
      await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'r11-read-window-candidate-390x844.png'),fullPage:true});assert.equal(boundary.effects.length,before+1);await control({r11Reads:false,r11ReadState:'ready'});
    });
    await check('R11 real Next exact-attempt reconciliation survives reload and never sends another provider request',async()=>{
      await control({r11Reads:true,r11ReadState:'interrupted'});await page.goto(origin+`/dashboard/connections?business=${business}`);await page.getByRole('button',{name:'Reconcile this saved attempt',exact:true}).waitFor();const before=boundary.effects.length;
      await page.getByRole('button',{name:'Reconcile this saved attempt',exact:true}).click();await page.waitForURL(/readNotice=check-saved-state/);await page.getByText(/No automatic retry was made/).waitFor();assert.equal(await page.getByRole('button',{name:'Reconcile this saved attempt',exact:true}).count(),0);
      assert.equal(boundary.effects.length,before+1);assert.equal(boundary.effects.at(-1).kind,'in-memory-r11-reconcile');await page.reload();assert.equal(boundary.effects.length,before+1);assert.equal(await page.getByRole('button',{name:'Reconcile this saved attempt',exact:true}).count(),0);
      await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'r11-reconciled-attempt-390x844.png'),fullPage:true});await control({r11Reads:false,r11ReadState:'ready'});
    });
    await check('R11 exact read-only connections preserve Business and local disconnect across real Next actions',async()=>{
      await page.setViewportSize({width:1280,height:720});await page.goto(origin+`/dashboard/connections?business=${business}`);
      await page.getByRole('heading',{name:'Store connections',exact:true}).waitFor();
      await page.getByText(/credential_changed/).waitFor();assert.equal(await page.getByRole('button',{name:'Continue to Etsy read-only consent',exact:true}).isDisabled(),true);await page.screenshot({path:path.join(output,'r11-connections-token-expired-1280x720.png'),fullPage:true});
      const before=boundary.effects.length;await page.getByRole('button',{name:'Disconnect locally',exact:true}).click();await page.getByRole('button',{name:'Disconnect locally',exact:true}).waitFor();
      await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Disconnect locally'&&b.disabled));assert.equal(boundary.effects.length,before+1);
      await page.reload();assert.equal(await page.getByRole('button',{name:'Disconnect locally',exact:true}).isDisabled(),true);await page.screenshot({path:path.join(output,'r11-connections-revoked-1280x720.png'),fullPage:true});
      await page.goto(origin+`/dashboard/connections?business=${id(2)}`);await page.getByText(/credential_changed/).waitFor();assert.equal(await page.getByRole('button',{name:'Disconnect locally',exact:true}).isEnabled(),true);
      await page.goBack();await page.waitForURL(u=>u.searchParams.get('business')===business);assert.equal(await page.getByRole('button',{name:'Disconnect locally',exact:true}).isDisabled(),true);
    });
}
