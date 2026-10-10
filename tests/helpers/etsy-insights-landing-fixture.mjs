import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {fixture,verificationFixture} from './etsy-insights-playwright-fixture.mjs';
const load=name=>import(pathToFileURL(resolve(process.env.R12_INSIGHTS_CORE_DIR||'.core-tests','browser',name)).href);
const controls=await load('etsy-insights-landing-controls.js');
const {insightsHash:hash}=await load('etsy-insights-policy.js');
const {createEtsyInsightsPlaywrightPort,createEtsyInsightsVerificationPort}=await load('etsy-insights-playwright.js');
export {controls,hash};
/** Synthetic observed-signature double. It never represents an Etsy login,
 * live rendering, allowed assets, provider accounting, or actual query quota. */
export function landingFixture(options={},verification=false){
 const o={...options},f=verification?verificationFixture(o):fixture(o),original=f.page.locator.bind(f.page);
 const field='#main-content #keyword-research-search-input',label='#main-content #mi-search-input-label',container=field+':parent';
 function wrap(n){const key=n.key,isField=key===field,isLabel=key===label,isParent=key===container,isSubmit=key===container+' :scope > button[type="submit"]',isButtonLabel=key==='[id="inert-search-label-42"]';
  return {...n,
   locator(s){return wrap(n.locator(s));},getByRole(r,a){return wrap(n.getByRole(r,a));},
   and(){return{...wrap(n),async count(){if(isField)return options.wrongInputAccessibleName?0:1;if(isSubmit)return options.wrongButtonAccessibleName||options.nestedSubmit?0:options.duplicateSubmit?2:1;return 0;}};},
   async count(){
    if(options.noLanding&&[isField,isLabel,isParent,isSubmit,isButtonLabel].some(Boolean))return 0;
    if(isField)return options.missingInput?0:options.duplicateInput?2:1;
    if(isLabel)return options.missingLabel?0:options.duplicateLabel?2:1;
    if(key===container+' input'||key===container+' :scope > input')return options.nestedInput&&key.includes(':scope')?0:options.extraContainerInput?2:1;
    if(key===container+' button')return options.extraContainerButton?2:1;
    if(isSubmit)return options.nestedSubmit?0:1;
    return n.count();
   },
   async evaluate(){if(!isParent)throw Error('Unexpected synthetic evaluation');return options.wrongContainer?'FORM':'DIV';},
   async getAttribute(name){
    if(isField)return ({id:'keyword-research-search-input',name:'keyword_search_input',type:'text','aria-labelledby':'mi-search-input-label','aria-label':null,placeholder:'Try a search term like “vase”',...options.inputAttributes})[name]??null;
    if(isSubmit)return ({type:'submit','aria-label':null,'aria-labelledby':'inert-search-label-42',...options.buttonAttributes})[name]??null;
    return n.getAttribute(name);
   },
   async innerText(){if(isLabel)return options.labelText??controls.ETSY_INSIGHTS_LANDING_LABEL;if(isButtonLabel)return options.buttonLabel??'Search';return n.innerText();},
   async isEnabled(){if(isField&&options.inputDisabled||isSubmit&&options.buttonDisabled)return false;return n.isEnabled();},
   async isVisible(){if(isLabel&&options.labelHidden||isSubmit&&options.buttonHidden)return false;return n.isVisible();},
   async fill(value){await n.fill(value);if(options.changeShopAfterFill)o.shop='Different Synthetic Shop';if(options.changeControlsAfterFill)options.inputAttributes={name:'changed'};},
  };
 }
 f.page.locator=selector=>wrap(original(selector));
 const input=verification?f.verificationInput:f.input,qualify=input.qualifyRenderer;
 input.qualifyRenderer=async scope=>{const previous=await qualify(scope),{qualificationHash:ignored,...old}=previous;void ignored;
  const body={...old,version:'r12.etsy-insights-renderer-qualification.2',landingControlsVersion:controls.ETSY_INSIGHTS_LANDING_CONTROLS_VERSION,landingControlsHash:controls.ETSY_INSIGHTS_LANDING_CONTROLS_HASH,...options.qualificationPins};
  return{...body,qualificationHash:options.qualificationHash??hash(body)};};
 if(verification)f.verifier=createEtsyInsightsVerificationPort(input);else f.port=createEtsyInsightsPlaywrightPort(input);
 return f;
}
