import type {Locator,Page} from 'playwright-core';
import {awaitRequestDeadline} from '../core/request-deadline';
import {insightsFail,insightsHash} from './etsy-insights-policy';

/** Ordinary same-page visible DOM observed 2026-10-10T14:17:55Z. This is a
 * selector contract, not paid Steel or restricted-network completeness proof.
 * The results-view form is a different, independently frozen contract. */
export const ETSY_INSIGHTS_LANDING_CONTROLS_VERSION='etsy.insights-landing-controls.2' as const;
export const ETSY_INSIGHTS_LANDING_CONTROL_ID='observed-insights-landing-controls.2' as const;
export const ETSY_INSIGHTS_LANDING_LABEL='Enter a search term to explore buyer activity on Etsy and discover related terms to help optimise your shop.';
export const ETSY_INSIGHTS_LANDING_CONTROL_WITNESS=Object.freeze({
 version:ETSY_INSIGHTS_LANDING_CONTROLS_VERSION,
 inputId:'keyword-research-search-input',inputName:'keyword_search_input',inputType:'text',
 inputAriaLabel:null,inputAriaLabelledby:'mi-search-input-label',inputLabel:ETSY_INSIGHTS_LANDING_LABEL,
 inputPlaceholder:'Try a search term like “vase”',containerTag:'DIV',containerInputs:1,containerButtons:1,
 directInput:true,directSubmit:true,buttonAccessibleName:'Search',buttonType:'submit',
 buttonAriaLabel:null,buttonLabelReference:'single_id',buttonLabelText:'Search',
 labelVisible:true,inputVisible:true,inputEnabled:true,buttonVisible:true,buttonEnabled:true,
});
export const ETSY_INSIGHTS_LANDING_CONTROLS=Object.freeze({
 version:ETSY_INSIGHTS_LANDING_CONTROLS_VERSION,controlId:ETSY_INSIGHTS_LANDING_CONTROL_ID,observedAt:'2026-10-10T14:17:55.000Z',
 main:'#main-content',input:'#keyword-research-search-input',label:'#mi-search-input-label',
 heading:'Marketplace Insights',witness:ETSY_INSIGHTS_LANDING_CONTROL_WITNESS,
});
export const ETSY_INSIGHTS_LANDING_CONTROLS_HASH=insightsHash(ETSY_INSIGHTS_LANDING_CONTROLS);
export const ETSY_INSIGHTS_LANDING_WITNESS_HASH=insightsHash(ETSY_INSIGHTS_LANDING_CONTROL_WITNESS);

type ReadBoundary={visible(locator:Locator,page:Page,signal:AbortSignal):Promise<unknown>;
 literal(locator:Locator,page:Page,signal:AbortSignal,maximum?:number):Promise<string>};
/** No generic input fallback, hidden value, whole document read, or query. */
export async function readEtsyInsightsLandingControls(page:Page,signal:AbortSignal,read:ReadBoundary):Promise<{input:Locator;submit:Locator;witnessHash:string}>{
 const main=page.locator(ETSY_INSIGHTS_LANDING_CONTROLS.main),field=main.locator(ETSY_INSIGHTS_LANDING_CONTROLS.input),
  label=main.locator(ETSY_INSIGHTS_LANDING_CONTROLS.label),container=field.locator('..');
 const call=<T>(p:Promise<T>)=>awaitRequestDeadline(p,signal);
 await read.visible(field,page,signal);await read.visible(label,page,signal);await read.visible(container,page,signal);
 const expected={id:'keyword-research-search-input',name:'keyword_search_input',type:'text','aria-label':null,
  'aria-labelledby':'mi-search-input-label',placeholder:'Try a search term like “vase”'};
 for(const [key,value] of Object.entries(expected))if(await call(field.getAttribute(key))!==value)return insightsFail('insights_landing_control_unverified');
 if(await read.literal(label,page,signal,200)!==ETSY_INSIGHTS_LANDING_LABEL||
  await read.literal(main.getByRole('heading',{name:'Marketplace Insights',exact:true}),page,signal,100)!=='Marketplace Insights'||
  await call(container.evaluate(el=>el.tagName))!=='DIV'||await call(container.locator('input').count())!==1||
  await call(container.locator('button').count())!==1||await call(container.locator(':scope > input').count())!==1||
  await call(field.and(main.getByRole('textbox',{name:ETSY_INSIGHTS_LANDING_LABEL,exact:true})).count())!==1||!await call(field.isEnabled()))return insightsFail('insights_landing_control_unverified');
 const submit=container.locator(':scope > button[type="submit"]').and(container.getByRole('button',{name:'Search',exact:true}));
 await read.visible(submit,page,signal);
 const ref=await call(submit.getAttribute('aria-labelledby'));
 if(await call(submit.getAttribute('type'))!=='submit'||await call(submit.getAttribute('aria-label'))!==null||!await call(submit.isEnabled())||
  !ref||!/^[A-Za-z][A-Za-z0-9_-]{0,119}$/.test(ref))return insightsFail('insights_landing_control_unverified');
 // The actual dynamic id is not retained or put into the stable witness hash.
 if(await read.literal(page.locator(`[id="${ref}"]`),page,signal,20)!=='Search')return insightsFail('insights_landing_control_unverified');
 signal.throwIfAborted();return{input:field,submit,witnessHash:ETSY_INSIGHTS_LANDING_WITNESS_HASH};
}
