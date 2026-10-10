import {createHash,createHmac} from 'node:crypto';
import {awaitRequestDeadline,requestDeadline} from '../core/request-deadline';
import {discoveryV2Hash as hash} from '../products/discovery-v2-hash';
import {getSteelConfig,type SteelConfig} from './providers/steel';
import {getSteelCreateDeployment,type SteelCreateDeployment,steelCreateConfigurationAdmission} from './etsy-steel-create-binding';

/** Private operator qualification only. This function grants no authority and
 * publishes nothing. Invoke later inside the trusted deployed environment, with
 * a session independently known to be terminal before the check. Never send the
 * privateEvidence to a browser/model, stdout, a repository or release record.
 * Official documented read: steel-node Sessions.retrieve -> GET /v1/sessions/id.
 * Project access does not establish exclusive key scope or billing/tariff facts. */
export type SteelKnownTerminalSession={sessionId:string;providerProjectId:string;knownBefore:string;observedTerminalState:'Completed'|'released'|'failed';sessionCreatedAt?:string;providerStatus?:'released'|'failed'};
export type SteelExistingSessionReadback={version:'r12.steel-existing-session-readback.1';method:'GET';endpoint:string;requestedSessionId:string;returnedSessionId:string;returnedProjectId:string;providerStatus:'released'|'failed';sessionCreatedAt:string;observedAt:string;responseHash:string;credentialBindingHash:string;configurationHash:string};
const fail=():never=>{throw Error('steel_existing_session_readback_unqualified');};
const uuid=(x:unknown):x is string=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(x);
function utc(x:unknown):number{if(typeof x!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x))return fail();const n=Date.parse(x);if(!Number.isFinite(n)||new Date(n).toISOString()!==x)return fail();return n;}
export async function qualifySteelExistingSessionReadback(expected:SteelKnownTerminalSession,options:{config?:SteelConfig;deployment?:SteelCreateDeployment;fetcher?:typeof fetch;now?:()=>number;signal?:AbortSignal}={}){
 const controller=new AbortController(),signal=AbortSignal.any([controller.signal,requestDeadline(10_000),...(options.signal?[options.signal]:[])]);
 try{
  signal.throwIfAborted();const now=options.now??Date.now,started=now();if(!Number.isSafeInteger(started))return fail();
  const known=Object.freeze({...expected});
  if(!uuid(known.sessionId)||!uuid(known.providerProjectId)||!['Completed','released','failed'].includes(known.observedTerminalState)||known.providerStatus!==undefined&&!['released','failed'].includes(known.providerStatus)||utc(known.knownBefore)>=started||known.sessionCreatedAt!==undefined&&utc(known.sessionCreatedAt)>=utc(known.knownBefore))return fail();
  const config=Object.freeze({...options.config??getSteelConfig()}),deployment=Object.freeze({...options.deployment??getSteelCreateDeployment()});
  const configuration={version:'r12.steel-runtime-configuration.1' as const,provider:'steel' as const,baseUrl:config.baseUrl,region:config.region??null,providerProjectId:known.providerProjectId,...deployment};
  const configurationHash=hash(configuration),credentialBindingHash=createHmac('sha256',config.apiKey).update('r12.steel-credential-binding.1\n'+configurationHash).digest('hex');
  // Reuse the exact create validator and independently assert hashing parity.
  // This is a pure equality calculation: no operation, permit or POST is made.
  const equality=steelCreateConfigurationAdmission(config,{scopeHash:hash({sessionId:known.sessionId,providerProjectId:known.providerProjectId,knownBefore:known.knownBefore,observedTerminalState:known.observedTerminalState}),deployment,admit:async()=>fail()},known.sessionId,known.providerProjectId,JSON.stringify({sessionId:known.sessionId,projectId:known.providerProjectId}));
  if(equality.configurationHash!==configurationHash||equality.credentialBindingHash!==credentialBindingHash)return fail();
  const endpoint='https://api.steel.dev/v1/sessions/'+known.sessionId;
  const response=await awaitRequestDeadline((options.fetcher??fetch)(endpoint,{method:'GET',headers:{'steel-api-key':config.apiKey},redirect:'error',cache:'no-store',credentials:'omit',signal}),signal);
  if(!response.ok||response.redirected||response.url&&response.url!==endpoint||!response.body||Number(response.headers.get('content-length')??0)>65536){void response.body?.cancel().catch(()=>undefined);return fail();}
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const part=await awaitRequestDeadline(reader.read(),signal);if(part.done)break;size+=part.value.byteLength;if(size>65536)return fail();chunks.push(part.value);}}
  finally{void reader.cancel().catch(()=>undefined);}
  signal.throwIfAborted();const bytes=Buffer.concat(chunks),raw:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return fail();const record=raw as Record<string,unknown>;
  if(record.id!==known.sessionId||record.projectId!==known.providerProjectId||!['released','failed'].includes(String(record.status))||known.providerStatus!==undefined&&record.status!==known.providerStatus||utc(record.createdAt)>=utc(known.knownBefore)||known.sessionCreatedAt!==undefined&&record.createdAt!==known.sessionCreatedAt)return fail();
  const observed=now();if(!Number.isSafeInteger(observed)||observed<started||observed-started>10_000)return fail();
  const privateEvidence:Readonly<SteelExistingSessionReadback>=Object.freeze({version:'r12.steel-existing-session-readback.1',method:'GET',endpoint,requestedSessionId:known.sessionId,returnedSessionId:known.sessionId,returnedProjectId:known.providerProjectId,providerStatus:record.status as 'released'|'failed',sessionCreatedAt:record.createdAt as string,observedAt:new Date(observed).toISOString(),responseHash:createHash('sha256').update(bytes).digest('hex'),credentialBindingHash,configurationHash});
  const summary=Object.freeze({version:'r12.steel-existing-session-readback-summary.1' as const,sessionIdHash:hash({version:'r12.steel-session-reference.1',sessionId:known.sessionId}),providerProjectId:known.providerProjectId,sessionCreatedAt:privateEvidence.sessionCreatedAt,creationTimeSource:'provider_reported' as const,independentlyKnownBefore:known.knownBefore,observedTerminalState:known.observedTerminalState,observedAt:privateEvidence.observedAt,proofHash:hash(privateEvidence),projectAccessVerified:true as const,exclusiveScopeVerified:false as const,billingTariffVerified:false as const});
  return Object.freeze({configuration:Object.freeze(configuration),privateEvidence,summary});
 }catch{return fail();}finally{controller.abort();}
}
