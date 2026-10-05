import "server-only";
import { randomUUID } from "node:crypto";
import type { OwnerUiContext } from "../lib/core-ui/data";
import { verifyOwnerBusiness } from "../lib/core-ui/owner-business";
import { sealAccountSecret, unsealAccountSecret } from "../accounts/vault";
import { verifyPrintfulEnvironmentBinding } from "./printful-read";
import { exchangeReadOAuth, readOAuthStart, verifyEtsyReadConnection } from "./etsy-read";
import { UUID, ETSY_CALLBACK, fingerprint, requireConnection, record, exactPermit, type ConnectionGrant, type QualificationWorkspace } from "./contracts";

export function connectionQualificationConfigured(): boolean {
  return process.env.VERCEL_ENV==="production"&&(process.env.ACCOUNTS_SERVER_KEY?.length??0)>=32&&/^[a-f0-9]{64}$/.test(process.env.ACCOUNTS_VAULT_KEY??"");
}
function keys() {
  requireConnection(connectionQualificationConfigured());return {server:process.env.ACCOUNTS_SERVER_KEY!,vault:process.env.ACCOUNTS_VAULT_KEY!};
}
function etsyKeys(){const keystring=process.env.ETSY_KEYSTRING??"",sharedSecret=process.env.ETSY_SHARED_SECRET??"";requireConnection(/^[^\s:]{8,200}$/.test(keystring)&&/^[^\s:]{8,200}$/.test(sharedSecret));return {keystring,sharedSecret};}
async function session(context: OwnerUiContext,businessId:string){
  requireConnection(await verifyOwnerBusiness(context,businessId));const {data,error}=await context.supabase.auth.getClaims();
  const sessionId=data?.claims?.session_id;requireConnection(!error&&data?.claims?.sub===context.userId&&typeof sessionId==="string"&&UUID.test(sessionId));return sessionId;
}
export async function readConnectionQualification(context:OwnerUiContext,businessId:string):Promise<QualificationWorkspace>{
  const empty={businessId,unavailable:false,configured:connectionQualificationConfigured(),grants:[],connections:[],attempts:[]};
  try{requireConnection(await verifyOwnerBusiness(context,businessId));const {data,error}=await context.supabase.rpc("r11_connection_read",{p_business_id:businessId});requireConnection(!error);const row=record(data);
    requireConnection(row.businessId===businessId&&Array.isArray(row.grants)&&row.grants.length<=25&&Array.isArray(row.connections)&&row.connections.length<=2&&Array.isArray(row.attempts)&&row.attempts.length<=25);
    for(const value of row.grants){const g=record(value);requireConnection(typeof g.id==="string"&&UUID.test(g.id)&&["etsy","printful"].includes(String(g.provider))&&["available","used","expired","revoked"].includes(String(g.state)));}
    const connections=row.connections.map(value=>{const c=record(value);
      requireConnection(typeof c.id==="string"&&UUID.test(c.id)&&typeof c.revision==="string"&&UUID.test(c.revision)&&["etsy","printful"].includes(String(c.provider))&&["connected","revoked","expired","token_expired"].includes(String(c.status))&&["environment","encrypted_oauth"].includes(String(c.custody))&&typeof c.label==="string"&&c.label.length<=200&&typeof c.externalAccountId==="string"&&c.externalAccountId.length<=120&&typeof c.verifiedAt==="string"&&Number.isFinite(Date.parse(c.verifiedAt))&&typeof c.expiresAt==="string"&&Number.isFinite(Date.parse(c.expiresAt))&&Array.isArray(c.permittedOperations)&&c.permittedOperations.length<=2&&c.permittedOperations.every(v=>typeof v==="string"&&["shop.read","listing.read","catalog.read"].includes(v)));
      const {credentialFingerprint,credentialAlias,...safe}=c;
      let current="";if(c.provider==="etsy"&&process.env.ETSY_KEYSTRING&&process.env.ETSY_SHARED_SECRET)current=fingerprint(`${process.env.ETSY_KEYSTRING}\0${process.env.ETSY_SHARED_SECRET}`);
      else if(c.provider==="printful"&&typeof credentialAlias==="string"&&/^PRINTFUL_[A-Z0-9_]{1,64}_TOKEN$/.test(credentialAlias))current=process.env[credentialAlias]?fingerprint(process.env[credentialAlias]!):"";
      return {...safe,status:c.status==="connected"&&current!==credentialFingerprint?"credential_changed":c.status};});
    for(const value of row.attempts){const a=record(value);requireConnection(typeof a.id==="string"&&UUID.test(a.id)&&["etsy","printful"].includes(String(a.provider))&&["awaiting_owner","verifying","verified","failed","cancelled","expired"].includes(String(a.status))&&typeof a.createdAt==="string"&&Number.isFinite(Date.parse(a.createdAt))&&(a.completedAt===null||typeof a.completedAt==="string"&&Number.isFinite(Date.parse(a.completedAt)))&&(a.reason===null||["provider_unverified","owner_cancelled","access_expired"].includes(String(a.reason))));}
    const grants=row.grants.map(value=>{const g=record(value);return {...g,configured:empty.configured&&(g.provider==="etsy"?Boolean(process.env.ETSY_KEYSTRING&&process.env.ETSY_SHARED_SECRET):typeof g.credentialAlias==="string"&&/^PRINTFUL_[A-Z0-9_]{1,64}_TOKEN$/.test(g.credentialAlias)&&Boolean(process.env[g.credentialAlias]))};});
    return {...empty,grants,connections,attempts:row.attempts,grantTotal:row.grantTotal,attemptTotal:row.attemptTotal,configurationFingerprints:{etsy:process.env.ETSY_KEYSTRING&&process.env.ETSY_SHARED_SECRET?fingerprint(`${process.env.ETSY_KEYSTRING}\0${process.env.ETSY_SHARED_SECRET}`):null,printfulPrimary:process.env.PRINTFUL_STUDIOKINDREDSTORE_TOKEN?fingerprint(process.env.PRINTFUL_STUDIOKINDREDSTORE_TOKEN):null}} as QualificationWorkspace;
  }catch{return {...empty,unavailable:true};}
}
async function rpc(context:OwnerUiContext,businessId:string,operation:string,payload:Record<string,unknown>){
  const {data,error}=await context.supabase.rpc("r11_connection_owner",{p_business_id:businessId,p_operation:operation,p_payload:payload,p_server_key:operation==="disconnect"?"":keys().server});requireConnection(!error);return record(data);
}
async function grant(context:OwnerUiContext,businessId:string,grantId:string,provider:"etsy"|"printful"):Promise<ConnectionGrant>{
  requireConnection(UUID.test(grantId));const view=await readConnectionQualification(context,businessId);const selected=view.grants.find(g=>g.id===grantId&&g.provider===provider&&g.state==="available");requireConnection(!view.unavailable&&selected);return selected;
}
type BrowserBinding={businessId:string;attemptId:string;revision:string;sealed:string};
type PkceBinding={businessId:string;ownerId:string;sessionId:string;attemptId:string;revision:string;grantId:string;state:string;verifier:string;nonce:string;applicationId:string;callback:string;credentialFingerprint:string};
export async function beginEtsyReadConnection(context:OwnerUiContext,businessId:string,grantId:string){
  const sessionId=await session(context,businessId),g=await grant(context,businessId,grantId,"etsy"),config=etsyKeys();
  requireConnection(g.approvedCredentialFingerprint===fingerprint(`${config.keystring}\0${config.sharedSecret}`),"unapproved_application_credential");
  const flow=readOAuthStart(config),attemptId=randomUUID(),revision=randomUUID();
  const binding:PkceBinding={businessId,ownerId:context.userId,sessionId,attemptId,revision,grantId:g.id,state:flow.state,verifier:flow.verifier,nonce:flow.nonce,applicationId:g.applicationId,callback:ETSY_CALLBACK,credentialFingerprint:fingerprint(`${config.keystring}\0${config.sharedSecret}`)};
  const aad={businessId,provider:"etsy_r11_pkce",connectionId:attemptId,revision};
  const envelope=sealAccountSecret(binding,aad,keys().vault);
  await rpc(context,businessId,"begin",{grantId:g.id,attemptId,revision,stateHash:fingerprint(flow.state),envelope,credentialFingerprint:binding.credentialFingerprint});
  const cookie=Buffer.from(JSON.stringify({businessId,attemptId,revision,sealed:sealAccountSecret({...binding,verifier:undefined},{...aad,provider:"etsy_r11_cookie"},keys().vault)})).toString("base64url");
  return {url:flow.url,cookie};
}
function openBrowserBinding(value:string):{browser:BrowserBinding;binding:PkceBinding}{
  requireConnection(value.length<8000&&/^[A-Za-z0-9_-]+$/.test(value));const raw=record(JSON.parse(Buffer.from(value,"base64url").toString("utf8")));
  requireConnection(Object.keys(raw).sort().join(",")==="attemptId,businessId,revision,sealed"&&[raw.businessId,raw.attemptId,raw.revision].every(v=>typeof v==="string"&&UUID.test(v))&&typeof raw.sealed==="string");
  const browser=raw as unknown as BrowserBinding;
  const binding=unsealAccountSecret<PkceBinding>(browser.sealed,{businessId:browser.businessId,provider:"etsy_r11_cookie",connectionId:browser.attemptId,revision:browser.revision},keys().vault);
  return {browser,binding};
}
export async function completeEtsyReadConnection(context:OwnerUiContext,cookie:string,query:URLSearchParams):Promise<string>{
  const {browser,binding}=openBrowserBinding(cookie),{businessId,attemptId,revision}=browser,sessionId=await session(context,businessId);
  requireConnection(binding.businessId===businessId&&binding.attemptId===attemptId&&binding.revision===revision&&binding.ownerId===context.userId&&binding.sessionId===sessionId&&binding.callback===ETSY_CALLBACK&&binding.state===query.get("state"),"connection_browser_binding_mismatch");
  if(query.has("error")){await rpc(context,businessId,"cancel",{attemptId});return businessId;}
  const code=query.get("code")??"";requireConnection(code.length>=8&&code.length<=4096);
  const config=etsyKeys(),credentialFingerprint=fingerprint(`${config.keystring}\0${config.sharedSecret}`);requireConnection(credentialFingerprint===binding.credentialFingerprint);
  let consumed=false;
  try{
    const raw=await rpc(context,businessId,"consume",{attemptId,stateHash:fingerprint(binding.state),credentialFingerprint});consumed=true;
    requireConnection(raw.revision===revision&&raw.applicationId===binding.applicationId&&typeof raw.envelope==="string"&&typeof raw.expectedAccount==="string"&&typeof raw.connectionExpiresAt==="string");
    const saved=unsealAccountSecret<PkceBinding>(raw.envelope,{businessId,provider:"etsy_r11_pkce",connectionId:attemptId,revision},keys().vault);
    requireConnection(saved.businessId===businessId&&saved.ownerId===context.userId&&saved.sessionId===sessionId&&saved.attemptId===attemptId&&saved.revision===revision&&saved.grantId===binding.grantId&&saved.nonce===binding.nonce&&saved.state===binding.state&&saved.applicationId===binding.applicationId&&saved.callback===ETSY_CALLBACK&&saved.credentialFingerprint===credentialFingerprint);
    const permit=async(step:number,endpoint:string,method:"GET"|"POST",facts:Record<string,unknown>={})=>exactPermit(await rpc(context,businessId,"mark",{attemptId,step,facts,credentialFingerprint}),{attemptId,step,endpoint,method});
    const tokens=await exchangeReadOAuth(config,{code,verifier:saved.verifier},permit);
    const proof=await verifyEtsyReadConnection(config,tokens,raw.expectedAccount,permit);
    const connectionId=typeof raw.connectionId==="string"?raw.connectionId:attemptId;
    const envelope=sealAccountSecret({...tokens,businessId,connectionId,revision,shopId:proof.shopId,shopName:proof.shopName,currency:proof.currency,expiresAt:raw.connectionExpiresAt},
      {businessId,provider:"etsy_r11_access",connectionId,revision},keys().vault);
    await rpc(context,businessId,"complete",{attemptId,proof,envelope,credentialFingerprint});return businessId;
  }catch{if(consumed)try{await rpc(context,businessId,"fail",{attemptId});}catch{/* Unknown remains explicit; no retry. */}throw new Error("connection_qualification_unverified");}
}
export async function qualifyPrintfulEnvironment(context:OwnerUiContext,businessId:string,grantId:string){
  await session(context,businessId);const g=await grant(context,businessId,grantId,"printful");requireConnection(typeof g.credentialAlias==="string"&&/^PRINTFUL_[A-Z0-9_]{1,64}_TOKEN$/.test(g.credentialAlias));
  const credential=process.env[g.credentialAlias]??"";requireConnection(/^[\x21-\x7e]{8,8192}$/.test(credential));
  const credentialFingerprint=fingerprint(credential);requireConnection(credentialFingerprint===g.approvedCredentialFingerprint,"unapproved_application_credential");const attemptId=randomUUID(),revision=randomUUID();
  const begun=await rpc(context,businessId,"begin",{grantId:g.id,attemptId,revision,stateHash:null,envelope:null,credentialFingerprint});
  try{
    requireConnection(typeof begun.connectionExpiresAt==="string"&&(begun.storeKind==="manual_api"||begun.storeKind==="ecommerce_linked"));const storeId=Number(g.expectedAccount);
    requireConnection((g.providerScopeMode==="exact"&&Array.isArray(g.providerScopes)||g.providerScopeMode==="inspect_and_record"&&g.providerScopes===null)&&typeof begun.providerType==="string");
    const proof=await verifyPrintfulEnvironmentBinding({storeId,storeKind:begun.storeKind,credential,expectedProviderType:begun.providerType,approvedProviderScopes:g.providerScopes??null,scopeMode:g.providerScopeMode!},async(step,endpoint,method)=>{
      requireConnection(fingerprint(process.env[g.credentialAlias!]??"")===credentialFingerprint);
      return exactPermit(await rpc(context,businessId,"mark",{attemptId,step,facts:{},credentialFingerprint}),{attemptId,step,endpoint,method});
    });
    await rpc(context,businessId,"complete",{attemptId,envelope:null,credentialFingerprint,proof});
  }catch{try{await rpc(context,businessId,"fail",{attemptId});}catch{/* Preserve unknown verification. */}throw new Error("connection_qualification_unverified");}
}
export async function disconnectQualifiedConnection(context:OwnerUiContext,businessId:string,connectionId:string,revision:string){
 await session(context,businessId);requireConnection(UUID.test(connectionId)&&UUID.test(revision));return rpc(context,businessId,"disconnect",{connectionId,revision});
}
