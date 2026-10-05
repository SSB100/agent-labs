import { fingerprint, record, requireConnection, type QualificationPermit } from "./contracts";
export type PrintfulReadProof={storeId:number;storeKind:"manual_api"|"ecommerce_linked";providerType:string;providerScopes:string[];responseHash:string;verifiedAt:string};
export function providerScopes(value:unknown):string[]{
 requireConnection(Array.isArray(value)&&value.length<=64&&value.every(v=>typeof v==="string"&&/^[a-z][a-z0-9_/-]{0,79}$/.test(v))&&new Set(value).size===value.length,"provider_scopes_unverified");return [...value].sort();
}
export async function verifyPrintfulEnvironmentBinding(input:{storeId:number;storeKind:"manual_api"|"ecommerce_linked";credential:string;expectedProviderType:string;approvedProviderScopes:string[]|null;scopeMode:"exact"|"inspect_and_record"},permit:(step:number,endpoint:string,method:"GET")=>Promise<QualificationPermit>,fetcher:typeof fetch=fetch):Promise<PrintfulReadProof>{
 const owned=structuredClone(input);requireConnection(Number.isSafeInteger(owned.storeId)&&owned.storeId>0&&/^[\x21-\x7e]{8,8192}$/.test(owned.credential)&&["manual_api","ecommerce_linked"].includes(owned.storeKind));
 requireConnection(owned.scopeMode==="exact"?Array.isArray(owned.approvedProviderScopes):owned.scopeMode==="inspect_and_record"&&owned.approvedProviderScopes===null);
 const approved=owned.approvedProviderScopes===null?null:providerScopes(owned.approvedProviderScopes),read=async(step:number,path:string)=>{
  const endpoint=`https://api.printful.com${path}`,authority=await permit(step,endpoint,"GET");requireConnection(authority.endpoint===endpoint&&authority.method==="GET"&&Date.parse(authority.expiresAt)>Date.now(),"connection_dispatch_expired");
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try{
   const response=await fetcher(endpoint,{method:"GET",redirect:"error",cache:"no-store",signal:controller.signal,headers:{Authorization:`Bearer ${owned.credential}`,Accept:"application/json",...(step===1?{"X-PF-Store-Id":String(owned.storeId)}:{})}});
   requireConnection(response.status===200&&!response.redirected&&(response.url===""||response.url===endpoint)&&response.headers.get("content-type")?.includes("application/json")&&response.body,"provider_read_unverified");
   const reader=response.body.getReader(),parts:Uint8Array[]=[];let bytes=0;try{for(;;){const p=await reader.read();if(p.done)break;bytes+=p.value.length;requireConnection(bytes<=65536,"provider_response_too_large");parts.push(p.value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
   return record(JSON.parse(Buffer.concat(parts).toString("utf8")));
  }catch{throw new Error("provider_read_unverified");}finally{clearTimeout(timer);controller.abort();}
 };
 const scopesBody=await read(0,"/oauth/scopes");requireConnection(scopesBody.code===200);const raw=record(scopesBody.result).scopes;
 requireConnection(Array.isArray(raw));const scopes=providerScopes(raw.map(v=>record(v).scope));requireConnection(approved===null||JSON.stringify(scopes)===JSON.stringify(approved),"provider_scopes_changed");
 const storeBody=await read(1,`/stores/${owned.storeId}`),store=record(storeBody.result);requireConnection(storeBody.code===200&&store.id===owned.storeId&&store.type===owned.expectedProviderType&&typeof store.type==="string"&&/^[a-z][a-z0-9_-]{0,79}$/.test(store.type)&&typeof store.name==="string"&&store.name.length>0&&store.name.length<=2000,"provider_store_unverified");
 requireConnection(owned.storeKind==="manual_api"?store.type==="native":store.type!=="native","provider_store_type_changed");
 const facts={storeId:owned.storeId,storeKind:owned.storeKind,providerType:store.type,providerScopes:scopes};
 return {...facts,responseHash:fingerprint(JSON.stringify(facts)),verifiedAt:new Date().toISOString()};
}
