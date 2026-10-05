/** Standalone Playwright does not inherit a test-runner timeout. Every bound fails closed. */
export const FIXTURE_ACTION_TIMEOUT_MS=20_000;
export const FIXTURE_NAVIGATION_TIMEOUT_MS=30_000;
export function setFixtureBrowserTimeouts(context,page){
 context.setDefaultTimeout(FIXTURE_ACTION_TIMEOUT_MS);
 context.setDefaultNavigationTimeout(FIXTURE_NAVIGATION_TIMEOUT_MS);
 if(page){page.setDefaultTimeout(FIXTURE_ACTION_TIMEOUT_MS);page.setDefaultNavigationTimeout(FIXTURE_NAVIGATION_TIMEOUT_MS);}
}
/** Attach both handlers immediately so a later timeout cannot leave an unhandled rejection. */
export const observe=promise=>Promise.resolve(promise).then(value=>({ok:true,value}),error=>({ok:false,error}));
export async function bounded(promise,label,timeoutMs=FIXTURE_ACTION_TIMEOUT_MS){
 let timer;
 try{return await Promise.race([Promise.resolve(promise),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(`${label} timed out after ${timeoutMs}ms`)),timeoutMs);})]);}
 finally{clearTimeout(timer);}
}
/** Cleanup is mandatory; report cleanup failure alongside the original assertion instead of hiding it. */
export async function withReleasedGate(body,release){
 let value,bodyError,releaseError,bodyFailed=false,releaseFailed=false;
 try{value=await body();}catch(error){bodyError=error;bodyFailed=true;}
 finally{try{await release();}catch(error){releaseError=error;releaseFailed=true;}}
 if(bodyFailed&&releaseFailed)throw new AggregateError([bodyError,releaseError],'Fixture action failed and gate cleanup also failed');
 if(bodyFailed)throw bodyError;if(releaseFailed)throw releaseError;return value;
}
