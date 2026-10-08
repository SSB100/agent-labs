import assert from 'node:assert/strict';
import {bounded,observe} from './async-bounds.mjs';

/** Match the actual POST, then require the action's semantic rendered result.
 * Streaming transport completion is not a substitute for a rendered result. */
export async function settledBrowserAction({page,name,settled,timeout=20000,onProgress=()=>{}}){
 let sent;
 const started=Date.now(),progress=phase=>onProgress({name,phase,elapsedMs:Date.now()-started});
 const capture=request=>{if(!sent&&request.method()==='POST'&&request.headers()['next-action'])sent=request;};
 page.on('request',capture);
 const response=observe(page.waitForResponse(value=>!!sent&&value.request()===sent,{timeout}));
 try{
  progress('click');await page.getByRole('button',{name,exact:true}).click();
  const received=await bounded(response,`${name}: response headers`,timeout);if(!received.ok)throw received.error;
  assert.equal(received.value.status(),200,`${name}: action HTTP status`);progress('headers');
  await bounded(settled(),`${name}: rendered result`,timeout);progress('settled');
 }finally{page.off('request',capture);}
}

export async function observeResearchActionStatus(page){
 await page.evaluate(()=>{
  const container=document.querySelector('.r12Controls');
  if(!container||container.querySelector('[role="status"]'))throw Error('Continue requires a fresh control render');
  const witness={message:null,observer:null};window.__r12TerminalActionWitness=witness;
  witness.observer=new MutationObserver(records=>{
   const added=records.flatMap(record=>Array.from(record.addedNodes));
   const status=container.querySelector('[role="status"]')??added.find(node=>node.nodeType===1&&node.matches('[role="status"]'));
   if(status?.textContent)witness.message=status.textContent;
  });
  witness.observer.observe(container,{childList:true,subtree:true,characterData:true});
 });
}
export async function awaitResearchActionStatus(page,timeout=300000){
 await page.waitForFunction(()=>!!window.__r12TerminalActionWitness?.message,{},{timeout});
 const message=await page.evaluate(()=>window.__r12TerminalActionWitness.message);
 assert.match(message,/^(Research execution completed\.|The output is saved\.|Progress is saved\.)/,'Continue must return a verified progress result');
}
export const releaseResearchActionStatus=page=>page.evaluate(()=>{
 window.__r12TerminalActionWitness?.observer.disconnect();delete window.__r12TerminalActionWitness;
});
